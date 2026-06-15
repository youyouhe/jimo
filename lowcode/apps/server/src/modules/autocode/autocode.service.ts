import {
  Injectable,
  Inject,
  ConflictException,
  NotFoundException,
  Logger,
} from '@nestjs/common';
import { randomUUID } from 'node:crypto';
import { promises as fs, existsSync } from 'node:fs';
import * as path from 'node:path';
import { eq, and, isNull, desc, sql, count, inArray, ilike } from 'drizzle-orm';
import { DATABASE_CONNECTION, DrizzleDb } from '../../db/connection';
import {
  sysAutoCodeHistories,
  type SysAutoCodeHistory,
  type NewSysAutoCodeHistory,
} from '../../db/schema/auto-code-histories';
import {
  sysAutoCodePackages,
  type SysAutoCodePackage,
  type NewSysAutoCodePackage,
} from '../../db/schema/auto-code-packages';
import { sysMenus } from '../../db/schema/menus';
import { sysRoleMenus } from '../../db/schema/role-menus';
import { sysRoles } from '../../db/schema/roles';
import { sysAuthorityBtns } from '../../db/schema/authority-btns';
import { sysApis } from '../../db/schema/apis';
import { CASBIN_SERVICE_TOKEN, ICasbinService } from '../role/role.service';
import { AutoCodeDto, AutoCodeField } from './dto/autocode.dto';
import { UpdateModuleDto } from './dto/update-module.dto';
import { CreatePackageDto, UpdatePackageDto, SaveFromConfigDto } from './dto/package.dto';

// ---------------------------------------------------------------------------
// Name conversion helpers
// ---------------------------------------------------------------------------

function toPascalCase(name: string): string {
  if (!name) return '';
  return name
    .split('_')
    .map((word) => word.charAt(0).toUpperCase() + word.slice(1).toLowerCase())
    .join('');
}

function toCamelCase(name: string): string {
  if (!name) return '';
  const pascal = toPascalCase(name);
  return pascal.charAt(0).toLowerCase() + pascal.slice(1);
}

function toKebabCase(name: string): string {
  if (name.includes('_')) {
    return name.toLowerCase().replace(/_/g, '-');
  }
  return name
    .replace(/([a-z0-9])([A-Z])/g, '$1-$2')
    .replace(/([A-Z])([A-Z][a-z])/g, '$1-$2')
    .toLowerCase();
}

function singularize(word: string): string {
  if (!word) return '';
  if (word.endsWith('ies')) return word.slice(0, -3) + 'y';
  if (word.endsWith('ses')) return word.slice(0, -2);
  if (word.endsWith('s') && !word.endsWith('ss')) return word.slice(0, -1);
  return word;
}

// ---------------------------------------------------------------------------
// Type mapper
// ---------------------------------------------------------------------------

function toTsType(field: AutoCodeField): string {
  switch (field.type) {
    case 'varchar':
    case 'text':
    case 'timestamp':
    case 'uuid':
    case 'image':
    case 'file':
    case 'relation':
    case 'dict':
      return 'string';
    case 'integer':
    case 'bigint':
      return 'number';
    case 'decimal':
      return 'string';
    case 'boolean':
      return 'boolean';
    default:
      return 'string';
  }
}

function toDrizzleType(field: AutoCodeField): string {
  switch (field.type) {
    case 'varchar':
      return `varchar('${field.name}', { length: ${field.length || 255} })`;
    case 'image':
    case 'file':
      return `varchar('${field.name}', { length: 512 })`;
    case 'dict':
      return `varchar('${field.name}', { length: ${field.length || 64} })`;
    case 'text':
      return `text('${field.name}')`;
    case 'integer':
      return `integer('${field.name}')`;
    case 'bigint':
      return `bigint('${field.name}', { mode: 'number' })`;
    case 'decimal':
      return `numeric('${field.name}', { precision: 12, scale: 2 })`;
    case 'boolean':
      return `boolean('${field.name}')`;
    case 'timestamp':
      return `timestamp('${field.name}', { withTimezone: true })`;
    case 'uuid':
    case 'relation':
      return `uuid('${field.name}')`;
    default:
      return `varchar('${field.name}')`;
  }
}

function toDefaultValue(field: AutoCodeField): string {
  if (!field.required) {
    switch (field.type) {
      case 'boolean':
        return '.default(false)';
      case 'integer':
      case 'bigint':
        return '.default(0)';
      case 'decimal':
        return ".default('0')";
      case 'varchar':
      case 'text':
      case 'image':
      case 'file':
      case 'dict':
        return `.default('')`;
      default:
        return '';
    }
  }
  return '';
}

function toRequired(field: AutoCodeField): string {
  return field.required ? '.notNull()' : '';
}

/**
 * Filter out removed fields for business code generation.
 * Removed fields are kept in schema (DB column preserved) but excluded from
 * DTOs, services, controllers, and frontend code.
 */
function activeFields(fields: AutoCodeField[]): AutoCodeField[] {
  return fields.filter((f) => !f.removed);
}

// ---------------------------------------------------------------------------
// Direct SQL DDL helpers (replaces drizzle-kit push to avoid TTY requirement)
// ---------------------------------------------------------------------------

function toSqlColumnDef(field: AutoCodeField): string {
  let colType: string;
  switch (field.type) {
    case 'varchar':
    case 'image':
    case 'file':
      colType = `varchar(${field.length || (field.type !== 'varchar' ? 512 : 255)})`;
      break;
    case 'dict':
      colType = `varchar(${field.length || 64})`;
      break;
    case 'text':
      colType = 'text';
      break;
    case 'integer':
      colType = 'integer';
      break;
    case 'bigint':
      colType = 'bigint';
      break;
    case 'decimal':
      colType = 'numeric(12,2)';
      break;
    case 'boolean':
      colType = 'boolean';
      break;
    case 'timestamp':
      colType = 'timestamptz';
      break;
    case 'uuid':
      colType = 'uuid';
      break;
    case 'relation':
      if (field.relationType === 'one-to-many') return '';
      colType = 'uuid';
      break;
    default:
      colType = 'varchar(255)';
  }
  const notNull = field.required ? ' NOT NULL' : '';
  return `  "${field.name}" ${colType}${notNull}`;
}

function buildCreateTableSql(tableName: string, fields: AutoCodeField[], fkName?: string, fkRef?: string): string {
  const cols: string[] = [`  "id" uuid DEFAULT gen_random_uuid() PRIMARY KEY`];
  for (const f of fields) {
    if (f.removed || f.type === 'relation') continue;
    const colDef = toSqlColumnDef(f);
    if (colDef) cols.push(colDef);
  }
  // many-to-one FK columns
  for (const f of fields) {
    if (f.type === 'relation' && f.relationType === 'many-to-one' && f.name) {
      cols.push(`  "${f.name}" uuid`);
    }
  }
  if (fkName && fkRef) {
    cols.push(`  "${fkName}" uuid NOT NULL REFERENCES "${fkRef}"("id")`);
  }
  cols.push(`  "created_at" timestamptz NOT NULL DEFAULT now()`);
  cols.push(`  "updated_at" timestamptz NOT NULL DEFAULT now()`);
  cols.push(`  "deleted_at" timestamptz`);
  cols.push(`  "created_by" uuid`);
  cols.push(`  "updated_by" uuid`);
  return `CREATE TABLE IF NOT EXISTS "${tableName}" (\n${cols.join(',\n')}\n)`;
}

// ---------------------------------------------------------------------------
// Derived names for a table definition
// ---------------------------------------------------------------------------

interface DerivedNames {
  tableName: string;
  pascalName: string;
  pascalSingular: string;
  camelName: string;
  camelSingular: string;
  kebabName: string;
  kebabSingular: string;
  routePath: string;
  schemaVar: string;
  schemaType: string;
}

function deriveNames(tableName: string): DerivedNames {
  const pascalName = toPascalCase(tableName);
  const pascalSingular = toPascalCase(singularize(tableName));
  const camelName = toCamelCase(tableName);
  const camelSingular = toCamelCase(singularize(tableName));
  const kebabName = toKebabCase(tableName);
  const kebabSingular = toKebabCase(singularize(tableName));
  const routePath = `/lc/${kebabName}`;

  return {
    tableName,
    pascalName,
    pascalSingular,
    camelName,
    camelSingular,
    kebabName,
    kebabSingular,
    routePath,
    schemaVar: camelName,
    schemaType: pascalName,
  };
}

// ---------------------------------------------------------------------------
// Drizzle column type names for import filtering
// ---------------------------------------------------------------------------

function getDrizzleImportNames(field: AutoCodeField): string {
  switch (field.type) {
    case 'varchar': return 'varchar';
    case 'image': return 'varchar';
    case 'file': return 'varchar';
    case 'dict': return 'varchar';
    case 'text': return 'text';
    case 'integer': return 'integer';
    case 'bigint': return 'bigint';
    case 'decimal': return 'numeric';
    case 'boolean': return 'boolean';
    case 'timestamp': return 'timestamp';
    case 'uuid': return 'uuid';
    case 'relation': return 'uuid';
    default: return 'varchar';
  }
}

// ---------------------------------------------------------------------------
// Class-validator decorators for DTO fields
// ---------------------------------------------------------------------------

function getValidatorDecorators(field: AutoCodeField, forCreate: boolean): string {
  const lines: string[] = [];

  if (forCreate && field.required) {
    lines.push('  @IsNotEmpty()');
  } else {
    lines.push('  @IsOptional()');
  }

  switch (field.type) {
    case 'varchar':
    case 'text':
    case 'image':
    case 'file':
    case 'dict':
      lines.push('  @IsString()');
      break;
    case 'integer':
    case 'bigint':
    case 'decimal':
      lines.push('  @IsNumber()');
      lines.push('  @Type(() => Number)');
      break;
    case 'boolean':
      lines.push('  @IsBoolean()');
      lines.push('  @Type(() => Boolean)');
      break;
    case 'uuid':
    case 'relation':
      lines.push('  @IsUUID()');
      break;
    case 'timestamp':
      lines.push('  @IsString()');
      break;
  }

  if (field.type === 'varchar' && field.length) {
    lines.push(`  @MaxLength(${field.length})`);
  }

  if (field.type === 'image' || field.type === 'file') {
    lines.push('  @MaxLength(512)');
  }

  return lines.join('\n');
}

// ---------------------------------------------------------------------------
// Swagger decorators for DTO fields
// ---------------------------------------------------------------------------

function getSwaggerProp(field: AutoCodeField, forCreate: boolean): string {
  const parts: string[] = [];
  const decorator = forCreate && field.required ? '@ApiProperty' : '@ApiPropertyOptional';

  const opts: string[] = [];
  opts.push(`description: '${field.description || field.name}'`);

  if (field.type === 'varchar' && field.length) {
    opts.push(`maxLength: ${field.length}`);
  }

  if (field.type === 'image' || field.type === 'file') {
    opts.push(`maxLength: 512`);
  }

  parts.push(`  ${decorator}({ ${opts.join(', ')} })`);
  return parts.join('\n');
}

// ---------------------------------------------------------------------------
// Form field configuration for frontend page
// ---------------------------------------------------------------------------

function getProFormComponent(field: AutoCodeField): string {
  switch (field.type) {
    case 'text':
      return 'ProFormTextArea';
    case 'boolean':
      return 'ProFormSwitch';
    case 'image':
    case 'file':
      return 'Upload';
    case 'integer':
    case 'bigint':
    case 'decimal':
      return 'ProFormDigit';
    case 'relation':
    case 'dict':
      return 'ProFormSelect';
    default:
      return 'ProFormText';
  }
}

function getValueType(field: AutoCodeField): string {
  switch (field.type) {
    case 'timestamp':
      return 'dateTime';
    case 'boolean':
      return 'switch';
    case 'image':
      return 'image';
    case 'file':
      return 'text';
    case 'relation':
      return 'text';
    case 'dict':
      return 'select';
    default:
      return 'text';
  }
}

// ---------------------------------------------------------------------------
// Async generate job types
// ---------------------------------------------------------------------------

export type GenerateStepStatus = 'pending' | 'running' | 'completed' | 'failed';

export interface GenerateStep {
  key: string;
  label: string;
  status: GenerateStepStatus;
}

export interface GenerateJobStatus {
  jobId: string;
  status: 'processing' | 'completed' | 'failed';
  steps: GenerateStep[];
  progress: number; // 0-100
  currentStepLabel: string;
  result?: Record<string, any>;
  error?: string;
  completedAt?: string;
}

// ---------------------------------------------------------------------------
// Service
// ---------------------------------------------------------------------------

@Injectable()
export class AutocodeService {
  private readonly logger = new Logger(AutocodeService.name);

  constructor(
    @Inject(DATABASE_CONNECTION) private readonly db: DrizzleDb,
    @Inject(CASBIN_SERVICE_TOKEN) private readonly casbin: ICasbinService,
  ) {}

  // =========================================================================
  // File generators — each returns a string of TypeScript/TSX code
  // =========================================================================

  /**
   * Generate Drizzle pgTable schema definition.
   */
  generateSchema(dto: AutoCodeDto): string {
    const n = deriveNames(dto.tableName);
    const fieldLines: string[] = ["    id: uuid('id').defaultRandom().primaryKey(),"];

    // Collect relation fields for generating references
    const relationFields = dto.fields.filter((f) => f.type === 'relation');
    const manyToOneFields = relationFields.filter((f) => f.relationType === 'many-to-one');
    const manyToManyFields = relationFields.filter((f) => f.relationType === 'many-to-many');
    const oneToManyFields = relationFields.filter((f) => f.relationType === 'one-to-many');

    for (const field of dto.fields) {
      // Skip one-to-many fields -- no column in the main table
      if (field.type === 'relation' && field.relationType === 'one-to-many') {
        continue;
      }
      // Skip 'id' field — already defined as uuid primary key above
      if (field.name === 'id') {
        continue;
      }

      // Soft-removed fields: keep column as comment to preserve DB structure
      if (field.removed) {
        const drizzleType = toDrizzleType(field);
        const required = toRequired(field);
        const defaultVal = toDefaultValue(field);
        fieldLines.push(`    // [removed] ${field.name}: ${drizzleType}${required}${defaultVal},`);
        continue;
      }

      const drizzleType = toDrizzleType(field);
      const required = toRequired(field);
      const defaultVal = toDefaultValue(field);

      // Add .references() for many-to-one relation fields
      let referencesClause = '';
      if (field.type === 'relation' && (field.relationType === 'many-to-one' || field.relationType === 'many-to-many') && field.relationTable) {
        const targetNames = deriveNames(field.relationTable);
        referencesClause = `.references(() => ${targetNames.schemaVar}.id)`;
      }

      fieldLines.push(`    ${field.name}: ${drizzleType}${required}${defaultVal}${referencesClause},`);
    }

    fieldLines.push("    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),");
    fieldLines.push("    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),");
    fieldLines.push("    deletedAt: timestamp('deleted_at', { withTimezone: true }),");
    fieldLines.push("    createdBy: uuid('created_by'),");
    fieldLines.push("    updatedBy: uuid('updated_by'),");

    const uniqueFields = dto.fields.filter((f) => f.unique && !(f.type === 'relation' && (f.relationType === 'one-to-many')));
    let extraClause = '';
    if (uniqueFields.length > 0) {
      const uniqueIndexes = uniqueFields.map((f) => {
        return `    uniqueIndex('idx_${dto.tableName}_${f.name}_active')\n      .on(t.${f.name})\n      .where(sql\`\${t.deletedAt} IS NULL\`),`;
      });
      extraClause = `\n  (t) => [\n${uniqueIndexes.join('\n')}\n  ],`;
    }

    // Collect unique drizzle types to import
    const usedTypes = new Set<string>();
    usedTypes.add('uuid');
    for (const field of dto.fields) {
      if (field.type === 'relation' && field.relationType === 'one-to-many') continue;
      usedTypes.add(getDrizzleImportNames(field));
    }
    // Collect drizzle types from one-to-many detailFields
    for (const field of oneToManyFields) {
      for (const df of field.detailFields || []) {
        usedTypes.add(getDrizzleImportNames(df));
      }
    }
    usedTypes.add('timestamp');
    const sortedTypes = Array.from(usedTypes).sort();
    const typeImports = sortedTypes.map((t) => `  ${t},`).join('\n');

    const sqlImport = uniqueFields.length > 0 ? 'import { sql } from \'drizzle-orm\';\n' : '';
    const uniqueIndexImport = uniqueFields.length > 0 ? '  uniqueIndex,\n' : '';

    // Build imports for target table schemas (many-to-one + many-to-many references)
    const relationImports: string[] = [];
    for (const field of [...manyToOneFields, ...manyToManyFields]) {
      if (field.relationTable) {
        const targetNames = deriveNames(field.relationTable);
        relationImports.push(`import { ${targetNames.schemaVar} } from './${targetNames.kebabName}';`);
      }
    }

    // Build child table schemas for one-to-many relations
    let childTableSchemas = '';
    let existingTableSchemaImports = '';
    for (const field of oneToManyFields) {
      if (!field.detailFields || field.detailFields.length === 0) continue;
      const singularMain = singularize(dto.tableName);

      // When relationExistingTable is true, reference an existing table instead of creating a new one
      const isExisting = !!(field.relationExistingTable && field.relationTable && field.relationFkColumn);
      if (isExisting) {
        const targetNames = deriveNames(field.relationTable!);
        existingTableSchemaImports += `import { ${targetNames.schemaVar} } from './${targetNames.kebabName}';\n`;
        // FK already defined on the existing table — skip pgTable generation
        continue;
      }

      const singularField = singularize(field.name);
      const childTableName = `${singularMain}_${singularField}`;
      const childSchemaVar = toCamelCase(childTableName);
      const childPascalType = toPascalCase(childTableName);
      const fkColName = `${toCamelCase(singularMain)}_id`;

      const childFieldLines = ["    id: uuid('id').defaultRandom().primaryKey(),"];
      for (const df of field.detailFields) {
        if (!df.name || df.name === 'id') continue;
        const drizzleType = toDrizzleType(df);
        const required = toRequired(df);
        const defaultVal = toDefaultValue(df);
        childFieldLines.push(`    ${df.name}: ${drizzleType}${required}${defaultVal},`);
      }
      // FK back to master
      childFieldLines.push(`    ${fkColName}: uuid('${fkColName}').notNull().references(() => ${n.schemaVar}.id),`);
      childFieldLines.push("    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),");
      childFieldLines.push("    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),");
      childFieldLines.push("    deletedAt: timestamp('deleted_at', { withTimezone: true }),");

      childTableSchemas += `

export const ${childSchemaVar} = pgTable(
  'lc_${childTableName}',
  {
${childFieldLines.join('\n')}
  },
);

export type ${childPascalType} = typeof ${childSchemaVar}.$inferSelect;
export type New${childPascalType} = typeof ${childSchemaVar}.$inferInsert;
`;
    }

    // Combine all imports (include existing-table schema imports for one-to-many)
    const allRelationImports = [...new Set([...relationImports, existingTableSchemaImports])].join('\n');
    const relationImportBlock = allRelationImports ? '\n' + allRelationImports : '';

    return `${sqlImport}import {
  pgTable,
${typeImports}
${uniqueIndexImport}} from 'drizzle-orm/pg-core';
${relationImportBlock}

export const ${n.schemaVar} = pgTable(
  'lc_${dto.tableName}',
  {
${fieldLines.join('\n')}
  },${extraClause}
);

export type ${n.schemaType} = typeof ${n.schemaVar}.$inferSelect;
export type New${n.schemaType} = typeof ${n.schemaVar}.$inferInsert;
${childTableSchemas}`;
  }

  /**
   * Generate Create DTO class.
   */
  generateCreateDto(dto: AutoCodeDto): string {
    const n = deriveNames(dto.tableName);
    const creatableFields = dto.fields.filter((f) => f.creatable);

    const fieldStrings = creatableFields.map((f) => {
      const swagger = getSwaggerProp(f, true);
      const validators = getValidatorDecorators(f, true);
      // In DTO layer: decimal is number (from JSON request body)
      // relation fields are UUID strings
      const dtoType = f.type === 'boolean' ? 'boolean' : f.type === 'integer' || f.type === 'bigint' || f.type === 'decimal' ? 'number' : 'string';
      const typeInit = f.type === 'boolean' ? 'false' : f.type === 'integer' || f.type === 'bigint' || f.type === 'decimal' ? '0' : "''";

      // For one-to-many relation fields, use array of objects (detail rows)
      if (f.type === 'relation' && f.relationType === 'one-to-many') {
        const arraySwagger = `  @ApiPropertyOptional({ description: '${f.description || f.name}', type: [Object] })`;
        const arrayValidator = '  @IsOptional()\n  @IsArray()';
        return `${arraySwagger}\n${arrayValidator}\n  ${f.name}: any[] = [];`;
      }

      return `${swagger}\n${validators}\n  ${f.name}: ${dtoType} = ${typeInit};`;
    });

    const needsNumber = creatableFields.some((f) => f.type === 'integer' || f.type === 'bigint' || f.type === 'decimal');
    const needsBoolean = creatableFields.some((f) => f.type === 'boolean');
    const needsUuid = creatableFields.some((f) => f.type === 'uuid' || f.type === 'relation');
    const needsArray = creatableFields.some((f) => f.type === 'relation' && (f.relationType === 'one-to-many'));
    const needsType = needsNumber || needsBoolean;

    // Build single consolidated class-validator import
    const validatorNames: string[] = [];
    // Always include these
    if (creatableFields.some((f) => f.required)) {
      validatorNames.push('IsNotEmpty');
    }
    if (creatableFields.some((f) => !f.required)) {
      validatorNames.push('IsOptional');
    }
    if (creatableFields.some((f) => f.type === 'varchar' || f.type === 'text' || f.type === 'timestamp' || f.type === 'image' || f.type === 'file' || f.type === 'dict')) {
      validatorNames.push('IsString');
    }
    if (needsNumber) {
      validatorNames.push('IsNumber');
    }
    if (needsBoolean) {
      validatorNames.push('IsBoolean');
    }
    if (needsUuid) {
      validatorNames.push('IsUUID');
    }
    if (needsArray) {
      validatorNames.push('IsArray');
    }
    // MaxLength for varchar fields and image/file fields
    if (creatableFields.some((f) => (f.type === 'varchar' && f.length) || f.type === 'image' || f.type === 'file')) {
      validatorNames.push('MaxLength');
    }

    const imports: string[] = [];
    imports.push(`import { ${validatorNames.join(', ')} } from 'class-validator';`);
    if (needsType) {
      imports.push("import { Type } from 'class-transformer';");
    }
    imports.push("import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';");
    imports.push('');

    return `${imports.join('\n')}
export class Create${n.pascalSingular}Dto {
${fieldStrings.join('\n\n')}
}
`;
  }

  /**
   * Generate Query DTO class.
   */
  generateQueryDto(dto: AutoCodeDto): string {
    const n = deriveNames(dto.tableName);
    const searchableFields = dto.fields.filter((f) => f.searchable);

    const isNumericType = (f: AutoCodeField) => f.type === 'integer' || f.type === 'bigint' || f.type === 'decimal';

    const fieldStrings = searchableFields.flatMap((f) => {
      if (f.type === 'relation') {
        return [`  @ApiPropertyOptional()\n  @IsOptional()\n  @IsUUID()\n  ${f.name}?: string;`];
      }
      // Numeric types → min/max range
      if (isNumericType(f)) {
        const numValidator = f.type === 'decimal' ? '@IsNumber()' : '@IsInt()';
        return [
          `  @ApiPropertyOptional({ description: '${f.description || f.name}最小值' })\n  @IsOptional()\n  @Type(() => Number)\n  ${numValidator}\n  ${f.name}Min?: number;`,
          `  @ApiPropertyOptional({ description: '${f.description || f.name}最大值' })\n  @IsOptional()\n  @Type(() => Number)\n  ${numValidator}\n  ${f.name}Max?: number;`,
        ];
      }
      return [`  @ApiPropertyOptional()\n  @IsOptional()\n  @IsString()\n  ${f.name}?: string;`];
    });

    const needsUuid = searchableFields.some((f) => f.type === 'relation');
    const needsArray = searchableFields.some((f) => f.type === 'relation' && f.relationType === 'one-to-many');
    const needsNumeric = searchableFields.some((f) => isNumericType(f));
    const needsDecimal = searchableFields.some((f) => f.type === 'decimal');
    const validatorNames: string[] = ['IsOptional', 'IsString'];
    if (needsUuid) validatorNames.push('IsUUID');
    if (needsArray) validatorNames.push('IsArray');
    if (needsNumeric && !needsDecimal) validatorNames.push('IsInt');
    if (needsNumeric && needsDecimal) validatorNames.push('IsInt', 'IsNumber');
    const needsType = needsNumeric;

    return `import { ${validatorNames.join(', ')} } from 'class-validator';
${needsType ? "import { Type } from 'class-transformer';\n" : ''}import { ApiPropertyOptional } from '@nestjs/swagger';
import { PaginationDto } from '../../../common/dto/pagination.dto';

export class Query${n.pascalSingular}Dto extends PaginationDto {
${fieldStrings.join('\n\n')}
}
`;
  }

  /**
   * Generate Update DTO class.
   */
  generateUpdateDto(dto: AutoCodeDto): string {
    const n = deriveNames(dto.tableName);

    return `import { PartialType } from '@nestjs/swagger';
import { Create${n.pascalSingular}Dto } from './create-${n.kebabSingular}.dto';

export class Update${n.pascalSingular}Dto extends PartialType(Create${n.pascalSingular}Dto) {}
`;
  }

  /**
   * Generate NestJS CRUD service.
   */
  generateService(dto: AutoCodeDto): string {
    const n = deriveNames(dto.tableName);
    const searchableFields = dto.fields.filter((f) => f.searchable);
    const uniqueFields = dto.fields.filter((f) => f.unique && !(f.type === 'relation' && (f.relationType === 'one-to-many')));
    const relationFields = dto.fields.filter((f) => f.type === 'relation');
    const manyToManyFields: AutoCodeField[] = []; // M2M merged into manyToOneFields
    const oneToManyFields = relationFields.filter((f) => f.relationType === 'one-to-many');
    const manyToOneFields = relationFields.filter((f) => f.relationType === 'many-to-one' || f.relationType === 'many-to-many');
    // Pre-compute schema var names imported from many-to-one target tables to detect destructuring collisions
    const manyToOneSchemaVars = new Set(manyToOneFields.filter(f => f.relationTable).map(f => deriveNames(f.relationTable!).schemaVar));

    // Query filter generation
    // If a field name collides with the schema table variable name, rename it in destructuring
    const isNumericField = (f: AutoCodeField) => f.type === 'integer' || f.type === 'bigint' || f.type === 'decimal';
    const fieldAlias = (name: string) => (name === n.schemaVar || manyToOneSchemaVars.has(name)) ? `${name}Filter` : name;
    let queryFilters = '';
    for (const field of searchableFields) {
      if (field.type === 'relation' && field.relationType === 'one-to-many') {
        continue;
      }
      const alias = fieldAlias(field.name);
      if (isNumericField(field)) {
        const numWrap = field.type === 'decimal' ? 'String' : '';
        const minVal = numWrap ? `String(${alias}Min)` : alias + 'Min';
        const maxVal = numWrap ? `String(${alias}Max)` : alias + 'Max';
        queryFilters += `    if (${alias}Min) {\n      conditions.push(gte(${n.schemaVar}.${field.name}, ${minVal}));\n    }\n`;
        queryFilters += `    if (${alias}Max) {\n      conditions.push(lte(${n.schemaVar}.${field.name}, ${maxVal}));\n    }\n`;
      } else if (field.type === 'varchar' || field.type === 'text') {
        queryFilters += `    if (${alias}) {\n      conditions.push(like(${n.schemaVar}.${field.name}, \`%\$\{${alias}\}%\`));\n    }\n`;
      } else {
        queryFilters += `    if (${alias}) {\n      conditions.push(eq(${n.schemaVar}.${field.name}, ${alias}));\n    }\n`;
      }
    }

    // Update data builder
    const updateFields = dto.fields.filter((f) => f.editable && !(f.type === 'relation' && (f.relationType === 'one-to-many')));
    let updateDataBuilder = '';
    for (const field of updateFields) {
      const valueExpr = field.type === 'decimal' ? `String(dto.${field.name})` : `dto.${field.name}`;
      updateDataBuilder += `    if (dto.${field.name} !== undefined) updateData.${field.name} = ${valueExpr};\n`;
    }

    // Conflict checks for unique fields on create
    let uniqueChecks = '';
    for (const field of uniqueFields) {
      if (field.required) {
        uniqueChecks += `    // Check unique: ${field.name}
    const existingBy${toPascalCase(field.name)} = await this.db
      .select()
      .from(${n.schemaVar})
      .where(and(eq(${n.schemaVar}.${field.name}, dto.${field.name}), isNull(${n.schemaVar}.deletedAt)))
      .limit(1);

    if (existingBy${toPascalCase(field.name)}.length > 0) {
      throw new ConflictException({
        code: ApiErrorCode.PARAM_ERROR,
        message: \`${toPascalCase(field.name)} '\$\{dto.${field.name}\}' is already taken\`,
      });
    }
`;
      } else {
        uniqueChecks += `    // Check unique: ${field.name} (only if value provided)
    if (dto.${field.name}) {
      const existingBy${toPascalCase(field.name)} = await this.db
        .select()
        .from(${n.schemaVar})
        .where(and(eq(${n.schemaVar}.${field.name}, dto.${field.name}!), isNull(${n.schemaVar}.deletedAt)))
        .limit(1);

      if (existingBy${toPascalCase(field.name)}.length > 0) {
        throw new ConflictException({
          code: ApiErrorCode.PARAM_ERROR,
          message: \`${toPascalCase(field.name)} '\$\{dto.${field.name}\}' is already taken\`,
        });
      }
    }
`;
      }
    }

    // Conflict checks for unique fields on update
    let updateUniqueChecks = '';
    for (const field of updateFields.filter((f) => f.unique)) {
      updateUniqueChecks += `    if (dto.${field.name} && dto.${field.name} !== existing.${field.name}) {
      const ${field.name}Conflict = await this.db
        .select()
        .from(${n.schemaVar})
        .where(and(eq(${n.schemaVar}.${field.name}, dto.${field.name}), isNull(${n.schemaVar}.deletedAt)))
        .limit(1);

      if (${field.name}Conflict.length > 0) {
        throw new ConflictException({
          code: ApiErrorCode.PARAM_ERROR,
          message: \`${toPascalCase(field.name)} '\$\{dto.${field.name}\}' is already taken\`,
        });
      }
    }
`;
    }

    // Creatable fields for create values (exclude many-to-many and one-to-many)
    const creatableFields = dto.fields.filter((f) => f.creatable && !(f.type === 'relation' && (f.relationType === 'one-to-many')));

    // Editable fields for update type definition (exclude many-to-many and one-to-many)
    const editableFields = dto.fields.filter((f) => f.editable && !(f.type === 'relation' && (f.relationType === 'one-to-many')));
    // Build child table methods for one-to-many
    let childImports = '';
    let childMethods = '';
    for (const field of oneToManyFields) {
      if (!field.detailFields || field.detailFields.length === 0) continue;
      const singularMain = singularize(dto.tableName);
      const isExisting = !!(field.relationExistingTable && field.relationTable && field.relationFkColumn);

      let childSchemaVar: string;
      let fkColName: string;
      if (isExisting) {
        childSchemaVar = deriveNames(field.relationTable!).schemaVar;
        fkColName = field.relationFkColumn!;
        childImports += `import { ${childSchemaVar} } from '../../db/schema/${deriveNames(field.relationTable!).kebabName}';\n`;
      } else {
        const singularField = singularize(field.name);
        childSchemaVar = toCamelCase(`${singularMain}_${singularField}`);
        fkColName = `${toCamelCase(singularMain)}_id`;
        childImports += `import { ${childSchemaVar} } from '../../db/schema/${n.kebabName}';\n`;
      }
      const detailCols = field.detailFields.filter(df => df.name !== 'id' && !(df.type === 'relation' && df.relationTable === dto.tableName));
      const childRelFields = (field.detailFields || []).filter(df => df.name !== 'id' && df.type === 'relation' && df.relationTable && df.relationTable !== dto.tableName);

      // Build leftJoin for child's own FK fields (e.g. score.course → course.name)
      let childRelImports = '';
      let childRelSelectFields = '';
      let childRelJoins = '';
      for (const crf of childRelFields) {
        const crfTarget = deriveNames(crf.relationTable!);
        const crfDisplay = crf.relationDisplayField || 'name';
        childRelImports += `import { ${crfTarget.schemaVar} } from '../../db/schema/${crfTarget.kebabName}';\n`;
        childRelSelectFields += `\n      ${crf.name}_display: ${crfTarget.schemaVar}.${crfDisplay},`;
        childRelJoins += `\n        .leftJoin(${crfTarget.schemaVar}, eq(${childSchemaVar}.${crf.name}, ${crfTarget.schemaVar}.id))`;
      }
      if (childRelImports) childImports += childRelImports;

      // When there are display joins, list all raw columns explicitly
      const getSelectExpr = childRelSelectFields
        ? `{\n      ${detailCols.map((c: any) => `${c.name}: ${childSchemaVar}.${c.name},\n      `).join('')}${childRelSelectFields}\n    }`
        : '';
      childMethods += `
  async get${toPascalCase(field.name)}(${fkColName}: string): Promise<any[]> {
    return this.db
      .select(${getSelectExpr || ''})
      .from(${childSchemaVar})${childRelJoins}
      .where(and(eq(${childSchemaVar}.${fkColName}, ${fkColName}), isNull(${childSchemaVar}.deletedAt)));
  }

  async create${toPascalCase(field.name)}(${fkColName}: string, details: any[]): Promise<void> {
    if (details.length === 0) return;
    const values = details.map((d) => ({
      ${fkColName},
      ${detailCols.map(c => c.type === 'decimal' ? `${c.name}: String(d.${c.name})` : c.type === 'timestamp' ? `${c.name}: d.${c.name} ? new Date(d.${c.name}) : null` : `${c.name}: d.${c.name}`).join(',\n      ')},
    }));
    await this.db.insert(${childSchemaVar}).values(values);
  }

  async update${toPascalCase(field.name)}(${fkColName}: string, details: any[]): Promise<void> {
    const existing = await this.get${toPascalCase(field.name)}(${fkColName});
    const existingIds = new Set(existing.map((r) => r.id));
    const incomingIds = new Set(details.filter((d) => d.id).map((d) => d.id));

    // Soft-delete rows no longer present
    const toDelete = existing.filter((r) => !incomingIds.has(r.id));
    if (toDelete.length > 0) {
      await this.db
        .update(${childSchemaVar})
        .set({ deletedAt: sql\`NOW()\` })
        .where(and(inArray(${childSchemaVar}.id, toDelete.map((r) => r.id)), isNull(${childSchemaVar}.deletedAt)));
    }

    // Update existing rows
    for (const d of details.filter((d) => d.id && existingIds.has(d.id))) {
      await this.db
        .update(${childSchemaVar})
        .set({
          ${detailCols.map(c => c.type === 'decimal' ? `${c.name}: String(d.${c.name})` : c.type === 'timestamp' ? `${c.name}: d.${c.name} ? new Date(d.${c.name}) : null` : `${c.name}: d.${c.name}`).join(',\n          ')},
          updatedAt: sql\`NOW()\`,
        })
        .where(eq(${childSchemaVar}.id, d.id));
    }

    // Insert new rows (no id or temp id)
    const newRows = details.filter((d) => !d.id);
    if (newRows.length > 0) {
      await this.create${toPascalCase(field.name)}(${fkColName}, newRows);
    }
  }

  async remove${toPascalCase(field.name)}(${fkColName}: string): Promise<void> {
    await this.db
      .update(${childSchemaVar})
      .set({ deletedAt: sql\`NOW()\` })
      .where(and(eq(${childSchemaVar}.${fkColName}, ${fkColName}), isNull(${childSchemaVar}.deletedAt)));
  }
`;
    }

    // Build 1:N batch-attach code for findAll
    const oneToManyAttachInFindAll = oneToManyFields.length > 0 ? `
    // Batch-attach child detail rows
    if (rows.length > 0) {
      const masterIds = rows.map((r) => r.id);
${oneToManyFields.map((field) => {
  const singularMain = singularize(dto.tableName);
  const isExisting = !!(field.relationExistingTable && field.relationTable && field.relationFkColumn);
  const childSchemaVar = isExisting
    ? deriveNames(field.relationTable!).schemaVar
    : toCamelCase(`${singularMain}_${singularize(field.name)}`);
  const fkColName = isExisting
    ? field.relationFkColumn!
    : `${toCamelCase(singularMain)}_id`;
      // Build leftJoin + _display select for child FK fields in batch-attach
      const detailCols = (field.detailFields || []).filter(df => df.name !== 'id' && !(df.type === 'relation' && df.relationTable === dto.tableName));
      const childBatchRelFields2 = (field.detailFields || []).filter(df => df.name !== 'id' && df.type === 'relation' && df.relationTable && df.relationTable !== dto.tableName);
      let childBatchRelSelect2 = '';
      let childBatchRelJoins2 = '';
      for (const crf2 of childBatchRelFields2) {
        const crf2Target = deriveNames(crf2.relationTable!);
        const crf2Display = crf2.relationDisplayField || 'name';
        childBatchRelSelect2 += `\n          ${crf2.name}_display: ${crf2Target.schemaVar}.${crf2Display},`;
        childBatchRelJoins2 += `\n            .leftJoin(${crf2Target.schemaVar}, eq(${childSchemaVar}.${crf2.name}, ${crf2Target.schemaVar}.id))`;
      }
      // When there are display joins, list all needed raw columns explicitly
      const batchSelectExpr = childBatchRelSelect2
        ? `{\n          id: ${childSchemaVar}.id,\n          ${fkColName}: ${childSchemaVar}.${fkColName},${detailCols.map((c: any) => `\n          ${c.name}: ${childSchemaVar}.${c.name},`).join('')}${childBatchRelSelect2}\n        }`
        : '';
	  return `      const ${field.name}Rows = await this.db
        .select(${batchSelectExpr || ''})
        .from(${childSchemaVar})${childBatchRelJoins2}
        .where(and(inArray(${childSchemaVar}.${fkColName}, masterIds), isNull(${childSchemaVar}.deletedAt)));
      const ${field.name}ByMaster = new Map<string, any[]>();
      for (const row of ${field.name}Rows) {
        if (row.${fkColName} == null) continue;
        const arr = ${field.name}ByMaster.get(row.${fkColName}) || [];
        arr.push(row);
        ${field.name}ByMaster.set(row.${fkColName}, arr);
      }
      for (const row of rows) {
        (row as any).${field.name} = ${field.name}ByMaster.get(row.id) || [];
      }`;
}).join('\n')}
    }
` : '';

    // Build 1:N attach code for findOne
    const oneToManyAttachInFindOne = oneToManyFields.map((field) => `    (rows[0] as any).${field.name} = await this.get${toPascalCase(field.name)}(id);`).join('\n');

    // Build 1:N child cleanup in remove
    const oneToManyRemoveCleanup = oneToManyFields.map((field) => `    await this.remove${toPascalCase(field.name)}(id);
`).join('');

    // Build 1:N child cleanup in batchRemove
    const oneToManyBatchRemoveCleanup = oneToManyFields.length > 0 ? `    // Remove child detail rows for each id
    for (const id of ids) {
      try {
${oneToManyFields.map((field) => `        await this.remove${toPascalCase(field.name)}(id);`).join('\n')}
      } catch {
        // Record may not exist, ignore
      }
    }
` : '';

    // Build many-to-one join helpers
    const hasManyToOne = manyToOneFields.length > 0;
    let manyToOneSchemaImports = '';
    let manyToOneSelectFields = '';
    let manyToOneJoins = '';
    for (const f of manyToOneFields) {
      if (!f.relationTable) continue;
      const targetNames = deriveNames(f.relationTable);
      const displayField = f.relationDisplayField || 'name';
      manyToOneSchemaImports += `import { ${targetNames.schemaVar} } from '../../db/schema/${targetNames.kebabName}';\n`;
      manyToOneSelectFields += `\n      ${f.name}_display: ${targetNames.schemaVar}.${displayField},`;
      manyToOneJoins += `\n        .leftJoin(${targetNames.schemaVar}, eq(${n.schemaVar}.${f.name}, ${targetNames.schemaVar}.id))`;
    }

    return `import {
  Injectable,
  Inject,
  NotFoundException,
  ConflictException,
} from '@nestjs/common';
import { eq, and, isNull, like, sql, count, inArray, gte, lte, desc${hasManyToOne ? ', getTableColumns' : ''} } from 'drizzle-orm';
import { DATABASE_CONNECTION, DrizzleDb } from '../../db/connection';
import { ${n.schemaVar}, ${n.schemaType} } from '../../db/schema/${n.kebabName}';
${manyToOneSchemaImports}${childImports}import { Create${n.pascalSingular}Dto } from './dto/create-${n.kebabSingular}.dto';
import { Update${n.pascalSingular}Dto } from './dto/update-${n.kebabSingular}.dto';
import { Query${n.pascalSingular}Dto } from './dto/query-${n.kebabSingular}.dto';
import { ApiErrorCode, PaginatedData } from '@lowcode/shared';
import { SQL } from 'drizzle-orm';

@Injectable()
export class ${n.pascalSingular}Service {
  constructor(
    @Inject(DATABASE_CONNECTION) private readonly db: DrizzleDb,
  ) {}

  async findAll(query: Query${n.pascalSingular}Dto): Promise<PaginatedData<${n.schemaType}>> {
    const { page, pageSize${(() => {
      const names = searchableFields
        .filter(f => !(f.type === 'relation' && (f.relationType === 'one-to-many')))
        .flatMap(f => isNumericField(f) ? [`${f.name}Min`, `${f.name}Max`] : [f.name]);
      if (names.length === 0) return '';
      const parts = names.map(name => {
        const base = name.replace(/Min$|Max$/, '');
        const suffix = name.endsWith('Min') ? 'Min' : name.endsWith('Max') ? 'Max' : '';
        return (base === n.schemaVar || manyToOneSchemaVars.has(base)) ? `${name}: ${base}Filter${suffix}` : name;
      });
      return ', ' + parts.join(', ');
    })()} } = query;
    const offset = (page - 1) * pageSize;

    const conditions: SQL[] = [isNull(${n.schemaVar}.deletedAt)];

${queryFilters}
    const whereClause = and(...conditions);

    const [rows, totalRows] = await Promise.all([
      this.db
        .select(${hasManyToOne ? `{
          ...getTableColumns(${n.schemaVar}),${manyToOneSelectFields}
        }` : ``})
        .from(${n.schemaVar})${manyToOneJoins}
        .where(whereClause)
        .orderBy(desc(${n.schemaVar}.createdAt))
        .limit(pageSize)
        .offset(offset),
      this.db
        .select({ count: count() })
        .from(${n.schemaVar})
        .where(whereClause),
    ]);

    const total = totalRows[0]?.count ?? 0;
${oneToManyAttachInFindAll}
    return { list: rows, total, page, pageSize };
  }

  async findOne(id: string): Promise<${n.schemaType}> {
    const rows = await this.db
      .select(${hasManyToOne ? `{
        ...getTableColumns(${n.schemaVar}),${manyToOneSelectFields}
      }` : ``})
      .from(${n.schemaVar})${manyToOneJoins}
      .where(and(eq(${n.schemaVar}.id, id), isNull(${n.schemaVar}.deletedAt)))
      .limit(1);

    if (rows.length === 0) {
      throw new NotFoundException({
        code: ApiErrorCode.RESOURCE_NOT_FOUND,
        message: \`${n.pascalSingular} with id \$\{id\} not found\`,
      });
    }
${oneToManyAttachInFindOne}
    return rows[0]!;
  }

  async create(dto: Create${n.pascalSingular}Dto): Promise<${n.schemaType}> {
${uniqueChecks}${oneToManyFields.length > 0 ? `
    return this.db.transaction(async (tx) => {
      const rows = await tx
        .insert(${n.schemaVar})
        .values({
${creatableFields.map(f => f.type === 'decimal' ? `          ${f.name}: String(dto.${f.name}),` : `          ${f.name}: dto.${f.name},`).join('\n')}
        })
        .returning();
      const created = rows[0]!;
${oneToManyFields.map((field) => {
  const singularMain = singularize(dto.tableName);
  const isExisting = !!(field.relationExistingTable && field.relationTable && field.relationFkColumn);
  const childSchemaVar = isExisting
    ? deriveNames(field.relationTable!).schemaVar
    : toCamelCase(`${singularMain}_${singularize(field.name)}`);
  const fkColName = isExisting
    ? field.relationFkColumn!
    : `${toCamelCase(singularMain)}_id`;
  const detailCols = (field.detailFields || []).filter(df => df.name !== 'id' && !(df.type === 'relation' && df.relationTable === dto.tableName));
  return `      if (dto.${field.name} && (dto.${field.name} as any[]).length > 0) {
        await tx.insert(${childSchemaVar}).values(
          (dto.${field.name} as any[]).map((d: any) => ({
            ${fkColName}: created.id,
            ${detailCols.map(c => c.type === 'decimal' ? `${c.name}: String(d.${c.name})` : c.type === 'timestamp' ? `${c.name}: d.${c.name} ? new Date(d.${c.name}) : null` : `${c.name}: d.${c.name}`).join(',\n            ')},
          })),
        );
      }`;
}).join('\n')}
${manyToManyFields.map((f) => `      if (dto.${f.name} && dto.${f.name}.length > 0) {
        await this.add${toPascalCase(f.name)}(created.id, dto.${f.name});
      }`).join('\n')}
      return created;
    });` : `
    const rows = await this.db
      .insert(${n.schemaVar})
      .values({
${creatableFields.map(f => f.type === 'decimal' ? `        ${f.name}: String(dto.${f.name}),` : `        ${f.name}: dto.${f.name},`).join('\n')}
      })
      .returning();
${manyToManyFields.length > 0 ? `
    // Handle many-to-many relations after creation
    const created = rows[0]!;
` + manyToManyFields.map((f) => {
      return `    if (dto.${f.name} && dto.${f.name}.length > 0) {
      await this.add${toPascalCase(f.name)}(created.id, dto.${f.name});
    }`;
    }).join('\n') + `\n    return created;` : `    return rows[0]!;`}
`}
  }

  async update(id: string, dto: Update${n.pascalSingular}Dto): Promise<${n.schemaType}> {
    const existing = await this.findOne(id);

${updateUniqueChecks}
    type ${n.pascalSingular}UpdateFields = {
${editableFields.map(f => {
      const tsType = f.type === 'boolean' ? 'boolean' : f.type === 'integer' || f.type === 'bigint' ? 'number' : 'string';
      return `      ${f.name}?: ${tsType};`;
    }).join('\n')}
      updatedAt?: Date;
    };

    const updateData: ${n.pascalSingular}UpdateFields = {
      updatedAt: new Date(),
    };

${updateDataBuilder}
    const rows = await this.db
      .update(${n.schemaVar})
      .set(updateData)
      .where(and(eq(${n.schemaVar}.id, id), isNull(${n.schemaVar}.deletedAt)))
      .returning();
${manyToManyFields.length > 0 ? '\n' + manyToManyFields.map((f) => {
      return `    if (dto.${f.name} !== undefined) {
      // Replace all relations: remove existing, then add new ones
      const existing${toPascalCase(f.name)} = await this.get${toPascalCase(f.name)}(id);
      const existingIds = existing${toPascalCase(f.name)}.map((r) => r.id);
      if (existingIds.length > 0) {
        await this.remove${toPascalCase(f.name)}(id, existingIds);
      }
      if (dto.${f.name}!.length > 0) {
        await this.add${toPascalCase(f.name)}(id, dto.${f.name}!);
      }
    }`;
    }).join('\n') : ''}
${oneToManyFields.map((field) => `    if (dto.${field.name} !== undefined) {
      await this.update${toPascalCase(field.name)}(id, dto.${field.name} as any[]);
    }`).join('\n')}
    return rows[0]!;
  }

  async remove(id: string): Promise<void> {
    await this.findOne(id);

${oneToManyRemoveCleanup}${manyToManyFields.length > 0 ? manyToManyFields.map((f) => `    // Remove all ${f.name} relations before deleting
    const existing${toPascalCase(f.name)} = await this.get${toPascalCase(f.name)}(id);
    const existing${toPascalCase(f.name)}Ids = existing${toPascalCase(f.name)}.map((r) => r.id);
    if (existing${toPascalCase(f.name)}Ids.length > 0) {
      await this.remove${toPascalCase(f.name)}(id, existing${toPascalCase(f.name)}Ids);
    }
`).join('') : ''}
    await this.db
      .update(${n.schemaVar})
      .set({ deletedAt: sql\`NOW()\` })
      .where(and(eq(${n.schemaVar}.id, id), isNull(${n.schemaVar}.deletedAt)));
  }

  async batchRemove(ids: string[]): Promise<{ count: number }> {
${oneToManyBatchRemoveCleanup}${manyToManyFields.length > 0 ? `    // Remove all many-to-many relations for each id
    for (const id of ids) {
${manyToManyFields.map((f) => `      try {
        const existing${toPascalCase(f.name)} = await this.get${toPascalCase(f.name)}(id);
        const existing${toPascalCase(f.name)}Ids = existing${toPascalCase(f.name)}.map((r) => r.id);
        if (existing${toPascalCase(f.name)}Ids.length > 0) {
          await this.remove${toPascalCase(f.name)}(id, existing${toPascalCase(f.name)}Ids);
        }
      } catch {
        // Record may not exist, ignore
      }
`).join('')}    }
` : ''}
    const rows = await this.db
      .update(${n.schemaVar})
      .set({ deletedAt: sql\`NOW()\` })
      .where(and(inArray(${n.schemaVar}.id, ids), isNull(${n.schemaVar}.deletedAt)))
      .returning({ id: ${n.schemaVar}.id });

    return { count: rows.length };
  }
${childMethods}
}
`;
  }

  /**
   * Generate NestJS controller with REST endpoints.
   */
  generateController(dto: AutoCodeDto): string {
    const n = deriveNames(dto.tableName);

    return `import {
  Controller,
  Get,
  Post,
  Patch,
  Delete,
  Body,
  Param,
  Query,
  HttpCode,
  HttpStatus,
} from '@nestjs/common';
import {
  ApiTags,
  ApiBearerAuth,
  ApiOperation,
  ApiResponse,
} from '@nestjs/swagger';
import { ${n.pascalSingular}Service } from './${n.kebabSingular}.service';
import { Create${n.pascalSingular}Dto } from './dto/create-${n.kebabSingular}.dto';
import { Update${n.pascalSingular}Dto } from './dto/update-${n.kebabSingular}.dto';
import { Query${n.pascalSingular}Dto } from './dto/query-${n.kebabSingular}.dto';
import { BatchDeleteDto } from '../../common/dto/batch-delete.dto';
import {
  ApiResponse as ApiResp,
  PaginatedResponse,
} from '@lowcode/shared';
import { ${n.schemaType} } from '../../db/schema/${n.kebabName}';

@ApiTags('lc/${n.kebabName}')
@ApiBearerAuth()
@Controller('lc/${n.kebabName}')
export class ${n.pascalSingular}Controller {
  constructor(private readonly ${n.camelSingular}Service: ${n.pascalSingular}Service) {}

  @Get()
  @ApiOperation({ summary: 'Get paginated list of ${n.kebabName}' })
  @ApiResponse({ status: 200, description: 'Returns paginated ${n.kebabName}' })
  async findAll(@Query() query: Query${n.pascalSingular}Dto): Promise<PaginatedResponse<${n.schemaType}>> {
    const data = await this.${n.camelSingular}Service.findAll(query);
    return { code: 0, msg: 'success', data };
  }

  @Get(':id')
  @ApiOperation({ summary: 'Get ${n.kebabSingular} by id' })
  @ApiResponse({ status: 200, description: 'Returns the ${n.kebabSingular}' })
  @ApiResponse({ status: 404, description: '${n.pascalSingular} not found' })
  async findOne(@Param('id') id: string): Promise<ApiResp<${n.schemaType}>> {
    const data = await this.${n.camelSingular}Service.findOne(id);
    return { code: 0, msg: 'success', data };
  }

  @Post()
  @HttpCode(HttpStatus.CREATED)
  @ApiOperation({ summary: 'Create a new ${n.kebabSingular}' })
  @ApiResponse({ status: 201, description: '${n.pascalSingular} created successfully' })
  @ApiResponse({ status: 409, description: 'Unique constraint conflict' })
  async create(@Body() dto: Create${n.pascalSingular}Dto): Promise<ApiResp<${n.schemaType}>> {
    const data = await this.${n.camelSingular}Service.create(dto);
    return { code: 0, msg: 'success', data };
  }

  @Patch(':id')
  @ApiOperation({ summary: 'Update ${n.kebabSingular} by id' })
  @ApiResponse({ status: 200, description: '${n.pascalSingular} updated successfully' })
  @ApiResponse({ status: 404, description: '${n.pascalSingular} not found' })
  @ApiResponse({ status: 409, description: 'Unique constraint conflict' })
  async update(
    @Param('id') id: string,
    @Body() dto: Update${n.pascalSingular}Dto,
  ): Promise<ApiResp<${n.schemaType}>> {
    const data = await this.${n.camelSingular}Service.update(id, dto);
    return { code: 0, msg: 'success', data };
  }

  @Delete('batch')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Batch delete ${n.kebabName} by ids' })
  @ApiResponse({ status: 200, description: '${n.pascalName} deleted successfully' })
  async batchRemove(@Body() dto: BatchDeleteDto): Promise<ApiResp<{ count: number }>> {
    const data = await this.${n.camelSingular}Service.batchRemove(dto.ids);
    return { code: 0, msg: 'success', data };
  }

  @Delete(':id')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Delete ${n.kebabSingular} by id' })
  @ApiResponse({ status: 200, description: '${n.pascalSingular} deleted successfully' })
  @ApiResponse({ status: 404, description: '${n.pascalSingular} not found' })
  async remove(@Param('id') id: string): Promise<ApiResp<null>> {
    await this.${n.camelSingular}Service.remove(id);
    return { code: 0, msg: 'success', data: null };
  }
}
`;
  }

  /**
   * Generate NestJS module file.
   */
  generateModule(dto: AutoCodeDto): string {
    const n = deriveNames(dto.tableName);

    return `import { Module } from '@nestjs/common';
import { ${n.pascalSingular}Controller } from './${n.kebabSingular}.controller';
import { ${n.pascalSingular}Service } from './${n.kebabSingular}.service';

@Module({
  controllers: [${n.pascalSingular}Controller],
  providers: [${n.pascalSingular}Service],
  exports: [${n.pascalSingular}Service],
})
export class ${n.pascalSingular}Module {}
`;
  }

  /**
   * Generate frontend API service file.
   */
  generateFrontendService(dto: AutoCodeDto, relationDictTypes: Map<string, string | null> = new Map()): string {
    const n = deriveNames(dto.tableName);
    const oneToManyFields = dto.fields.filter((f) => f.type === 'relation' && f.relationType === 'one-to-many');

    // Generate child detail interfaces for one-to-many
    const childInterfaces: string[] = [];
    for (const f of oneToManyFields) {
      if (!f.detailFields || f.detailFields.length === 0) continue;
      const isExisting = !!(f.relationExistingTable && f.relationTable && f.relationFkColumn);
      const childPascalType = isExisting
        ? deriveNames(f.relationTable!).schemaType
        : toPascalCase(`${singularize(dto.tableName)}_${singularize(f.name)}`);
      const childFieldLines = f.detailFields.map((df) => {
        const tsType = toTsType(df);
        const nullable = !df.required && df.type !== 'boolean' ? ' | null' : '';
        return `  ${df.name}: ${tsType}${nullable};`;
      });
      childInterfaces.push(`
export interface ${childPascalType} {
  id: string;
${childFieldLines.join('\n')}
  createdAt: string;
  updatedAt: string;
}
`);
    }

    const fieldInterfaces = dto.fields.map((f) => {
      // one-to-many fields are arrays of child objects
      if (f.type === 'relation' && f.relationType === 'one-to-many') {
        const isExisting = !!(f.relationExistingTable && f.relationTable && f.relationFkColumn);
        const childPascalType = isExisting
          ? deriveNames(f.relationTable!).schemaType
          : toPascalCase(`${singularize(dto.tableName)}_${singularize(f.name)}`);
        const nullable = !f.required ? ' | null' : '';
        return `  ${f.name}: ${childPascalType}[]${nullable};`;
      }
      const tsType = toTsType(f);
      const nullable = !f.required && f.type !== 'boolean' ? ' | null' : '';
      if (f.type === 'relation' && (f.relationType === 'many-to-one' || f.relationType === 'many-to-many')) {
        return `  ${f.name}: ${tsType}${nullable};\n  ${f.name}_display: string | null;`;
      }
      return `  ${f.name}: ${tsType}${nullable};`;
    });

    const createFields = dto.fields
      .filter((f) => f.creatable)
      .map((f) => {
        if (f.type === 'relation' && f.relationType === 'one-to-many') {
          const isExisting = !!(f.relationExistingTable && f.relationTable && f.relationFkColumn);
          const childPascalType = isExisting
            ? deriveNames(f.relationTable!).schemaType
            : toPascalCase(`${singularize(dto.tableName)}_${singularize(f.name)}`);
          return `  ${f.name}?: ${childPascalType}[];`;
        }
        const tsType = toTsType(f);
        const opt = f.required ? '' : '?';
        return `  ${f.name}${opt}: ${tsType};`;
      });

    const updateFields = dto.fields
      .filter((f) => f.editable)
      .map((f) => {
        if (f.type === 'relation' && f.relationType === 'one-to-many') {
          const isExisting = !!(f.relationExistingTable && f.relationTable && f.relationFkColumn);
          const childPascalType = isExisting
            ? deriveNames(f.relationTable!).schemaType
            : toPascalCase(`${singularize(dto.tableName)}_${singularize(f.name)}`);
          return `  ${f.name}?: ${childPascalType}[];`;
        }
        const tsType = toTsType(f);
        return `  ${f.name}?: ${tsType};`;
      });

    const isNumericF = (f: AutoCodeField) => f.type === 'integer' || f.type === 'bigint' || f.type === 'decimal';
    const queryFields = dto.fields
      .filter((f) => f.searchable)
      .flatMap((f) => {
        if (f.type === 'relation' && (f.relationType === 'one-to-many')) {
          return [`  ${f.name}?: string[];`];
        }
        if (isNumericF(f)) {
          return [`  ${f.name}Min?: string;`, `  ${f.name}Max?: string;`];
        }
        return [`  ${f.name}?: string;`];
      });

    // Generate relation option interfaces and fetch functions
    const relationFields = dto.fields.filter((f) => f.type === 'relation');
    const relationOptionInterfaces: string[] = [];
    const relationFetchFunctions: string[] = [];

    for (const f of relationFields) {
      if (!f.relationTable) continue;
      const targetNames = deriveNames(f.relationTable);
      const displayField = f.relationDisplayField || 'name';
      const optionInterfaceName = `${toPascalCase(singularize(f.relationTable))}Option`;
      const fetchFunctionName = `get${toPascalCase(singularize(f.relationTable))}Options`;

      relationOptionInterfaces.push(`
export interface ${optionInterfaceName} {
  id: string;
  ${displayField}: string;
}
`);

      const isMulti = f.relationType === 'many-to-many';
      const dictType = relationDictTypes.get(f.name);
      if (dictType) {
        relationFetchFunctions.push(`
/**
 * Get ${targetNames.kebabName} options for select dropdown${isMulti ? ' (multi-select)' : ''}.
 * \`${displayField}\` is a dict code from ${dictType} — resolved to human-readable label.
 */
export async function ${fetchFunctionName}(): Promise<${optionInterfaceName}[]> {
  const [res, dictItems] = await Promise.all([
    request.get('/lc/${targetNames.kebabName}', { params: { pageSize: 100 } }),
    getDictDetailsByType('${dictType}'),
  ]);
  const dictMap: Record<string, string> = {};
  dictItems.forEach((d: { label: string; value: string }) => { dictMap[d.value] = d.label; });
  const list: any[] = res.list || res.data || [];
  return list.map((item: any) => ({ ...item, ${displayField}: dictMap[item.${displayField}] ?? item.${displayField} }));
}
`);
      } else {
        relationFetchFunctions.push(`
/**
 * Get ${targetNames.kebabName} options for select dropdown${isMulti ? ' (multi-select)' : ''}.
 */
export async function ${fetchFunctionName}(): Promise<${optionInterfaceName}[]> {
  const res = await request.get('/lc/${targetNames.kebabName}', { params: { pageSize: 100 } });
  return res.list || res.data || [];
}
`);
      }
    }

    // Generate options fetchers for FK fields inside O2M child tables
    const oneToManyFieldsForService = dto.fields.filter(f => f.type === 'relation' && f.relationType === 'one-to-many' && f.detailFields);
    const seenFetchers = new Set(relationFields.map(f => f.relationTable).filter(Boolean));
    for (const o2m of oneToManyFieldsForService) {
      for (const df of (o2m.detailFields || [])) {
        if (df.type !== 'relation' || !df.relationTable || df.relationTable === dto.tableName) continue;
        if (seenFetchers.has(df.relationTable)) continue;
        seenFetchers.add(df.relationTable);
        const targetNames = deriveNames(df.relationTable);
        const displayField = df.relationDisplayField || 'name';
        const optionInterfaceName = `${toPascalCase(singularize(df.relationTable))}Option`;
        const fetchFunctionName = `get${toPascalCase(singularize(df.relationTable))}Options`;

        relationOptionInterfaces.push(`
export interface ${optionInterfaceName} {
  id: string;
  ${displayField}: string;
}
`);
        relationFetchFunctions.push(`
/**
 * Get ${targetNames.kebabName} options for select dropdown.
 */
export async function ${fetchFunctionName}(): Promise<${optionInterfaceName}[]> {
  const res = await request.get('/lc/${targetNames.kebabName}', { params: { pageSize: 100 } });
  return res.list || res.data || [];
}
`);
      }
    }

    const hasDictRelation = [...relationDictTypes.values()].some(v => v !== null);
    return `import request from './request';${hasDictRelation ? `\nimport { getDictDetailsByType } from './dictionary';` : ''}
${childInterfaces.join('')}
export interface ${n.pascalSingular} {
  id: string;
${fieldInterfaces.join('\n')}
  createdAt: string;
  updatedAt: string;
  createdBy: string | null;
  updatedBy: string | null;
}
${relationOptionInterfaces.join('')}
export interface ${n.pascalSingular}ListParams {
  page?: number;
  pageSize?: number;
${queryFields.map(f => `  ${f}`).join('\n')}
}

export interface ${n.pascalSingular}ListResult {
  list: ${n.pascalSingular}[];
  total: number;
  page: number;
  pageSize: number;
}

export interface Create${n.pascalSingular}Dto {
${createFields.map(f => `  ${f}`).join('\n')}
}

export interface Update${n.pascalSingular}Dto {
${updateFields.map(f => `  ${f}`).join('\n')}
}

export interface BatchDeleteDto {
  ids: string[];
}

/**
 * Get paginated ${n.kebabName} list.
 */
export async function get${n.pascalName}List(params?: ${n.pascalSingular}ListParams): Promise<${n.pascalSingular}ListResult> {
  return request.get('/lc/${n.kebabName}', { params });
}

/**
 * Get a single ${n.kebabSingular} by ID.
 */
export async function get${n.pascalSingular}(id: string): Promise<${n.pascalSingular}> {
  return request.get(\`/lc/${n.kebabName}/\$\{id\}\`);
}

/**
 * Create a new ${n.kebabSingular}.
 */
export async function create${n.pascalSingular}(dto: Create${n.pascalSingular}Dto): Promise<${n.pascalSingular}> {
  return request.post('/lc/${n.kebabName}', dto);
}

/**
 * Update an existing ${n.kebabSingular}.
 */
export async function update${n.pascalSingular}(id: string, dto: Update${n.pascalSingular}Dto): Promise<${n.pascalSingular}> {
  return request.patch(\`/lc/${n.kebabName}/\$\{id\}\`, dto);
}

/**
 * Delete a ${n.kebabSingular} by ID (soft delete).
 */
export async function delete${n.pascalSingular}(id: string): Promise<void> {
  return request.delete(\`/lc/${n.kebabName}/\$\{id\}\`);
}

/**
 * Batch delete ${n.kebabName} by IDs (soft delete).
 * Returns { count: number }.
 */
export async function batchDelete${n.pascalName}(ids: string[]): Promise<{ count: number }> {
  return request.delete('/lc/${n.kebabName}/batch', { data: { ids } });
}
${relationFetchFunctions.join('')}
`;
  }

  /**
   * Generate Umi 4 frontend page with ProTable + ModalForm.
   */
  generateFrontendPage(dto: AutoCodeDto, relationDictTypes: Map<string, string | null> = new Map()): string {
    const n = deriveNames(dto.tableName);
    const listableFields = dto.fields.filter((f) => f.listable);
    const creatableFields = dto.fields.filter((f) => f.creatable);
    const editableFields = dto.fields.filter((f) => f.editable);
    const searchableFields = dto.fields.filter((f) => f.searchable);
    const relationFields = dto.fields.filter((f) => f.type === 'relation');

    // ProColumns generation
    const columnLines = listableFields.map((f) => {
      const valueType = getValueType(f);
      if (f.type === 'boolean') {
        return `    {
      title: '${f.description || f.name}',
      dataIndex: '${f.name}',
      valueType: 'switch',
      width: 100,
      search: false,
    },`;
      }
      if (f.type === 'image') {
        return `    {
      title: '${f.description || f.name}',
      dataIndex: '${f.name}',
      valueType: '${valueType}',
      width: 120,
      search: false,
      render: (_, record) => record.${f.name} ? <img src={record.${f.name}} style={{ width: 60, height: 60, objectFit: 'cover', borderRadius: 4 }} /> : '-',
    },`;
      }
      if (f.type === 'file') {
        return `    {
      title: '${f.description || f.name}',
      dataIndex: '${f.name}',
      valueType: '${valueType}',
      width: 180,
      search: false,
      render: (_, record) => record.${f.name} ? <a href={record.${f.name}} target="_blank" rel="noreferrer">{'${f.description || f.name}'}</a> : '-',
    },`;
      }
      if (f.type === 'relation' && (f.relationType === 'many-to-one' || f.relationType === 'many-to-many')) {
        const m2oDictType = relationDictTypes.get(f.name);
        const renderExpr = m2oDictType
          ? `{ const code = record.${f.name}_display || record.${f.name}; return ${toCamelCase(f.name)}TypeMap[code ?? ''] ?? code; }`
          : `record.${f.name}_display || record.${f.name}`;
        return `    {
      title: '${f.description || f.name}',
      dataIndex: '${f.name}',
      valueType: '${valueType}',
      width: 180,
      search: false,
      render: (_, record) => ${renderExpr},
    },`;
      }
      if (f.type === 'relation' && f.relationType === 'one-to-many') {
        const displayField = f.relationDisplayField;
        const renderLogic = displayField
          ? `const items = record.${f.name} || [];
        if (items.length === 0) return '-';
        const names = items.slice(0, 3).map(i => i.${displayField}).filter(Boolean).join(', ');
        return items.length > 3 ? names + '... 等' + items.length + '条' : names;`
          : `const items = record.${f.name} || [];
        return items.length > 0 ? items.length + ' 条' : '-';`;
        return `    {
      title: '${f.description || f.name}',
      dataIndex: '${f.name}',
      valueType: 'text',
      width: 150,
      search: false,
      render: (_, record) => {
        ${renderLogic}
      },
    },`;
      }
      if (f.type === 'dict') {
        return `    {
      title: '${f.description || f.name}',
      dataIndex: '${f.name}',
      valueType: 'select',
      width: 120,
      search: false,
      valueEnum: ${toCamelCase(f.name)}Options,
    },`;
      }
      const sorterExpr = (f.type === 'integer' || f.type === 'bigint' || f.type === 'decimal')
        ? `sorter: (a, b) => (Number(a.${f.name} ?? 0) - Number(b.${f.name} ?? 0)),`
        : (f.type === 'timestamp')
        ? `sorter: (a, b) => new Date(a.${f.name} as string).getTime() - new Date(b.${f.name} as string).getTime(),`
        : (f.type === 'varchar' || f.type === 'text')
        ? `sorter: (a, b) => String(a.${f.name} ?? '').localeCompare(String(b.${f.name} ?? '')),`
        : '';
      return `    {
      title: '${f.description || f.name}',
      dataIndex: '${f.name}',
      valueType: '${valueType}',
      width: 180,
      ${sorterExpr}
    },`;
    });

    // Form fields for create/edit
    const formFields = creatableFields.map((f) => {
      const component = getProFormComponent(f);
      const requiredRule = f.required ? `rules={[{ required: true, message: '请${f.type === 'relation' ? '选择' : '输入'}${f.description || f.name}' }]}` : '';
      const disabledWhenEditing = f.unique ? `disabled={!!editingRecord}` : '';

      if (f.type === 'relation') {
        // One-to-many: render EditableProTable for detail rows
        if (f.relationType === 'one-to-many' && f.detailFields && f.detailFields.length > 0) {
          const isExisting = !!(f.relationExistingTable && f.relationTable && f.relationFkColumn);
          const childPascalType = isExisting
            ? deriveNames(f.relationTable!).schemaType
            : toPascalCase(`${singularize(dto.tableName)}_${singularize(f.name)}`);
          const detailCols = f.detailFields.filter(df => df.name !== 'id' && !(df.type === 'relation' && df.relationTable === dto.tableName));
          const editableColumns = detailCols.map((df) => {
            // Relation/FK columns → render ProFormSelect with options fetch
            if (df.type === 'relation' && df.relationTable) {
              const relTarget = deriveNames(df.relationTable);
              const relDisplay = df.relationDisplayField || 'name';
              const relFetchFn = `get${toPascalCase(singularize(df.relationTable))}Options`;
              return `        {
          title: '${df.description || df.name}',
          dataIndex: '${df.name}',
          valueType: 'select',
          render: (_: any, r: any) => r.${df.name}_display || r.${df.name},
          formItemProps: { rules: [{ required: ${df.required} }] },
          request: async () => {
            const res = await ${relFetchFn}();
            return res.map((item: any) => ({ label: item.${relDisplay}, value: item.id }));
          },
          fieldProps: { showSearch: true },
        },`;
            }
            return `        {
          title: '${df.description || df.name}',
          dataIndex: '${df.name}',
          valueType: '${df.type === 'integer' || df.type === 'bigint' || df.type === 'decimal' ? 'digit' : df.type === 'timestamp' ? 'dateTime' : 'text'}',
          formItemProps: { rules: [{ required: ${df.required} }] },
        },`;
          });
          const emptyRow = detailCols.map(df => {
            if (df.type === 'relation') return `${df.name}: ''`;
            return `${df.name}: ${df.type === 'integer' || df.type === 'bigint' || df.type === 'decimal' ? '0' : df.type === 'timestamp' ? 'null' : "''"}`;
          }).join(', ');

          return `          <Form.Item name="${f.name}" label="${f.description || f.name}">
            <Form.Item noStyle shouldUpdate>
              {() => {
                const rows: any[] = form.getFieldValue('${f.name}') || [];
                return (
                  <>
                    <EditableProTable<${childPascalType}>
                      rowKey="id"
                      value={rows}
                      onChange={(data) => { form.setFieldValue('${f.name}', data ?? []); }}
                      recordCreatorProps={false}
                      editable={{
                        type: 'multiple',
                        editableKeys: ${toCamelCase(f.name)}EditableKeys,
                        onChange: set${toPascalCase(f.name)}EditableKeys,
                        onValuesChange: (_record, dataSource) => { form.setFieldValue('${f.name}', dataSource); },
                        actionRender: (row, _config, _defaultDoms) => [
                          <a key="delete" onClick={() => {
                            const cur: any[] = form.getFieldValue('${f.name}') || [];
                            form.setFieldValue('${f.name}', cur.filter((r: any) => r.id !== row.id));
                            set${toPascalCase(f.name)}EditableKeys((keys: React.Key[]) => keys.filter((k) => k !== row.id));
                          }} style={{ color: '#ff4d4f' }}>删除</a>,
                        ],
                      }}
                      columns={[
${editableColumns.join('\n')}
                        { title: '操作', valueType: 'option', width: 60 },
                      ]}
                    />
                    <Button
                      type="dashed"
                      block
                      icon={<PlusOutlined />}
                      style={{ marginTop: 8 }}
                      onClick={() => {
                        const tempId = Date.now().toString() + '_' + Math.random().toString(36).slice(2, 8);
                        const newRow = { id: tempId, ${emptyRow} };
                        form.setFieldValue('${f.name}', [...rows, newRow]);
                        set${toPascalCase(f.name)}EditableKeys((keys: React.Key[]) => [...keys, tempId]);
                      }}
                    >
                      添加${f.description || f.name}
                    </Button>
                  </>
                );
              }}
            </Form.Item>
          </Form.Item>`;
        }

        // Many-to-one or many-to-many: render single-select ProFormSelect
        const targetNames = deriveNames(f.relationTable!);
        const fetchFunctionName = `get${toPascalCase(singularize(f.relationTable!))}Options`;
        const displayField = f.relationDisplayField || 'name';

        return `          <${component}
            name="${f.name}"
            label="${f.description || f.name}"
            ${requiredRule}
            request={async () => {
              const res = await ${fetchFunctionName}();
              return res.map((item: any) => ({ label: item.${displayField}, value: item.id }));
            }}
          />`;
      }
      if (f.type === 'dict') {
        const requiredRuleDict = f.required ? `rules={[{ required: true, message: '请选择${f.description || f.name}' }]}` : '';
        return `          <ProFormSelect
            name="${f.name}"
            label="${f.description || f.name}"
            ${requiredRuleDict}
            request={async () => {
              const list = await getDictDetailsByType('${f.dictType || ''}');
              return list.map((item: any) => ({ label: item.label, value: item.value }));
            }}
          />`;
      }
      if (f.type === 'boolean') {
        return `          <${component}
            name="${f.name}"
            label="${f.description || f.name}"
          />`;
      }
      if (f.type === 'image') {
        return `          <Form.Item
            name="${f.name}"
            label="${f.description || f.name}"
            ${requiredRule}
            getValueFromEvent={(e) => {
              if (Array.isArray(e)) return e;
              return e?.fileList;
            }}
          >
            <Upload
              listType="picture-card"
              accept="image/*"
              maxCount={1}
              customRequest={async ({ file, onSuccess, onError }) => {
                try {
                  const result = await uploadFile(file as File);
                  onSuccess(result);
                } catch (err) {
                  onError(err);
                }
              }}
            >
              <div><PlusOutlined /> Upload</div>
            </Upload>
          </Form.Item>`;
      }
      if (f.type === 'file') {
        return `          <Form.Item
            name="${f.name}"
            label="${f.description || f.name}"
            ${requiredRule}
            getValueFromEvent={(e) => {
              if (Array.isArray(e)) return e;
              return e?.fileList;
            }}
          >
            <Upload
              listType="text"
              maxCount={1}
              customRequest={async ({ file, onSuccess, onError }) => {
                try {
                  const result = await uploadFile(file as File);
                  onSuccess(result);
                } catch (err) {
                  onError(err);
                }
              }}
            >
              <Button icon={<UploadOutlined />}>Select File</Button>
            </Upload>
          </Form.Item>`;
      }
      if (f.type === 'text') {
        return `          <${component}
            name="${f.name}"
            label="${f.description || f.name}"
            placeholder="${f.description || f.name}"
            ${requiredRule}
            fieldProps={{ rows: 3 }}
          />`;
      }
      return `          <${component}
            name="${f.name}"
            label="${f.description || f.name}"
            placeholder="${f.description || f.name}"
            ${requiredRule}
            ${disabledWhenEditing}
          />`;
    });

    // Request params destructure (exclude many-to-many from query params in table)
    const tableSearchableFields = searchableFields.filter((f) => !(f.type === 'relation' && (f.relationType === 'one-to-many')));
    const requestParamKeys = tableSearchableFields.map((f) => f.name).join(', ');
    const requestDestructure = tableSearchableFields.length > 0
      ? `const { current: page, pageSize${requestParamKeys ? `, ${requestParamKeys}` : ''} } = params;`
      : 'const { current: page, pageSize } = params;';

    // Handle submit: build DTO
    const createDtoFields = creatableFields.map((f) => {
      if (f.type === 'relation' && f.relationType === 'one-to-many') {
        const tsFields = (f.detailFields || []).filter((df: any) => df.type === 'timestamp' && df.name !== 'id');
        const tsOverrides = tsFields.map((df: any) => `            ${df.name}: d.${df.name} && typeof d.${df.name} === 'object' ? d.${df.name}.toISOString() : d.${df.name},`).join('\n');
        return `          ${f.name}: (values.${f.name} || []).map((d: any) => ({
            ...d,
            id: d.id?.length < 36 ? undefined : d.id,
${tsOverrides ? tsOverrides + '\n' : ''}          })),`;
      }
      if (f.type === 'boolean') {
        return `          ${f.name}: values.${f.name} ?? false,`;
      }
      if (f.type === 'integer' || f.type === 'bigint') {
        return `          ${f.name}: values.${f.name} ?? 0,`;
      }
      if (f.type === 'decimal') {
        return `          ${f.name}: String(values.${f.name} ?? '0'),`;
      }
      if (f.type === 'relation') {
        return `          ${f.name}: values.${f.name} || '',`;
      }
      if (f.type === 'image' || f.type === 'file') {
        return `          ${f.name}: (() => {
            const v = values.${f.name};
            if (typeof v === 'string') return v;
            if (Array.isArray(v) && v.length > 0) {
              const item = v[0];
              return item?.response?.url || item?.url || '';
            }
            return '';
          })(),`;
      }
      return `          ${f.name}: values.${f.name} || '',`;
    });

    const updateDtoFields = editableFields.map((f) => {
      if (f.type === 'relation' && f.relationType === 'one-to-many') {
        const tsFields = (f.detailFields || []).filter((df: any) => df.type === 'timestamp' && df.name !== 'id');
        const tsOverrides = tsFields.map((df: any) => `            ${df.name}: d.${df.name} && typeof d.${df.name} === 'object' ? d.${df.name}.toISOString() : d.${df.name},`).join('\n');
        return `          ${f.name}: (values.${f.name} || []).map((d: any) => ({
            ...d,
            id: d.id?.length < 36 ? undefined : d.id,
${tsOverrides ? tsOverrides + '\n' : ''}          })),`;
      }
      if (f.type === 'boolean') {
        return `          ${f.name}: values.${f.name} ?? false,`;
      }
      if (f.type === 'integer' || f.type === 'bigint') {
        return `          ${f.name}: values.${f.name} ?? 0,`;
      }
      if (f.type === 'decimal') {
        return `          ${f.name}: String(values.${f.name} ?? '0'),`;
      }
      if (f.type === 'relation') {
        return `          ${f.name}: values.${f.name} || '',`;
      }
      if (f.type === 'image' || f.type === 'file') {
        return `          ${f.name}: (() => {
            const v = values.${f.name};
            if (typeof v === 'string') return v;
            if (Array.isArray(v) && v.length > 0) {
              const item = v[0];
              return item?.response?.url || item?.url || '';
            }
            return '';
          })(),`;
      }
      return `          ${f.name}: values.${f.name} || '',`;
    });

    // Import destructure for API functions
    const apiFunctions = [
      `get${n.pascalName}List`,
      `create${n.pascalSingular}`,
      `update${n.pascalSingular}`,
      `delete${n.pascalSingular}`,
      `batchDelete${n.pascalName}`,
    ];
    const typeImports = [
      `${n.pascalSingular}`,
      `Create${n.pascalSingular}Dto`,
      `Update${n.pascalSingular}Dto`,
    ];

    // Add relation fetch functions to imports
    for (const f of relationFields) {
      if (f.relationTable) {
        apiFunctions.push(`get${toPascalCase(singularize(f.relationTable))}Options`);
      }
    }

    // Determine if we need ProFormSelect import
    const dictFields = dto.fields.filter((f) => f.type === 'dict');
    const needsProFormSelect = creatableFields.some((f) => (f.type === 'relation' && f.relationType !== 'one-to-many') || f.type === 'dict');
    // Many-to-one fields whose display column is dict-backed
    const manyToOneDictFields = dto.fields
      .filter((f) => f.type === 'relation' && (f.relationType === 'many-to-one' || f.relationType === 'many-to-many') && relationDictTypes.get(f.name))
      .map((f) => ({ field: f, dictType: relationDictTypes.get(f.name) as string }));
    const hasDictFields = dictFields.length > 0 || manyToOneDictFields.length > 0;

    // Determine if we need Upload/FileUpload imports
    const hasUploadFields = creatableFields.some((f) => f.type === 'image' || f.type === 'file');

    // Determine if we need EditableProTable for one-to-many
    const hasOneToMany = creatableFields.some((f) => f.type === 'relation' && f.relationType === 'one-to-many');

    const oneToManyFields = dto.fields.filter(f => f.type === 'relation' && f.relationType === 'one-to-many' && f.detailFields && f.detailFields.length > 0);
    const antdImports = ['Button', 'message', 'Popconfirm', 'Space', 'Form', 'Table', 'Input'];
    if (hasUploadFields) antdImports.push('Upload');
    if (oneToManyFields.length > 1) antdImports.push('Tabs');
    // Add options fetchers for FK fields in O2M child tables
    for (const f2 of oneToManyFields) {
      for (const df of (f2.detailFields || [])) {
        if (df.type === 'relation' && df.relationTable && df.relationTable !== dto.tableName) {
          const childOptFn = `get${toPascalCase(singularize(df.relationTable))}Options`;
          if (!apiFunctions.includes(childOptFn)) apiFunctions.push(childOptFn);
        }
      }
    }

    const iconImports = ['PlusOutlined', 'SearchOutlined'];
    if (hasUploadFields) {
      iconImports.push('UploadOutlined');
    }

    return `import React, { useRef, useState, useEffect, useCallback } from 'react';
${hasOneToMany && dto.fields.some((f: any) => f.type === 'relation' && f.relationType === 'one-to-many' && (f.detailFields || []).some((df: any) => df.type === 'timestamp')) ? "import dayjs from 'dayjs';\n" : ''}import { ${antdImports.join(', ')} } from 'antd';
import { ${iconImports.join(', ')} } from '@ant-design/icons';
import { ActionType, ProColumns, ProTable${hasOneToMany ? ', EditableProTable' : ''} } from '@ant-design/pro-components';
import {
  ModalForm,
  ProFormText,
  ProFormTextArea,
  ProFormDigit,
  ProFormSwitch,${needsProFormSelect ? '\n  ProFormSelect,' : ''}
} from '@ant-design/pro-components';
import {
  ${apiFunctions.join(',\n  ')},
  type ${typeImports.join(',\n  type ')},
} from '@/services/${n.kebabSingular}';
import { getMyBtnPerms } from '@/services/authority-btn';${hasUploadFields ? `\nimport { uploadFile } from '@/services/file';` : ''}${hasDictFields ? `\nimport { getDictDetailsByType } from '@/services/dictionary';` : ''}

export default function ${n.pascalName}Page() {
  const actionRef = useRef<ActionType>(undefined);
  const [modalOpen, setModalOpen] = useState(false);
  const [editingRecord, setEditingRecord] = useState<${n.pascalSingular} | null>(null);
  const [selectedRowKeys, setSelectedRowKeys] = useState<string[]>([]);
  const [form] = Form.useForm();
${hasOneToMany ? `${dto.fields.filter(f => f.type === 'relation' && f.relationType === 'one-to-many').map(f => `  const [${toCamelCase(f.name)}EditableKeys, set${toPascalCase(f.name)}EditableKeys] = useState<React.Key[]>([]);`).join('\n')}\n  const [expandedRowKeys, setExpandedRowKeys] = useState<string[]>([]);\n  const currentDataRef = useRef<${n.pascalSingular}[]>([]);\n` : ''}${dictFields.length > 0 ? dictFields.map(f => `  const [${toCamelCase(f.name)}Options, set${toPascalCase(f.name)}Options] = useState<Record<string, { text: string }>>({});`).join('\n') + '\n' : ''}${manyToOneDictFields.length > 0 ? manyToOneDictFields.map(({ field: f }) => `  const [${toCamelCase(f.name)}TypeMap, set${toPascalCase(f.name)}TypeMap] = useState<Record<string, string>>({});`).join('\n') + '\n' : ''}${tableSearchableFields.flatMap(f => (f.type === 'integer' || f.type === 'bigint' || f.type === 'decimal') ? [`  const [search${toPascalCase(f.name)}Min, setSearch${toPascalCase(f.name)}Min] = useState('');`, `  const [search${toPascalCase(f.name)}Max, setSearch${toPascalCase(f.name)}Max] = useState('');`] : [`  const [search${toPascalCase(f.name)}, setSearch${toPascalCase(f.name)}] = useState('');`]).join('\n')}${tableSearchableFields.length > 0 ? `
  const debounceTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const makeDebounce = useCallback((setter: (v: string) => void) => (e: React.ChangeEvent<HTMLInputElement>) => {
    const val = e.target.value;
    if (debounceTimer.current) clearTimeout(debounceTimer.current);
    debounceTimer.current = setTimeout(() => { setter(val); }, 400);
  }, []);
` : ''}${hasDictFields ? `
  useEffect(() => {
${dictFields.map(f => `    getDictDetailsByType('${f.dictType || ''}').then((list: any[]) => {
      const map: Record<string, { text: string }> = {};
      list.forEach((item: any) => { map[item.value] = { text: item.label }; });
      set${toPascalCase(f.name)}Options(map);
    }).catch(() => {});`).join('\n')}
${manyToOneDictFields.map(({ field: f, dictType }) => `    getDictDetailsByType('${dictType}').then((list: any[]) => {
      const m: Record<string, string> = {};
      list.forEach((item: any) => { m[item.value] = item.label; });
      set${toPascalCase(f.name)}TypeMap(m);
    }).catch(() => {});`).join('\n')}
  }, []);
` : ''}
  // ── Button-level permission check ──
  // Fetch directly from sys_authority_btns on every page visit.
  // This is the single source of truth — same data the backend Guard checks.
  const [btnPerms, setBtnPerms] = useState<Set<string>>(new Set());
  useEffect(() => {
    getMyBtnPerms().then((perms) => {
      setBtnPerms(new Set(perms['./${n.kebabName}/index'] ?? []));
    }).catch(() => setBtnPerms(new Set()));
  }, []);

  const columns: ProColumns<${n.pascalSingular}>[] = [
${columnLines.join('\n')}
    {
      title: '创建时间',
      dataIndex: 'createdAt',
      valueType: 'dateTime',
      width: 180,
      search: false,
      sorter: (a, b) => new Date(a.createdAt).getTime() - new Date(b.createdAt).getTime(),
      defaultSortOrder: 'descend',
    },
    {
      title: '创建人',
      dataIndex: 'createdBy',
      valueType: 'text',
      width: 120,
      search: false,
    },
    {
      title: '操作',
      key: 'action',
      width: 140,
      search: false,
      render: (_, record) => (
        <Space>
          {btnPerms.has('edit') && (
            <Button
              type="link"
              size="small"
              onClick={() => {
                form.resetFields();
                form.setFieldsValue({
                  ${creatableFields.map(f => {
                    if (f.type === 'relation' && f.relationType === 'one-to-many') {
                      const tsFields = (f.detailFields || []).filter((df: any) => df.type === 'timestamp' && df.name !== 'id');
                      if (tsFields.length > 0) {
                        const tsConversions = tsFields.map((df: any) => `${df.name}: d.${df.name} ? dayjs(d.${df.name}) : null`).join(', ');
                        return `${f.name}: (record.${f.name} || []).map((d: any) => ({ ...d, ${tsConversions} })),`;
                      }
                      return `${f.name}: record.${f.name} || [],`;
                    }
                    if (f.type === 'image' || f.type === 'file') {
                      return `${f.name}: record.${f.name} ? [{ uid: '-1', name: 'file', url: record.${f.name}, status: 'done' }] : [],`;
                    }
                    return `${f.name}: record.${f.name},`;
                  }).join('\n                  ')}
                });
                setEditingRecord(record);
                ${hasOneToMany ? dto.fields.filter(f => f.type === 'relation' && f.relationType === 'one-to-many').map(f => `set${toPascalCase(f.name)}EditableKeys((record.${f.name} || []).map((d: any) => d.id));`).join('\n                ') : ''}
                setModalOpen(true);
              }}
            >
              编辑
            </Button>
          )}
          {btnPerms.has('delete') && (
            <Popconfirm
              title="确认删除？"
              description="删除后无法恢复。"
              onConfirm={async () => {
                try {
                  await delete${n.pascalSingular}(record.id);
                  message.success('删除成功');
                  actionRef.current?.reload();
                } catch (err: any) {
                  message.error(err.message || '删除失败');
                }
              }}
              okText="确认"
              cancelText="取消"
            >
              <Button type="link" size="small" danger>
                删除
              </Button>
            </Popconfirm>
          )}
        </Space>
      ),
    },
  ];

  const handleSubmit = async (values: Record<string, any>) => {
    try {
      if (editingRecord) {
        const dto: Update${n.pascalSingular}Dto = {
${updateDtoFields.join('\n')}
        };
        await update${n.pascalSingular}(editingRecord.id, dto);
        message.success('更新成功');
      } else {
        const dto: Create${n.pascalSingular}Dto = {
${createDtoFields.join('\n')}
        };
        await create${n.pascalSingular}(dto);
        message.success('创建成功');
      }
      setModalOpen(false);
      setEditingRecord(null);
      actionRef.current?.reload();
      return true;
    } catch (err: any) {
      message.error(err.message || '操作失败');
      return false;
    }
  };

  const handleBatchDelete = async () => {
    try {
      const result = await batchDelete${n.pascalName}(selectedRowKeys);
      message.success(\`成功删除 \$\{result.count\} 条记录\`);
      setSelectedRowKeys([]);
      actionRef.current?.reload();
    } catch (err: any) {
      message.error(err.message || '批量删除失败');
    }
  };

  return (
    <>
      <ProTable<${n.pascalSingular}>
        headerTitle="${dto.description || n.pascalName}"
        actionRef={actionRef}
        rowKey="id"
        columns={columns}
${oneToManyFields.length > 0 ? `        expandable={{
          expandedRowKeys,
          onExpandedRowsChange: (keys) => setExpandedRowKeys(keys as string[]),
          rowExpandable: (record) => ${oneToManyFields.map(f => `(record.${f.name}?.length ?? 0) > 0`).join(' || ')},
          expandedRowRender: (record) => (
            ${oneToManyFields.length === 1 ? `<Table
              size="small"
              rowKey="id"
              dataSource={record.${oneToManyFields[0].name} || []}
              pagination={false}
              columns={[
                ${oneToManyFields[0].detailFields!.filter(df => df.name !== 'id' && !(df.type === 'relation' && df.relationTable === dto.tableName)).map(df => (df.type === 'relation' ? `{ title: '${df.description || df.name}', dataIndex: '${df.name}', render: (_: any, r: any) => r.${df.name}_display || r.${df.name} }` : `{ title: '${df.description || df.name}', dataIndex: '${df.name}' }`)).join(',\n                ')},
              ]}
              style={{ margin: '0 48px' }}
            />` : `<Tabs
              style={{ margin: '0 48px' }}
              items={[
                ${oneToManyFields.map(f => `{
                  key: '${f.name}',
                  label: '${f.description || f.name}',
                  children: (
                    <Table
                      size="small"
                      rowKey="id"
                      dataSource={record.${f.name} || []}
                      pagination={false}
                      columns={[
                        ${f.detailFields!.filter(df => df.name !== 'id' && !(df.type === 'relation' && df.relationTable === dto.tableName)).map(df => (df.type === 'relation' ? `{ title: '${df.description || df.name}', dataIndex: '${df.name}', render: (_: any, r: any) => r.${df.name}_display || r.${df.name} }` : `{ title: '${df.description || df.name}', dataIndex: '${df.name}' }`)).join(',\n                        ')},
                      ]}
                    />
                  ),
                }`).join(',\n                ')}
              ]}
            />`}
          ),
        }}` : ''}
        search={false}
        ${tableSearchableFields.length > 0 ? `params={{ ${tableSearchableFields.flatMap(f => (f.type === 'integer' || f.type === 'bigint' || f.type === 'decimal') ? [`search${toPascalCase(f.name)}Min`, `search${toPascalCase(f.name)}Max`] : [`search${toPascalCase(f.name)}`]).join(', ')} }}` : ''}
        rowSelection={{
          selectedRowKeys,
          onChange: (keys) => setSelectedRowKeys(keys as string[]),
        }}
        request={async (params) => {
          const { current: page, pageSize } = params;
          const result = await get${n.pascalName}List({ page, pageSize${tableSearchableFields.length > 0 ? `, ${tableSearchableFields.flatMap(f => (f.type === 'integer' || f.type === 'bigint' || f.type === 'decimal') ? [`${f.name}Min: search${toPascalCase(f.name)}Min || undefined`, `${f.name}Max: search${toPascalCase(f.name)}Max || undefined`] : [`${f.name}: search${toPascalCase(f.name)} || undefined`]).join(', ')}` : ''} });
          ${oneToManyFields.length > 0 ? 'currentDataRef.current = result.list;\n          setExpandedRowKeys([]);' : ''}
          return {
            data: result.list,
            total: result.total,
            success: true,
          };
        }}
        toolBarRender={() => [
          ${oneToManyFields.length > 0 ? `<Button
            key="expand-all"
            size="small"
            onClick={() => {
              const expandable = currentDataRef.current
                .filter(r => ${oneToManyFields.map(f => `(r.${f.name}?.length ?? 0) > 0`).join(' || ')})
                .map(r => r.id);
              if (expandedRowKeys.length === expandable.length) {
                setExpandedRowKeys([]);
              } else {
                setExpandedRowKeys(expandable);
              }
            }}
          >
            {expandedRowKeys.length > 0 ? '折叠全部' : '展开全部'}
          </Button>,` : ''}
          ${tableSearchableFields.flatMap(f => (f.type === 'integer' || f.type === 'bigint' || f.type === 'decimal') ? [`<Input
            key="search-${f.name}-min"
            placeholder="${f.description || f.name}最小值"
            allowClear
            style={{ width: 120 }}
            onChange={makeDebounce(setSearch${toPascalCase(f.name)}Min)}
            onClear={() => setSearch${toPascalCase(f.name)}Min('')}
          />,`, `<Input
            key="search-${f.name}-max"
            placeholder="${f.description || f.name}最大值"
            allowClear
            style={{ width: 120 }}
            onChange={makeDebounce(setSearch${toPascalCase(f.name)}Max)}
            onClear={() => setSearch${toPascalCase(f.name)}Max('')}
          />,`] : [`<Input
            key="search-${f.name}"
            placeholder="搜索${f.description || f.name}"
            prefix={<SearchOutlined />}
            allowClear
            style={{ width: 180 }}
            onChange={makeDebounce(setSearch${toPascalCase(f.name)})}
            onClear={() => setSearch${toPascalCase(f.name)}('')}
          />,`]).join('\n          ')}
          btnPerms.has('add') && (
            <Button
              key="create"
              type="primary"
              icon={<PlusOutlined />}
              onClick={() => {
                form.resetFields();
                setEditingRecord(null);
                ${hasOneToMany ? dto.fields.filter(f => f.type === 'relation' && f.relationType === 'one-to-many').map(f => `set${toPascalCase(f.name)}EditableKeys([]);`).join('\n                ') : ''}
                setModalOpen(true);
              }}
            >
              新建
            </Button>
          ),
          btnPerms.has('batchDelete') && selectedRowKeys.length > 0 && (
            <Popconfirm
              key="batch-delete"
              title="确认批量删除？"
              description={\`已选择 \$\{selectedRowKeys.length\} 条记录，删除后无法恢复。\`}
              onConfirm={handleBatchDelete}
              okText="确认"
              cancelText="取消"
            >
              <Button danger>
                批量删除 ({selectedRowKeys.length})
              </Button>
            </Popconfirm>
          ),
        ].filter(Boolean)}
      />

      <ModalForm
        title={editingRecord ? '编辑' : '新建'}
        open={modalOpen}
        form={form}
        onOpenChange={(open) => {
          setModalOpen(open);
          if (!open) {
${hasOneToMany ? dto.fields.filter(f => f.type === 'relation' && f.relationType === 'one-to-many').map(f => `            set${toPascalCase(f.name)}EditableKeys([]);`).join('\n') + '\n' : ''}            setTimeout(() => setEditingRecord(null), 300);
          }
        }}
        onFinish={handleSubmit}
        modalProps={{ destroyOnClose: true }}
      >
${(() => {
  const nonDetailFields = formFields.filter((_, i) => {
    const f = creatableFields[i];
    return !(f?.type === 'relation' && f?.relationType === 'one-to-many');
  });
  const detailFormFields = formFields.filter((_, i) => {
    const f = creatableFields[i];
    return f?.type === 'relation' && f?.relationType === 'one-to-many';
  });
  const detailFieldDefs = creatableFields.filter(f => f.type === 'relation' && f.relationType === 'one-to-many');

  if (detailFormFields.length <= 1) {
    return formFields.join('\n\n');
  }
  // Multiple 1:N fields → wrap in Tabs
  const tabItems = detailFieldDefs.map((f, i) => `          {
            key: '${f.name}',
            label: '${f.description || f.name}',
            forceRender: true,
            children: (
${detailFormFields[i]}
            ),
          }`).join(',\n');
  return `${nonDetailFields.join('\n\n')}

          <Tabs
            items={[
${tabItems}
            ]}
          />`;
})()}
      </ModalForm>
    </>
  );
}
`;
  }

  // =========================================================================
  // Public API
  // =========================================================================

  /**
   * Preview: generate all files and return as a map of filepath -> content.
   * Does NOT write anything to disk.
   */
  preview(dto: AutoCodeDto): Record<string, string> {
    const n = deriveNames(dto.tableName);
    const files: Record<string, string> = {};

    // For schema: keep removed fields as comments (preserves DB column)
    files[`apps/server/src/db/schema/${n.kebabName}.ts`] = this.generateSchema(dto);

    // For all business code: exclude removed fields
    const activeDto: AutoCodeDto = { ...dto, fields: activeFields(dto.fields) };

    // DTOs
    files[`apps/server/src/modules/${n.kebabSingular}/dto/create-${n.kebabSingular}.dto.ts`] = this.generateCreateDto(activeDto);
    files[`apps/server/src/modules/${n.kebabSingular}/dto/query-${n.kebabSingular}.dto.ts`] = this.generateQueryDto(activeDto);
    files[`apps/server/src/modules/${n.kebabSingular}/dto/update-${n.kebabSingular}.dto.ts`] = this.generateUpdateDto(activeDto);

    // Service
    files[`apps/server/src/modules/${n.kebabSingular}/${n.kebabSingular}.service.ts`] = this.generateService(activeDto);

    // Controller
    files[`apps/server/src/modules/${n.kebabSingular}/${n.kebabSingular}.controller.ts`] = this.generateController(activeDto);

    // Module
    files[`apps/server/src/modules/${n.kebabSingular}/${n.kebabSingular}.module.ts`] = this.generateModule(activeDto);

    // Frontend files (only if generateWeb is true)
    if (dto.generateWeb) {
      files[`apps/web/src/services/${n.kebabSingular}.ts`] = this.generateFrontendService(activeDto);
      files[`apps/web/src/pages/${n.kebabName}/index.tsx`] = this.generateFrontendPage(activeDto);
    }

    return files;
  }

  /**
   * Generate: write files to disk and update entry points.
   * Checks for existing files before overwriting.
   */
  /**
   * Infer dict types for many-to-one relation display fields by querying history records.
   * Returns a Map keyed by field.name to the dictType string (or null if not dict-backed).
   */
  private async lookupRelationDisplayDictTypes(fields: AutoCodeField[]): Promise<Map<string, string | null>> {
    const result = new Map<string, string | null>();
    const relationFields = fields.filter((f) => f.type === 'relation' && (f.relationType === 'many-to-one' || f.relationType === 'many-to-many') && f.relationTable);
    await Promise.all(relationFields.map(async (f) => {
      const displayField = f.relationDisplayField || 'name';
      try {
        const rows = await this.db
          .select({ fields: sysAutoCodeHistories.fields })
          .from(sysAutoCodeHistories)
          .where(eq(sysAutoCodeHistories.tableName, f.relationTable!))
          .orderBy(desc(sysAutoCodeHistories.createdAt))
          .limit(1);
        if (rows.length === 0 || !rows[0].fields) { result.set(f.name, null); return; }
        const historyFields = rows[0].fields as AutoCodeField[];
        const target = historyFields.find((hf) => hf.name === displayField && hf.type === 'dict');
        result.set(f.name, target?.dictType ?? null);
      } catch {
        result.set(f.name, null);
      }
    }));
    return result;
  }

  async generate(dto: AutoCodeDto): Promise<{ createdFiles: string[] }> {
    const files = this.preview(dto);
    const projectRoot = this.resolveProjectRoot();

    // Infer dict types for many-to-one display fields and regenerate frontend files with dict-aware templates
    if (dto.generateWeb) {
      const n = deriveNames(dto.tableName);
      const activeDto: AutoCodeDto = { ...dto, fields: activeFields(dto.fields) };
      const relationDictTypes = await this.lookupRelationDisplayDictTypes(activeDto.fields);
      if ([...relationDictTypes.values()].some((v) => v !== null)) {
        files[`apps/web/src/services/${n.kebabSingular}.ts`] = this.generateFrontendService(activeDto, relationDictTypes);
        files[`apps/web/src/pages/${n.kebabName}/index.tsx`] = this.generateFrontendPage(activeDto, relationDictTypes);
      }
    }
    const createdFiles: string[] = [];

    for (const [relativePath, content] of Object.entries(files)) {
      const absolutePath = path.join(projectRoot, relativePath);
      const dir = path.dirname(absolutePath);

      await fs.mkdir(dir, { recursive: true });

      // Check if file already exists
      try {
        await fs.access(absolutePath);
        throw new ConflictException(
          `File already exists: ${relativePath}. Remove the existing file first or use a different table name.`,
        );
      } catch (err: unknown) {
        if (err instanceof ConflictException) {
          throw err;
        }
        // File does not exist, proceed
      }

      await fs.writeFile(absolutePath, content, 'utf-8');
      createdFiles.push(relativePath);
    }

    // Update entry points
    await this.updateSchemaIndex(dto, projectRoot);
    await this.updateAppModule(dto, projectRoot);
    if (dto.generateWeb) {
      await this.updateUmiRoutes(dto, projectRoot);
    }

    // Resolve package context (needed for both history and menu)
    let menuParentId: string | null = null;
    let packageName = '';
    if (dto.packageId) {
      try {
        const pkg = await this.findOnePackage(dto.packageId);
        menuParentId = pkg.menuId ?? null;
        packageName = pkg.name;
      } catch { /* package not found — skip parent */ }
    }

    // Auto-save history record
    try {
      await this.db.insert(sysAutoCodeHistories).values({
        packageName,
        tableName: dto.tableName,
        businessDB: (dto as any).businessDB || '',
        templates: files,
      });
    } catch (historyErr: unknown) {
      // History save failure should not block the generate result
      this.logger.error('[AutocodeService] Failed to save generation history:', historyErr);
    }

    // Auto-sync schema to database via drizzle-kit push (patched with DRIZZLE_SILENT=1)
    try {
      const { exec } = await import('node:child_process');
      const { promisify } = await import('node:util');
      const execAsync = promisify(exec);
      const serverDir = path.join(projectRoot, 'apps', 'server');
      await execAsync('npx --no-install drizzle-kit push --force', {
        cwd: serverDir,
        timeout: 30000,
        env: { ...process.env, DRIZZLE_SILENT: '1' },
      });
      this.logger.log(` drizzle-kit push (silent) completed for '${dto.tableName}'`);
    } catch (pushErr: unknown) {
      this.logger.error(` drizzle-kit push FAILED for '${dto.tableName}':`, pushErr);
    }

    // Auto-create menu record in sys_menus + assign to admin roles
    try {
      await this.autoCreateMenu(dto, menuParentId);
    } catch (menuErr: unknown) {
      this.logger.error(` Auto-create menu FAILED for '${dto.tableName}':`, menuErr);
    }

    return { createdFiles };
  }

  // =========================================================================
  // Async generate with progress tracking
  // =========================================================================

  /** Step definitions for progress reporting */
  private static readonly GENERATE_STEPS = [
    { key: 'generate', label: '正在生成代码...' },
    { key: 'write', label: '正在写入文件...' },
    { key: 'schema-sync', label: '正在同步数据库表...' },
    { key: 'menu', label: '正在创建菜单...' },
    { key: 'history', label: '正在保存历史记录...' },
    { key: 'entrypoints', label: '正在更新入口文件...' },
  ] as const;

  private static readonly DELETE_STEPS = [
    { key: 'files', label: '正在删除文件...' },
    { key: 'route', label: '正在移除路由...' },
    { key: 'schema-export', label: '正在移除 Schema 导出...' },
    { key: 'module-reg', label: '正在移除模块注册...' },
    { key: 'menus', label: '正在删除菜单...' },
    { key: 'drop-table', label: '正在删除数据库表...' },
    { key: 'history', label: '正在清理历史记录...' },
  ] as const;

  private static readonly UPDATE_STEPS = [
    { key: 'generate', label: '正在生成代码...' },
    { key: 'write', label: '正在覆盖文件...' },
    { key: 'schema-sync', label: '正在同步数据库...' },
    { key: 'history', label: '正在保存版本...' },
    { key: 'entrypoints', label: '正在更新入口文件...' },
  ] as const;

  /** Directory for persisting job status (survives nest --watch restarts) */
  private get jobsDir(): string {
    return path.join(this.resolveProjectRoot(), '.tmp', 'generate-jobs');
  }

  // =========================================================================
  // Async delete with progress tracking
  // =========================================================================

  /**
   * Start async deletion with progress tracking.
   * Returns a jobId immediately; the actual work runs in the background.
   */
  async startDeleteHistory(id: string, cascade = false): Promise<string> {
    // Pre-validate: check history exists before starting async job
    await this.findOneHistory(id);

    const jobId = randomUUID();
    const steps = AutocodeService.DELETE_STEPS.map((s) => ({
      key: s.key,
      label: s.label,
      status: 'pending' as const,
    }));

    await this.writeJobStatus(jobId, {
      jobId,
      status: 'processing',
      steps,
      progress: 0,
      currentStepLabel: '准备删除...',
    });

    this.executeDeleteAsync(jobId, id, cascade).catch((err) => {
      this.logger.error(` Unhandled error in delete job ${jobId}:`, err);
    });

    return jobId;
  }

  private async executeDeleteAsync(jobId: string, historyId: string, cascade = false): Promise<void> {
    const totalSteps = AutocodeService.DELETE_STEPS.length;

    const updateStep = async (
      stepIndex: number,
      stepStatus: GenerateStepStatus,
      message?: string,
    ) => {
      const steps: GenerateStep[] = AutocodeService.DELETE_STEPS.map((s, i) => ({
        key: s.key,
        label: s.label,
        status: i < stepIndex
          ? 'completed' as const
          : i === stepIndex
            ? stepStatus
            : 'pending' as const,
      }));

      const progress = stepStatus === 'completed'
        ? Math.round(((stepIndex + 1) / totalSteps) * 100)
        : Math.round(((stepIndex + 0.5) / totalSteps) * 100);

      await this.writeJobStatus(jobId, {
        jobId,
        status: stepStatus === 'failed' ? 'failed' : 'processing',
        steps,
        progress,
        currentStepLabel: message || AutocodeService.DELETE_STEPS[stepIndex]!.label,
        error: stepStatus === 'failed' ? message : undefined,
      });
    };

    try {
      const history = await this.findOneHistory(historyId);
      const tableName = history.tableName;
      const n = deriveNames(tableName);
      const projectRoot = this.resolveProjectRoot();
      const dbTableName = `lc_${tableName}`;

      // Parse fields to find one-to-many child tables for cascade drop
      const historyFields: AutoCodeField[] = (history.fields as AutoCodeField[]) || [];
      const oneToManyFields = historyFields.filter(
        (f) => f.type === 'relation' && f.relationType === 'one-to-many'
      );

      const deletedFiles: string[] = [];
      let droppedTable = false;
      let removedMenus = 0;

      // Step 1: Delete generated files on disk
      await updateStep(0, 'running');
      const expectedPaths = [
        `apps/server/src/db/schema/${n.kebabName}.ts`,
        `apps/server/src/modules/${n.kebabSingular}/${n.kebabSingular}.service.ts`,
        `apps/server/src/modules/${n.kebabSingular}/${n.kebabSingular}.controller.ts`,
        `apps/server/src/modules/${n.kebabSingular}/${n.kebabSingular}.module.ts`,
        `apps/server/src/modules/${n.kebabSingular}/dto/create-${n.kebabSingular}.dto.ts`,
        `apps/server/src/modules/${n.kebabSingular}/dto/query-${n.kebabSingular}.dto.ts`,
        `apps/server/src/modules/${n.kebabSingular}/dto/update-${n.kebabSingular}.dto.ts`,
        `apps/web/src/services/${n.kebabSingular}.ts`,
        `apps/web/src/pages/${n.kebabName}/index.tsx`,
      ];
      for (const p of expectedPaths) {
        const fullPath = path.join(projectRoot, p);
        if (existsSync(fullPath)) {
          await fs.rm(fullPath, { force: true });
          deletedFiles.push(p);
        }
      }
      // Remove module directory if empty
      const moduleDir = path.join(projectRoot, `apps/server/src/modules/${n.kebabSingular}`);
      if (existsSync(moduleDir)) {
        try { await fs.rmdir(moduleDir); } catch { /* not empty */ }
        try { await fs.rmdir(path.join(moduleDir, 'dto')); } catch { /* not empty */ }
      }
      const pageDir = path.join(projectRoot, `apps/web/src/pages/${n.kebabName}`);
      if (existsSync(pageDir)) {
        try { await fs.rmdir(pageDir); } catch { /* not empty */ }
      }
      await updateStep(0, 'completed');

      // Step 2: Remove route from .umirc.ts
      await updateStep(1, 'running');
      await this.removeRouteFromUmirc(n);
      await updateStep(1, 'completed');

      // Step 3: Remove schema export from db/schema/index.ts
      await updateStep(2, 'running');
      await this.removeSchemaExport(n);
      await updateStep(2, 'completed');

      // Step 4: Remove module registration from app.module.ts (triggers nest --watch restart)
      await updateStep(3, 'running');
      await this.removeModuleRegistration(n);
      await updateStep(3, 'completed');

      // Step 5: Remove menu entries (including button children)
      // Search by component path (works for both /lc/ and /pkg/ prefixed routes)
      await updateStep(4, 'running');
      const componentPath = `./${n.kebabName}/index`;
      const menuRows = await this.db
        .select({ id: sysMenus.id, name: sysMenus.name, path: sysMenus.path })
        .from(sysMenus)
        .where(and(eq(sysMenus.component, componentPath), isNull(sysMenus.deletedAt)));
      if (menuRows.length > 0) {
        const pageMenuIds = menuRows.map((m) => m.id);
        // Also find button children (menuType=3) of these page menus
        const btnChildren = await this.db
          .select({ id: sysMenus.id })
          .from(sysMenus)
          .where(
            and(
              inArray(sysMenus.parentId, pageMenuIds),
              eq(sysMenus.menuType, 3),
              isNull(sysMenus.deletedAt),
            ),
          );
        const allMenuIds = [...pageMenuIds, ...btnChildren.map((b) => b.id)];
        // Cascade-delete authority_btn entries
        await this.db
          .delete(sysAuthorityBtns)
          .where(inArray(sysAuthorityBtns.menuId, allMenuIds));
        await this.db.delete(sysRoleMenus).where(inArray(sysRoleMenus.menuId, allMenuIds));
        await this.db.delete(sysMenus).where(inArray(sysMenus.id, allMenuIds));
        removedMenus = allMenuIds.length;

        // Remove sys_apis entries and Casbin policies for this module
        const apiGroup = `lc/${n.kebabName}`;
        const apiRows = await this.db
          .select({ path: sysApis.path, method: sysApis.method })
          .from(sysApis)
          .where(and(eq(sysApis.apiGroup, apiGroup), isNull(sysApis.deletedAt)));
        for (const api of apiRows) {
          await this.casbin.removeFilteredPolicy(1, api.path);
        }
        await this.db
          .update(sysApis)
          .set({ deletedAt: sql`NOW()` })
          .where(and(eq(sysApis.apiGroup, apiGroup), isNull(sysApis.deletedAt)));
      }
      await updateStep(4, 'completed');

      // Step 6: Drop the database table (potentially slow)
      await updateStep(5, 'running', '正在删除数据库表...');
      try {
        const tableExists = await this.db.execute(sql`
          SELECT COUNT(*) as cnt FROM information_schema.tables
          WHERE table_schema = 'public' AND table_name = ${dbTableName}
        `);
        if ((tableExists[0] as any)?.cnt > 0) {
          // When cascade mode is on, drop referencing tables first and clean up their artifacts
          if (cascade) {
            // Find all tables that reference this table via FK
            const fkRows = await this.db.execute(sql`
              SELECT DISTINCT kcu.table_name
              FROM information_schema.table_constraints tc
              JOIN information_schema.key_column_usage kcu
                ON tc.constraint_name = kcu.constraint_name
                AND tc.table_schema = kcu.table_schema
              JOIN information_schema.constraint_column_usage ccu
                ON tc.constraint_name = ccu.constraint_name
                AND tc.table_schema = ccu.table_schema
              WHERE tc.constraint_type = 'FOREIGN KEY'
                AND ccu.table_name = ${dbTableName}
                AND tc.table_schema = 'public'
            `);
            const refTables = (fkRows as any[]).map((r: any) => r.table_name as string);
            for (const refDbTable of refTables) {
              const refTableName = refDbTable.startsWith('lc_') ? refDbTable.slice(3) : refDbTable;
              try {
                // Clean up files, menus, schema exports for this cascade table
                const result = await this.cleanupTableSoft(refTableName, projectRoot);
                deletedFiles.push(...result.deletedFiles);
                removedMenus += result.removedMenus;
              } catch { /* continue with drop even if file cleanup fails */ }
              try {
                await this.db.execute(sql.raw(`DROP TABLE IF EXISTS "${refDbTable}" CASCADE`));
              } catch { /* ignore drop failures */ }
              // Delete history records for cascade table
              try {
                await this.db
                  .delete(sysAutoCodeHistories)
                  .where(eq(sysAutoCodeHistories.tableName, refTableName));
              } catch { /* ignore */ }
            }
          }
          // Drop child detail tables for one-to-many relations (always, regardless of cascade)
          for (const field of oneToManyFields) {
            const isExisting = !!(field.relationExistingTable && field.relationTable && field.relationFkColumn);
            if (isExisting) {
              // Existing tables are only dropped in cascade mode (handled above via FK query)
              continue;
            }
            const singularMain = singularize(tableName);
            const singularField = singularize(field.name);
            const childDbName = `lc_${singularMain}_${singularField}`;
            try {
              await this.db.execute(sql.raw(`DROP TABLE IF EXISTS "${childDbName}" CASCADE`));
            } catch {
              // Child table may not exist, ignore
            }
          }
          // Finally drop the main table
          await this.db.execute(sql.raw(`DROP TABLE IF EXISTS "${dbTableName}" CASCADE`));
          droppedTable = true;
        }
      } catch {
        // Table may not exist or drop failed
      }
      await updateStep(5, 'completed');

      // Step 7: Delete all history records for this table
      await updateStep(6, 'running');
      await this.db
        .delete(sysAutoCodeHistories)
        .where(eq(sysAutoCodeHistories.tableName, tableName));
      await updateStep(6, 'completed');

      // Write final completed status
      await this.writeJobStatus(jobId, {
        jobId,
        status: 'completed',
        steps: AutocodeService.DELETE_STEPS.map((s) => ({
          key: s.key,
          label: s.label,
          status: 'completed' as const,
        })),
        progress: 100,
        currentStepLabel: '删除完成',
        result: { deletedFiles, droppedTable, removedMenus },
        completedAt: new Date().toISOString(),
      });

      setTimeout(() => this.deleteJobFile(jobId), 5 * 60 * 1000);
    } catch (err: any) {
      const errorMsg = err?.message || 'Unknown error during deletion';
      this.logger.error(` Delete job ${jobId} FAILED:`, errorMsg);

      await this.writeJobStatus(jobId, {
        jobId,
        status: 'failed',
        steps: AutocodeService.DELETE_STEPS.map(() => ({
          key: '',
          label: '',
          status: 'pending' as const,
        })),
        progress: 0,
        currentStepLabel: `失败: ${errorMsg}`,
        error: errorMsg,
      });
    }
  }

  /**
   * Start async generation with progress tracking.
   * Returns a jobId immediately; the actual work runs in the background.
   * Progress is persisted to disk so it survives nest --watch restarts.
   */
  async startGenerate(dto: AutoCodeDto): Promise<string> {
    const jobId = randomUUID();
    const steps = AutocodeService.GENERATE_STEPS.map((s) => ({
      key: s.key,
      label: s.label,
      status: 'pending' as const,
    }));

    // Write initial status
    await this.writeJobStatus(jobId, {
      jobId,
      status: 'processing',
      steps,
      progress: 0,
      currentStepLabel: '准备中...',
    });

    // Run in background (fire-and-forget)
    this.executeGenerateAsync(jobId, dto).catch((err) => {
      this.logger.error(` Unhandled error in generate job ${jobId}:`, err);
    });

    return jobId;
  }

  /**
   * Read current job status from disk.
   * Survives nest --watch restarts because status is file-based.
   */
  async getJobStatus(jobId: string): Promise<GenerateJobStatus | null> {
    return this.readJobStatus(jobId);
  }

  // =========================================================================
  // Async update with progress tracking
  // =========================================================================

  /**
   * Start async module update with progress tracking.
   * Loads the latest version, computes diff, regenerates code, syncs DB.
   * Returns a jobId immediately.
   */
  async startUpdate(dto: UpdateModuleDto): Promise<string> {
    // Validate that a version exists for this table
    const latest = await this.getLatestVersion(dto.tableName);
    if (!latest) {
      throw new NotFoundException(`No existing version found for table '${dto.tableName}'. Use generate to create it first.`);
    }

    // Check for structural changes (skip when force=true — user wants to re-apply templates)
    const oldFields = (latest.fields as AutoCodeField[]) ?? [];
    const hasChanges = this.hasStructuralChange(oldFields, dto.fields);

    if (!hasChanges && !dto.force) {
      throw new ConflictException(
        '没有检测到表结构变更（仅修改了字段描述或表描述，不影响数据库和代码）。如需修改描述，可直接编辑代码文件。',
      );
    }

    // Check for hard-removed fields (field completely missing from new list) — requires force
    const hardRemovedFields = this.getRemovedFields(oldFields, dto.fields);
    if (hardRemovedFields.length > 0 && !dto.force) {
      const fieldNames = hardRemovedFields.map((f) => `${f.name}(${f.type})`).join(', ');
      throw new ConflictException(
        `检测到字段硬删除: ${fieldNames}。硬删除将导致该列数据永久丢失！如确认删除，请勾选"确认删除字段"后重新提交。建议使用"停用"（软删除）替代。`,
      );
    }

    const jobId = randomUUID();
    const steps = AutocodeService.UPDATE_STEPS.map((s) => ({
      key: s.key,
      label: s.label,
      status: 'pending' as const,
    }));

    await this.writeJobStatus(jobId, {
      jobId,
      status: 'processing',
      steps,
      progress: 0,
      currentStepLabel: '准备更新...',
    });

    this.executeUpdateAsync(jobId, dto).catch((err) => {
      this.logger.error(` Unhandled error in update job ${jobId}:`, err);
    });

    return jobId;
  }

  private async executeUpdateAsync(jobId: string, dto: UpdateModuleDto): Promise<void> {
    const totalSteps = AutocodeService.UPDATE_STEPS.length;
    let createdFiles: string[] = [];
    let files: Record<string, string> = {};
    let projectRoot = '';

    const updateStep = async (
      stepIndex: number,
      stepStatus: GenerateStepStatus,
      message?: string,
    ) => {
      const steps: GenerateStep[] = AutocodeService.UPDATE_STEPS.map((s, i) => ({
        key: s.key,
        label: s.label,
        status: i < stepIndex
          ? 'completed' as const
          : i === stepIndex
            ? stepStatus
            : 'pending' as const,
      }));

      const progress = stepStatus === 'completed'
        ? Math.round(((stepIndex + 1) / totalSteps) * 100)
        : Math.round(((stepIndex + 0.5) / totalSteps) * 100);

      await this.writeJobStatus(jobId, {
        jobId,
        status: stepStatus === 'failed' ? 'failed' : 'processing',
        steps,
        progress,
        currentStepLabel: message || AutocodeService.UPDATE_STEPS[stepIndex]!.label,
        error: stepStatus === 'failed' ? message : undefined,
      });
    };

    try {
      // Load latest version info
      const latest = await this.getLatestVersion(dto.tableName);
      if (!latest) {
        throw new Error(`Version record for '${dto.tableName}' not found`);
      }

      const oldFields = (latest.fields as AutoCodeField[]) ?? [];
      const oldVersion = latest.version ?? 1;
      const changeLog = this.computeChangeLog(oldFields, dto.fields);

      // Build a full AutoCodeDto from the update DTO
      const autoCodeDto: AutoCodeDto = {
        tableName: dto.tableName,
        description: dto.description || '',
        fields: dto.fields,
        generateWeb: dto.generateWeb ?? true,
      };

      // Step 1: Generate code in memory
      await updateStep(0, 'running');
      files = this.preview(autoCodeDto);
      projectRoot = this.resolveProjectRoot();

      // Infer dict types for relation display fields and regenerate frontend files with dict-aware templates
      if (autoCodeDto.generateWeb) {
        const n2 = deriveNames(autoCodeDto.tableName);
        const activeDto2: AutoCodeDto = { ...autoCodeDto, fields: activeFields(autoCodeDto.fields) };
        const relationDictTypes2 = await this.lookupRelationDisplayDictTypes(activeDto2.fields);
        if ([...relationDictTypes2.values()].some((v) => v !== null)) {
          files[`apps/web/src/services/${n2.kebabSingular}.ts`] = this.generateFrontendService(activeDto2, relationDictTypes2);
          files[`apps/web/src/pages/${n2.kebabName}/index.tsx`] = this.generateFrontendPage(activeDto2, relationDictTypes2);
        }
      }

      await updateStep(0, 'completed');

      // Step 2: Write files to disk (overwrite existing)
      await updateStep(1, 'running');
      for (const [relativePath, content] of Object.entries(files)) {
        const absolutePath = path.join(projectRoot, relativePath);
        const dir = path.dirname(absolutePath);
        await fs.mkdir(dir, { recursive: true });
        await fs.writeFile(absolutePath, content, 'utf-8');
        createdFiles.push(relativePath);
      }
      // Ensure schema index export exists
      await this.updateSchemaIndex(autoCodeDto, projectRoot);
      // Register module in app.module.ts NOW — same race-condition fix as generate flow.
      await this.updateAppModule(autoCodeDto, projectRoot);
      if (autoCodeDto.generateWeb) {
        await this.updateUmiRoutes(autoCodeDto, projectRoot);
      }
      await updateStep(1, 'completed');

      // Step 3: drizzle-kit push --silent (patched, no TTY required)
      await updateStep(2, 'running', '正在同步数据库...');
      try {
        const { exec } = await import('node:child_process');
        const { promisify } = await import('node:util');
        const execAsync = promisify(exec);
        const serverDir = path.join(projectRoot, 'apps', 'server');
        await execAsync('npx --no-install drizzle-kit push --force', {
          cwd: serverDir, timeout: 60000,
          env: { ...process.env, DRIZZLE_SILENT: '1' },
        });
        this.logger.log(` drizzle-kit push (silent) completed for update '${dto.tableName}'`);
      } catch (pushErr: unknown) {
        this.logger.error(` drizzle-kit push FAILED for update '${dto.tableName}':`, pushErr);
      }
      await updateStep(2, 'completed');

      // Step 4: Save version history
      await updateStep(3, 'running');
      const updatePackageName = (dto as any).packageId
        ? await this.getPackageName((dto as any).packageId).catch(() => '')
        : '';
      try {
        await this.db.insert(sysAutoCodeHistories).values({
          packageName: updatePackageName,
          tableName: dto.tableName,
          businessDB: '',
          templates: files,
          version: oldVersion + 1,
          fields: dto.fields,
          changeLog,
          operation: 'update',
          parentId: latest.id,
        });
      } catch (historyErr: unknown) {
        this.logger.error('[AutocodeService] Failed to save update history:', historyErr);
      }
      await updateStep(3, 'completed');

      // Step 5: Update entry points (idempotent — skips if already present)
      await updateStep(4, 'running');
      await this.updateAppModule(autoCodeDto, projectRoot);
      if (dto.generateWeb) {
        await this.updateUmiRoutes(autoCodeDto, projectRoot);
      }
      await updateStep(4, 'completed');

      // Write final completed status
      await this.writeJobStatus(jobId, {
        jobId,
        status: 'completed',
        steps: AutocodeService.UPDATE_STEPS.map((s) => ({
          key: s.key,
          label: s.label,
          status: 'completed' as const,
        })),
        progress: 100,
        currentStepLabel: '模块更新完成',
        result: { createdFiles, changeLog, version: oldVersion + 1 },
        completedAt: new Date().toISOString(),
      });

      setTimeout(() => this.deleteJobFile(jobId), 5 * 60 * 1000);
    } catch (err: any) {
      const errorMsg = err?.message || 'Unknown error during update';
      this.logger.error(` Update job ${jobId} FAILED:`, errorMsg);

      await this.writeJobStatus(jobId, {
        jobId,
        status: 'failed',
        steps: AutocodeService.UPDATE_STEPS.map((s) => ({
          key: s.key,
          label: s.label,
          status: 'pending' as const,
        })),
        progress: 0,
        currentStepLabel: `失败: ${errorMsg}`,
        error: errorMsg,
      });
    }
  }

  /**
   * Background execution of all generate steps with progress persistence.
   * Steps are ordered so that critical work (DB sync, menu) happens BEFORE
   * entry point updates, which trigger nest --watch restart.
   */
  private async executeGenerateAsync(jobId: string, dto: AutoCodeDto): Promise<void> {
    const totalSteps = AutocodeService.GENERATE_STEPS.length;
    let createdFiles: string[] = [];
    let files: Record<string, string> = {};
    let projectRoot = '';

    const updateStep = async (
      stepIndex: number,
      stepStatus: GenerateStepStatus,
      message?: string,
    ) => {
      const steps: GenerateStep[] = AutocodeService.GENERATE_STEPS.map((s, i) => ({
        key: s.key,
        label: s.label,
        status: i < stepIndex
          ? 'completed' as const
          : i === stepIndex
            ? stepStatus
            : 'pending' as const,
      }));

      const progress = stepStatus === 'completed'
        ? Math.round(((stepIndex + 1) / totalSteps) * 100)
        : Math.round(((stepIndex + 0.5) / totalSteps) * 100);

      await this.writeJobStatus(jobId, {
        jobId,
        status: stepStatus === 'failed' ? 'failed' : 'processing',
        steps,
        progress,
        currentStepLabel: message || AutocodeService.GENERATE_STEPS[stepIndex]!.label,
        error: stepStatus === 'failed' ? message : undefined,
      });
    };

    try {
      // Step 0 (force mode): Clean up existing module files before regenerating
      if (dto.force) {
        const n = deriveNames(dto.tableName);
        const root = this.resolveProjectRoot();
        const expectedPaths = [
          `apps/server/src/db/schema/${n.kebabName}.ts`,
          `apps/server/src/modules/${n.kebabSingular}/${n.kebabSingular}.service.ts`,
          `apps/server/src/modules/${n.kebabSingular}/${n.kebabSingular}.controller.ts`,
          `apps/server/src/modules/${n.kebabSingular}/${n.kebabSingular}.module.ts`,
          `apps/server/src/modules/${n.kebabSingular}/dto/create-${n.kebabSingular}.dto.ts`,
          `apps/server/src/modules/${n.kebabSingular}/dto/query-${n.kebabSingular}.dto.ts`,
          `apps/server/src/modules/${n.kebabSingular}/dto/update-${n.kebabSingular}.dto.ts`,
          `apps/web/src/services/${n.kebabSingular}.ts`,
          `apps/web/src/pages/${n.kebabName}/index.tsx`,
        ];
        for (const p of expectedPaths) {
          const fullPath = path.join(root, p);
          if (existsSync(fullPath)) {
            await fs.rm(fullPath, { force: true });
          }
        }
        // Remove empty directories
        const moduleDir = path.join(root, `apps/server/src/modules/${n.kebabSingular}`);
        if (existsSync(moduleDir)) {
          try { await fs.rmdir(path.join(moduleDir, 'dto')); } catch { /* not empty */ }
          try { await fs.rmdir(moduleDir); } catch { /* not empty */ }
        }
        const pageDir = path.join(root, `apps/web/src/pages/${n.kebabName}`);
        if (existsSync(pageDir)) {
          try { await fs.rmdir(pageDir); } catch { /* not empty */ }
        }
        // Remove entry point references
        await this.removeSchemaExport(n);
        await this.removeModuleRegistration(n);
        await this.removeRouteFromUmirc(n);
        this.logger.log(` Force mode: cleaned up existing files for '${dto.tableName}'`);
      }

      // Step 1: Generate code in memory
      await updateStep(0, 'running');
      files = this.preview(dto);
      projectRoot = this.resolveProjectRoot();

      // Infer dict types for relation display fields and regenerate frontend files with dict-aware templates
      if (dto.generateWeb) {
        const n = deriveNames(dto.tableName);
        const activeDto: AutoCodeDto = { ...dto, fields: activeFields(dto.fields) };
        const relationDictTypes = await this.lookupRelationDisplayDictTypes(activeDto.fields);
        if ([...relationDictTypes.values()].some((v) => v !== null)) {
          files[`apps/web/src/services/${n.kebabSingular}.ts`] = this.generateFrontendService(activeDto, relationDictTypes);
          files[`apps/web/src/pages/${n.kebabName}/index.tsx`] = this.generateFrontendPage(activeDto, relationDictTypes);
        }
      }

      await updateStep(0, 'completed');

      // Step 2: Write files to disk
      await updateStep(1, 'running');
      for (const [relativePath, content] of Object.entries(files)) {
        const absolutePath = path.join(projectRoot, relativePath);
        const dir = path.dirname(absolutePath);
        await fs.mkdir(dir, { recursive: true });
        await fs.writeFile(absolutePath, content, 'utf-8');
        createdFiles.push(relativePath);
      }
      // Export schema from index.ts BEFORE drizzle-kit push (so drizzle-kit sees it)
      await this.updateSchemaIndex(dto, projectRoot);
      // Register module in app.module.ts NOW — before drizzle-kit triggers a tsc recompile,
      // so the first nest --watch restart already includes the new module.
      await this.updateAppModule(dto, projectRoot);
      if (dto.generateWeb) {
        await this.updateUmiRoutes(dto, projectRoot);
      }
      await updateStep(1, 'completed');

      // Step 3: drizzle-kit push --silent (patched, no TTY required)
      await updateStep(2, 'running', '正在同步数据库表...');
      try {
        const { exec } = await import('node:child_process');
        const { promisify } = await import('node:util');
        const execAsync = promisify(exec);
        const serverDir = path.join(projectRoot, 'apps', 'server');
        await execAsync('npx --no-install drizzle-kit push --force', {
          cwd: serverDir, timeout: 60000,
          env: { ...process.env, DRIZZLE_SILENT: '1' },
        });
        this.logger.log(` drizzle-kit push (silent) completed for '${dto.tableName}'`);
      } catch (pushErr: unknown) {
        this.logger.error(` drizzle-kit push FAILED for '${dto.tableName}':`, pushErr);
      }
      await updateStep(2, 'completed');

      // Step 4: Create menu
      await updateStep(3, 'running');
      let asyncMenuParentId: string | null = null;
      let asyncPackageName = '';
      if (dto.packageId) {
        try {
          const pkg = await this.findOnePackage(dto.packageId);
          asyncMenuParentId = pkg.menuId ?? null;
          asyncPackageName = pkg.name;
        } catch { /* package not found — skip parent */ }
      }
      try {
        await this.autoCreateMenu(dto, asyncMenuParentId);
      } catch (menuErr: unknown) {
        this.logger.error(` Auto-create menu FAILED for '${dto.tableName}':`, menuErr);
      }
      await updateStep(3, 'completed');

      // Step 5: Save history (with version info)
      await updateStep(4, 'running');
      try {
        // Check if there's an existing version for this table (e.g. force mode regeneration)
        const existing = await this.getLatestVersion(dto.tableName);
        const nextVersion = existing ? (existing.version ?? 1) + 1 : 1;

        await this.db.insert(sysAutoCodeHistories).values({
          packageName: asyncPackageName,
          tableName: dto.tableName,
          businessDB: (dto as any).businessDB || '',
          templates: files,
          version: nextVersion,
          fields: dto.fields,
          changeLog: dto.force ? '强制重新生成' : '初始创建',
          operation: 'create',
          parentId: existing?.id ?? null,
        });
      } catch (historyErr: unknown) {
        this.logger.error('[AutocodeService] Failed to save generation history:', historyErr);
      }
      await updateStep(4, 'completed');

      // Step 6: Update remaining entry points (LAST — triggers nest --watch restart)
      await updateStep(5, 'running');
      await this.updateAppModule(dto, projectRoot);
      if (dto.generateWeb) {
        await this.updateUmiRoutes(dto, projectRoot);
      }
      await updateStep(5, 'completed');

      // Write final completed status
      await this.writeJobStatus(jobId, {
        jobId,
        status: 'completed',
        steps: AutocodeService.GENERATE_STEPS.map((s) => ({
          key: s.key,
          label: s.label,
          status: 'completed' as const,
        })),
        progress: 100,
        currentStepLabel: '代码生成完成',
        result: { createdFiles },
        completedAt: new Date().toISOString(),
      });

      // Schedule cleanup of job file after 5 minutes
      setTimeout(() => this.deleteJobFile(jobId), 5 * 60 * 1000);
    } catch (err: any) {
      const errorMsg = err?.message || 'Unknown error during generation';
      this.logger.error(` Generate job ${jobId} FAILED:`, errorMsg);

      await this.writeJobStatus(jobId, {
        jobId,
        status: 'failed',
        steps: AutocodeService.GENERATE_STEPS.map((s, i) => ({
          key: s.key,
          label: s.label,
          status: i < AutocodeService.GENERATE_STEPS.findIndex(
            (_, idx) => idx === AutocodeService.GENERATE_STEPS.findIndex(
              (__) => __.key === err?.stepKey,
            ),
          ) ? 'completed' as const
            : i === AutocodeService.GENERATE_STEPS.findIndex(
              (__) => __.key === err?.stepKey,
            ) ? 'failed' as const
            : 'pending' as const,
        })),
        progress: 0,
        currentStepLabel: `失败: ${errorMsg}`,
        error: errorMsg,
      });
    }
  }

  // ── Job file persistence helpers ──

  private async writeJobStatus(jobId: string, status: GenerateJobStatus): Promise<void> {
    const dir = this.jobsDir;
    await fs.mkdir(dir, { recursive: true });
    await fs.writeFile(
      path.join(dir, `${jobId}.json`),
      JSON.stringify(status, null, 2),
      'utf-8',
    );
  }

  private async readJobStatus(jobId: string): Promise<GenerateJobStatus | null> {
    try {
      const filePath = path.join(this.jobsDir, `${jobId}.json`);
      const data = await fs.readFile(filePath, 'utf-8');
      return JSON.parse(data) as GenerateJobStatus;
    } catch {
      return null;
    }
  }

  private async deleteJobFile(jobId: string): Promise<void> {
    try {
      const filePath = path.join(this.jobsDir, `${jobId}.json`);
      await fs.unlink(filePath);
    } catch {
      // Ignore — file might already be cleaned up
    }
  }

  /**
   * Get list of lowcode-generated tables in the database.
   * Only returns tables with the 'lc_' prefix (lowcode business tables).
   */
  async getTables(): Promise<string[]> {
    const rows = await this.db.execute(sql`
      SELECT table_name
      FROM information_schema.tables
      WHERE table_schema = 'public'
        AND table_type = 'BASE TABLE'
        AND table_name LIKE 'lc_%'
      ORDER BY table_name
    `);
    // Return names without the lc_ prefix for cleaner display
    return rows.map((r: any) => (r.table_name as string).replace(/^lc_/, ''));
  }

  /**
   * Get metadata about available field types and templates.
   */
  getTemplates(): Record<string, unknown> {
    return {
      fieldTypes: [
        { value: 'varchar', label: 'String (varchar)', tsType: 'string', defaultLength: 255 },
        { value: 'text', label: 'Long Text (text)', tsType: 'string' },
        { value: 'integer', label: 'Integer (integer)', tsType: 'number' },
        { value: 'bigint', label: 'Big Integer (bigint)', tsType: 'number' },
        { value: 'decimal', label: 'Decimal (numeric)', tsType: 'string' },
        { value: 'boolean', label: 'Boolean (boolean)', tsType: 'boolean' },
        { value: 'timestamp', label: 'Timestamp (timestamp)', tsType: 'string' },
        { value: 'uuid', label: 'UUID (uuid)', tsType: 'string' },
        { value: 'image', label: 'Image (upload)', tsType: 'string', defaultLength: 512 },
        { value: 'file', label: 'Attachment (upload)', tsType: 'string', defaultLength: 512 },
        { value: 'relation', label: 'Relation (foreign key)', tsType: 'string', relationTypes: ['many-to-one', 'many-to-many'] },
      ],
      files: [
        { key: 'schema', label: 'Drizzle Schema', path: 'db/schema/{kebab-name}.ts' },
        { key: 'createDto', label: 'Create DTO', path: 'modules/{kebab-singular}/dto/create-{kebab-singular}.dto.ts' },
        { key: 'queryDto', label: 'Query DTO', path: 'modules/{kebab-singular}/dto/query-{kebab-singular}.dto.ts' },
        { key: 'updateDto', label: 'Update DTO', path: 'modules/{kebab-singular}/dto/update-{kebab-singular}.dto.ts' },
        { key: 'service', label: 'Service', path: 'modules/{kebab-singular}/{kebab-singular}.service.ts' },
        { key: 'controller', label: 'Controller', path: 'modules/{kebab-singular}/{kebab-singular}.controller.ts' },
        { key: 'module', label: 'Module', path: 'modules/{kebab-singular}/{kebab-singular}.module.ts' },
        { key: 'frontendService', label: 'Frontend Service', path: 'web/src/services/{kebab-singular}.ts' },
        { key: 'frontendPage', label: 'Frontend Page', path: 'web/src/pages/{kebab-name}/index.tsx' },
      ],
    };
  }

  // =========================================================================
  // History CRUD — generation history with rollback support
  // =========================================================================

  /**
   * Paginated list of generation history records.
   */
  async findAllHistory(params: { page?: number; pageSize?: number; tableName?: string }): Promise<{ list: SysAutoCodeHistory[]; total: number; page: number; pageSize: number }> {
    const page = params.page ?? 1;
    const pageSize = params.pageSize ?? 10;
    const offset = (page - 1) * pageSize;

    const conditions = [];
    if (params.tableName) {
      conditions.push(eq(sysAutoCodeHistories.tableName, params.tableName));
    }

    const whereClause = conditions.length > 0 ? and(...conditions) : undefined;

    const [rows, totalRows] = await Promise.all([
      this.db
        .select()
        .from(sysAutoCodeHistories)
        .where(whereClause)
        .orderBy(desc(sysAutoCodeHistories.createdAt))
        .limit(pageSize)
        .offset(offset),
      this.db
        .select({ count: count() })
        .from(sysAutoCodeHistories)
        .where(whereClause),
    ]);

    const total = totalRows[0]?.count ?? 0;

    return { list: rows, total, page, pageSize };
  }

  /**
   * Single history record by id.
   */
  async findOneHistory(id: string): Promise<SysAutoCodeHistory> {
    const rows = await this.db
      .select()
      .from(sysAutoCodeHistories)
      .where(eq(sysAutoCodeHistories.id, id))
      .limit(1);

    if (rows.length === 0) {
      throw new NotFoundException('History record not found');
    }

    return rows[0]!;
  }

  /**
   * Rollback to a previous generation snapshot.
   * Writes the stored templates back to disk, syncs DB via drizzle-kit push,
   * and creates a new version record with operation='rollback'.
   */
  async rollbackHistory(id: string): Promise<{ restoredFiles: string[] }> {
    const history = await this.findOneHistory(id);
    const templates = history.templates as Record<string, string>;
    const projectRoot = this.resolveProjectRoot();
    const restoredFiles: string[] = [];

    // 1. Write files from the target version
    for (const [relativePath, content] of Object.entries(templates)) {
      const absolutePath = path.join(projectRoot, relativePath);
      const dir = path.dirname(absolutePath);

      await fs.mkdir(dir, { recursive: true });
      await fs.writeFile(absolutePath, content, 'utf-8');
      restoredFiles.push(relativePath);
    }

    // 2. Sync DB schema — table already exists from original generation; rollback only restores code files

    // 3. Create a new version record for the rollback
    try {
      const latest = await this.getLatestVersion(history.tableName);
      const currentVersion = latest?.version ?? 1;
      const rollbackVersion = (history.version ?? 1);

      await this.db.insert(sysAutoCodeHistories).values({
        packageName: history.packageName,
        tableName: history.tableName,
        businessDB: history.businessDB,
        templates: history.templates,
        version: currentVersion + 1,
        fields: history.fields,
        changeLog: `回滚到版本 v${rollbackVersion}`,
        operation: 'rollback',
        parentId: latest?.id ?? null,
      });
    } catch (historyErr: unknown) {
      this.logger.error('[AutocodeService] Failed to save rollback history:', historyErr);
    }

    return { restoredFiles };
  }

  /**
   * Delete a generated module completely:
   * - generated files on disk (schema, module dir, frontend service, frontend page)
   * - .umirc.ts route entry
   * - menu entries from sys_menus + sys_role_menus
   * - database table (DROP TABLE)
   * - schema export from index.ts, module registration from app.module.ts
   * - history record
   */
  async deleteHistory(id: string): Promise<{ deletedFiles: string[]; droppedTable: boolean; removedMenus: number }> {
    const history = await this.findOneHistory(id);
    const tableName = history.tableName;
    const n = deriveNames(tableName);
    const projectRoot = this.resolveProjectRoot();

    const deletedFiles: string[] = [];
    let droppedTable = false;
    let removedMenus = 0;

    // 1. Delete generated files on disk
    const expectedPaths = [
      `apps/server/src/db/schema/${n.kebabName}.ts`,
      `apps/server/src/modules/${n.kebabSingular}/${n.kebabSingular}.service.ts`,
      `apps/server/src/modules/${n.kebabSingular}/${n.kebabSingular}.controller.ts`,
      `apps/server/src/modules/${n.kebabSingular}/${n.kebabSingular}.module.ts`,
      `apps/server/src/modules/${n.kebabSingular}/dto/create-${n.kebabSingular}.dto.ts`,
      `apps/server/src/modules/${n.kebabSingular}/dto/query-${n.kebabSingular}.dto.ts`,
      `apps/server/src/modules/${n.kebabSingular}/dto/update-${n.kebabSingular}.dto.ts`,
      `apps/web/src/services/${n.kebabSingular}.ts`,
      `apps/web/src/pages/${n.kebabName}/index.tsx`,
    ];
    for (const p of expectedPaths) {
      const fullPath = path.join(projectRoot, p);
      if (existsSync(fullPath)) {
        await fs.rm(fullPath, { force: true });
        deletedFiles.push(p);
      }
    }
    // Remove module directory if empty
    const moduleDir = path.join(projectRoot, `apps/server/src/modules/${n.kebabSingular}`);
    if (existsSync(moduleDir)) {
      try {
        await fs.rmdir(moduleDir); // only succeeds if empty
      } catch {
        // directory not empty, leave it
      }
      try {
        await fs.rmdir(path.join(moduleDir, 'dto'));
      } catch {
        // not empty or doesn't exist
      }
    }
    // Remove frontend page directory if empty
    const pageDir = path.join(projectRoot, `apps/web/src/pages/${n.kebabName}`);
    if (existsSync(pageDir)) {
      try {
        await fs.rmdir(pageDir);
      } catch {
        // not empty
      }
    }

    // 2. Remove route from .umirc.ts
    await this.removeRouteFromUmirc(n);

    // 3. Remove schema export from db/schema/index.ts
    await this.removeSchemaExport(n);

    // 4. Remove module registration from app.module.ts
    await this.removeModuleRegistration(n);

    // 5. Remove menu entries from sys_menus + sys_role_menus
    const dbTableName = `lc_${tableName}`;
    const componentPath = `./${n.kebabName}/index`;
    const menuRows = await this.db
      .select({ id: sysMenus.id, name: sysMenus.name, path: sysMenus.path })
      .from(sysMenus)
      .where(and(
        eq(sysMenus.component, componentPath),
        isNull(sysMenus.deletedAt),
      ));
    if (menuRows.length > 0) {
      const pageMenuIds = menuRows.map((m) => m.id);
      // Also find button children (menuType=3) of these page menus
      const btnChildren = await this.db
        .select({ id: sysMenus.id })
        .from(sysMenus)
        .where(
          and(
            inArray(sysMenus.parentId, pageMenuIds),
            eq(sysMenus.menuType, 3),
            isNull(sysMenus.deletedAt),
          ),
        );
      const allMenuIds = [...pageMenuIds, ...btnChildren.map((b) => b.id)];
      // Cascade-delete authority_btn entries
      await this.db
        .delete(sysAuthorityBtns)
        .where(inArray(sysAuthorityBtns.menuId, allMenuIds));
      // Remove role-menu assignments first
      await this.db.delete(sysRoleMenus).where(inArray(sysRoleMenus.menuId, allMenuIds));
      // Remove menu entries
      await this.db.delete(sysMenus).where(inArray(sysMenus.id, allMenuIds));
      removedMenus = allMenuIds.length;
    }

    // 6. Drop the database table
    try {
      const tableExists = await this.db.execute(sql`
        SELECT COUNT(*) as cnt FROM information_schema.tables
        WHERE table_schema = 'public' AND table_name = ${dbTableName}
      `);
      if ((tableExists[0] as any)?.cnt > 0) {
        await this.db.execute(sql.raw(`DROP TABLE IF EXISTS "${dbTableName}" CASCADE`));
        droppedTable = true;
      }
    } catch {
      // Table may not exist or drop failed
    }

    // 7. Delete all history records for this table
    await this.db
      .delete(sysAutoCodeHistories)
      .where(eq(sysAutoCodeHistories.tableName, tableName));

    return { deletedFiles, droppedTable, removedMenus };
  }

  // =========================================================================
  // Soft cleanup helper — delete files, menus, exports for a table (no DB drop)
  // Used by cascade delete to clean up referenced tables.
  // =========================================================================

  /**
   * Clean up generated files, menu entries, and code registrations for a table
   * WITHOUT dropping the database table.  Used for cascade-chain cleanup.
   */
  private async cleanupTableSoft(
    tableName: string,
    projectRoot: string,
  ): Promise<{ deletedFiles: string[]; removedMenus: number }> {
    const n = deriveNames(tableName);
    const deletedFiles: string[] = [];
    let removedMenus = 0;

    // 1. Delete generated files on disk
    const expectedPaths = [
      `apps/server/src/db/schema/${n.kebabName}.ts`,
      `apps/server/src/modules/${n.kebabSingular}/${n.kebabSingular}.service.ts`,
      `apps/server/src/modules/${n.kebabSingular}/${n.kebabSingular}.controller.ts`,
      `apps/server/src/modules/${n.kebabSingular}/${n.kebabSingular}.module.ts`,
      `apps/server/src/modules/${n.kebabSingular}/dto/create-${n.kebabSingular}.dto.ts`,
      `apps/server/src/modules/${n.kebabSingular}/dto/query-${n.kebabSingular}.dto.ts`,
      `apps/server/src/modules/${n.kebabSingular}/dto/update-${n.kebabSingular}.dto.ts`,
      `apps/web/src/services/${n.kebabSingular}.ts`,
      `apps/web/src/pages/${n.kebabName}/index.tsx`,
    ];
    for (const p of expectedPaths) {
      const fullPath = path.join(projectRoot, p);
      if (existsSync(fullPath)) {
        await fs.rm(fullPath, { force: true });
        deletedFiles.push(p);
      }
    }
    // Remove empty directories
    const moduleDir = path.join(projectRoot, `apps/server/src/modules/${n.kebabSingular}`);
    if (existsSync(moduleDir)) {
      try { await fs.rmdir(path.join(moduleDir, 'dto')); } catch { /* not empty */ }
      try { await fs.rmdir(moduleDir); } catch { /* not empty */ }
    }
    const pageDir = path.join(projectRoot, `apps/web/src/pages/${n.kebabName}`);
    if (existsSync(pageDir)) {
      try { await fs.rmdir(pageDir); } catch { /* not empty */ }
    }

    // 2. Remove route from .umirc.ts
    await this.removeRouteFromUmirc(n);

    // 3. Remove schema export from db/schema/index.ts
    await this.removeSchemaExport(n);

    // 4. Remove module registration from app.module.ts
    await this.removeModuleRegistration(n);

    // 5. Remove menu entries
    const componentPath = `./${n.kebabName}/index`;
    const menuRows = await this.db
      .select({ id: sysMenus.id, name: sysMenus.name })
      .from(sysMenus)
      .where(and(eq(sysMenus.component, componentPath), isNull(sysMenus.deletedAt)));
    if (menuRows.length > 0) {
      const pageMenuIds = menuRows.map((m) => m.id);
      const btnChildren = await this.db
        .select({ id: sysMenus.id })
        .from(sysMenus)
        .where(and(inArray(sysMenus.parentId, pageMenuIds), eq(sysMenus.menuType, 3), isNull(sysMenus.deletedAt)));
      const allMenuIds = [...pageMenuIds, ...btnChildren.map((b) => b.id)];
      await this.db.delete(sysAuthorityBtns).where(inArray(sysAuthorityBtns.menuId, allMenuIds));
      await this.db.delete(sysRoleMenus).where(inArray(sysRoleMenus.menuId, allMenuIds));
      await this.db.delete(sysMenus).where(inArray(sysMenus.id, allMenuIds));
      removedMenus = allMenuIds.length;

      // Remove sys_apis entries and Casbin policies
      const apiGroup = `lc/${n.kebabName}`;
      const apiRows = await this.db
        .select({ path: sysApis.path, method: sysApis.method })
        .from(sysApis)
        .where(and(eq(sysApis.apiGroup, apiGroup), isNull(sysApis.deletedAt)));
      for (const api of apiRows) {
        await this.casbin.removeFilteredPolicy(1, api.path);
      }
      await this.db
        .update(sysApis)
        .set({ deletedAt: sql`NOW()` })
        .where(and(eq(sysApis.apiGroup, apiGroup), isNull(sysApis.deletedAt)));
    }

    return { deletedFiles, removedMenus };
  }

  // =========================================================================
  // Impact analysis — analyze dependencies before delete
  // =========================================================================

  /**
   * Analyze the impact of deleting a generated module.
   * When cascade=true, recursively collects impact for all FK-referencing tables.
   */
  async analyzeImpact(
    tableName: string,
    cascade = false,
  ): Promise<{
    tableName: string;
    dbTableName: string;
    recordCount: number;
    referencedBy: Array<{ table: string; column: string; constraint: string }>;
    menus: Array<{ id: string; name: string; path: string }>;
    roleMenuCount: number;
    files: string[];
    hasHistory: boolean;
    cascadeChain?: Array<{
      autocodeTable: string;
      dbTable: string;
      recordCount: number;
      files: string[];
      menus: Array<{ id: string; name: string; path: string }>;
      hasHistory: boolean;
    }>;
  }> {
    const impact = await this.computeSingleTableImpact(tableName);

    if (!cascade) return impact;

    // Build cascade chain: for each FK-referencing table, compute its impact
    const visited = new Set<string>([impact.dbTableName]);
    const cascadeChain: Array<{
      autocodeTable: string;
      dbTable: string;
      recordCount: number;
      files: string[];
      menus: Array<{ id: string; name: string; path: string }>;
      hasHistory: boolean;
    }> = [];

    for (const ref of impact.referencedBy) {
      if (visited.has(ref.table)) continue;
      visited.add(ref.table);

      // Derive autocode table name from DB table name (strip lc_ prefix)
      const autocodeTable = ref.table.startsWith('lc_') ? ref.table.slice(3) : ref.table;

      try {
        const childImpact = await this.computeSingleTableImpact(autocodeTable);
        cascadeChain.push({
          autocodeTable,
          dbTable: ref.table,
          recordCount: childImpact.recordCount,
          files: childImpact.files,
          menus: childImpact.menus,
          hasHistory: childImpact.hasHistory,
        });
      } catch {
        // Table may not be an autocode-generated table — include basic info
        cascadeChain.push({
          autocodeTable,
          dbTable: ref.table,
          recordCount: 0,
          files: [],
          menus: [],
          hasHistory: false,
        });
      }
    }

    return { ...impact, cascadeChain };
  }

  /**
   * Compute impact for a single table (no cascade).
   */
  private async computeSingleTableImpact(tableName: string): Promise<{
    tableName: string;
    dbTableName: string;
    recordCount: number;
    referencedBy: Array<{ table: string; column: string; constraint: string }>;
    menus: Array<{ id: string; name: string; path: string }>;
    roleMenuCount: number;
    files: string[];
    hasHistory: boolean;
  }> {
    const dbTableName = `lc_${tableName}`;
    const n = deriveNames(tableName);

    // 1. Check if the DB table exists and get record count
    let recordCount = 0;
    try {
      const countRows = await this.db.execute(sql`
        SELECT COUNT(*) as cnt FROM information_schema.tables
        WHERE table_schema = 'public' AND table_name = ${dbTableName}
      `);
      if ((countRows[0] as any)?.cnt > 0) {
        const cnt = await this.db.execute(sql.raw(`SELECT COUNT(*) as cnt FROM "${dbTableName}"`));
        recordCount = Number((cnt[0] as any)?.cnt ?? 0);
      }
    } catch {
      // Table doesn't exist
    }

    // 2. Find foreign keys referencing this table
    let referencedBy: Array<{ table: string; column: string; constraint: string }> = [];
    try {
      const fkRows = await this.db.execute(sql`
        SELECT
          kcu.table_name,
          kcu.column_name,
          tc.constraint_name
        FROM information_schema.table_constraints tc
        JOIN information_schema.key_column_usage kcu
          ON tc.constraint_name = kcu.constraint_name
          AND tc.table_schema = kcu.table_schema
        JOIN information_schema.constraint_column_usage ccu
          ON tc.constraint_name = ccu.constraint_name
          AND tc.table_schema = ccu.table_schema
        WHERE tc.constraint_type = 'FOREIGN KEY'
          AND ccu.table_name = ${dbTableName}
          AND tc.table_schema = 'public'
        ORDER BY kcu.table_name, kcu.column_name
      `);
      referencedBy = fkRows.map((r: any) => ({
        table: r.table_name as string,
        column: r.column_name as string,
        constraint: r.constraint_name as string,
      }));
    } catch {
      // No foreign keys or query failed
    }

    // 3. Find menu entries
    const componentPath = `./${n.kebabName}/index`;
    const menuRows = await this.db
      .select({ id: sysMenus.id, name: sysMenus.name, path: sysMenus.path })
      .from(sysMenus)
      .where(and(
        eq(sysMenus.component, componentPath),
        isNull(sysMenus.deletedAt),
      ));
    const menus = menuRows.map((m) => ({ id: m.id, name: m.name, path: m.path ?? '' }));

    // 4. Count role-menu assignments for these menus
    let roleMenuCount = 0;
    if (menus.length > 0) {
      const menuIds = menus.map((m) => m.id);
      const rmRows = await this.db
        .select({ count: sql<number>`COUNT(*)` })
        .from(sysRoleMenus)
        .where(inArray(sysRoleMenus.menuId, menuIds));
      roleMenuCount = Number((rmRows[0] as any)?.count ?? 0);
    }

    // 5. Check generated files on disk
    const projectRoot = this.resolveProjectRoot();
    const files: string[] = [];
    const expectedPaths = [
      `apps/server/src/db/schema/${n.kebabName}.ts`,
      `apps/server/src/modules/${n.kebabSingular}/${n.kebabSingular}.service.ts`,
      `apps/server/src/modules/${n.kebabSingular}/${n.kebabSingular}.controller.ts`,
      `apps/server/src/modules/${n.kebabSingular}/${n.kebabSingular}.module.ts`,
      `apps/server/src/modules/${n.kebabSingular}/dto/create-${n.kebabSingular}.dto.ts`,
      `apps/server/src/modules/${n.kebabSingular}/dto/query-${n.kebabSingular}.dto.ts`,
      `apps/server/src/modules/${n.kebabSingular}/dto/update-${n.kebabSingular}.dto.ts`,
      `apps/web/src/services/${n.kebabSingular}.ts`,
      `apps/web/src/pages/${n.kebabName}/index.tsx`,
    ];
    for (const p of expectedPaths) {
      if (existsSync(path.join(projectRoot, p))) {
        files.push(p);
      }
    }

    // 6. Check history records
    const hasHistory = (await this.db
      .select({ id: sysAutoCodeHistories.id })
      .from(sysAutoCodeHistories)
      .where(eq(sysAutoCodeHistories.tableName, tableName))
      .limit(1)).length > 0;

    return {
      tableName,
      dbTableName,
      recordCount,
      referencedBy,
      menus,
      roleMenuCount,
      files,
      hasHistory,
    };
  }

  // =========================================================================
  // Version management helpers
  // =========================================================================

  /**
   * Pure function: compare two field arrays and generate a human-readable change log.
   */
  computeChangeLog(oldFields: AutoCodeField[], newFields: AutoCodeField[]): string {
    const changes: string[] = [];

    const oldMap = new Map(oldFields.map((f) => [f.name, f]));
    const newMap = new Map(newFields.map((f) => [f.name, f]));

    // Detect added fields
    for (const f of newFields) {
      if (!oldMap.has(f.name)) {
        changes.push(`新增字段 ${f.name}(${f.type})`);
      }
    }

    // Detect removed fields
    for (const f of oldFields) {
      if (!newMap.has(f.name)) {
        changes.push(`移除字段 ${f.name}(${f.type})`);
      }
    }

    // Detect modified fields (type change)
    for (const f of newFields) {
      const old = oldMap.get(f.name);
      if (old && old.type !== f.type) {
        changes.push(`修改字段 ${f.name}: ${old.type} → ${f.type}`);
      }
    }

    // Detect soft-removed fields (removed flag toggled)
    for (const f of newFields) {
      const old = oldMap.get(f.name);
      if (old && !old.removed && f.removed) {
        changes.push(`停用字段 ${f.name}(${f.type})`);
      }
      if (old && old.removed && !f.removed) {
        changes.push(`恢复字段 ${f.name}(${f.type})`);
      }
    }

    return changes.length > 0 ? changes.join('; ') : '无变更';
  }

  /**
   * Check if two field arrays have structural differences (name, type, required, unique, length).
   * Ignores description-only changes — those don't affect DB schema or generated code logic.
   */
  hasStructuralChange(oldFields: AutoCodeField[], newFields: AutoCodeField[]): boolean {
    const oldMap = new Map(oldFields.map((f) => [f.name, f]));
    const newMap = new Map(newFields.map((f) => [f.name, f]));

    // Different number of fields = structural change
    if (oldMap.size !== newMap.size) return true;

    // Check for added or removed fields
    for (const f of newFields) {
      if (!oldMap.has(f.name)) return true;
    }
    for (const f of oldFields) {
      if (!newMap.has(f.name)) return true;
    }

    // Check for type/required/unique/length/removed changes on existing fields
    for (const f of newFields) {
      const old = oldMap.get(f.name);
      if (!old) return true;
      if (
        old.type !== f.type ||
        old.required !== f.required ||
        old.unique !== f.unique ||
        old.length !== f.length ||
        old.relationType !== f.relationType ||
        old.relationTable !== f.relationTable ||
        old.removed !== f.removed
      ) {
        return true;
      }
    }

    return false;
  }

  /**
   * Detect which fields are being removed (exist in old but not in new).
   */
  getRemovedFields(oldFields: AutoCodeField[], newFields: AutoCodeField[]): AutoCodeField[] {
    const newNames = new Set(newFields.map((f) => f.name));
    return oldFields.filter((f) => !newNames.has(f.name));
  }

  /**
   * Get the latest version record for a given table name.
   * If the latest version has no fields snapshot (legacy record),
   * attempts to parse fields from the schema file on disk.
   */
  async getLatestVersion(tableName: string): Promise<SysAutoCodeHistory & { menuName?: string } | null> {
    const rows = await this.db
      .select()
      .from(sysAutoCodeHistories)
      .where(eq(sysAutoCodeHistories.tableName, tableName))
      .orderBy(desc(sysAutoCodeHistories.version), desc(sysAutoCodeHistories.createdAt))
      .limit(1);

    const record = rows[0] ?? null;

    // If fields snapshot is missing (legacy record), try to parse from schema file
    if (record && !record.fields) {
      const parsed = await this.parseFieldsFromSchema(tableName);
      if (parsed.length > 0) {
        (record as any).fields = parsed;
      }
    }

    // Look up menu name for description display
    if (record) {
      const n = deriveNames(tableName);
      const componentPath = `./${n.kebabName}/index`;
      const menuRows = await this.db
        .select({ name: sysMenus.name })
        .from(sysMenus)
        .where(and(eq(sysMenus.component, componentPath), isNull(sysMenus.deletedAt)))
        .limit(1);
      if (menuRows.length > 0) {
        (record as any).menuName = menuRows[0]!.name;
      }
    }

    return record;
  }

  /**
   * Parse field definitions from the generated schema file on disk.
   * Used as a fallback when version records don't have a fields snapshot.
   */
  private async parseFieldsFromSchema(tableName: string): Promise<AutoCodeField[]> {
    try {
      const n = deriveNames(tableName);
      const projectRoot = this.resolveProjectRoot();
      const schemaPath = path.join(projectRoot, 'apps/server/src/db/schema', `${n.kebabName}.ts`);

      if (!existsSync(schemaPath)) return [];

      const content = await fs.readFile(schemaPath, 'utf-8');
      const fields: AutoCodeField[] = [];

      // Match column definitions like: name: varchar('name', { length: 255 }).notNull().default(''),
      const columnPattern = /^\s+(\w+):\s+(\w+)\('(\w+)'(?:,\s*\{[^}]*\})?\)(\.notNull\(\))?(\.default\([^)]*\))?(\.references\([^)]*\))?/gm;
      let match: RegExpExecArray | null;

      while ((match = columnPattern.exec(content)) !== null) {
        const colName = match[3]!;

        // Skip system columns
        if (['id', 'created_at', 'updated_at', 'deleted_at', 'created_by', 'updated_by'].includes(colName)) {
          continue;
        }

        const drizzleType = match[2]!;
        const isNotNull = !!match[4];

        // Map drizzle type back to AutoCodeFieldType
        let fieldType: AutoCodeField['type'] = 'varchar';
        switch (drizzleType) {
          case 'varchar': fieldType = 'varchar'; break;
          case 'text': fieldType = 'text'; break;
          case 'integer': fieldType = 'integer'; break;
          case 'bigint': fieldType = 'bigint'; break;
          case 'numeric': fieldType = 'decimal'; break;
          case 'boolean': fieldType = 'boolean'; break;
          case 'timestamp': fieldType = 'timestamp'; break;
          case 'uuid':
            // If it has references, it's a relation field
            if (match[6]) {
              fieldType = 'relation';
            } else {
              fieldType = 'uuid';
            }
            break;
        }

        fields.push({
          name: colName,
          type: fieldType,
          required: isNotNull,
          unique: false,
          description: colName,
          searchable: true,
          listable: true,
          creatable: true,
          editable: true,
        });
      }

      return fields;
    } catch {
      return [];
    }
  }

  /**
   * Get all version records for a given table name, ordered by version descending.
   */
  async getHistoryVersions(tableName: string): Promise<SysAutoCodeHistory[]> {
    return this.db
      .select()
      .from(sysAutoCodeHistories)
      .where(eq(sysAutoCodeHistories.tableName, tableName))
      .orderBy(desc(sysAutoCodeHistories.version), desc(sysAutoCodeHistories.createdAt));
  }

  // =========================================================================
  // Package CRUD — reusable template packages
  // =========================================================================

  /**
   * Paginated list of template packages (excluding soft-deleted).
   */
  async findAllPackages(params: { page?: number; pageSize?: number; name?: string }): Promise<{ list: SysAutoCodePackage[]; total: number; page: number; pageSize: number }> {
    const page = params.page ?? 1;
    const pageSize = params.pageSize ?? 10;
    const offset = (page - 1) * pageSize;

    const conditions = [isNull(sysAutoCodePackages.deletedAt)];
    if (params.name) {
      conditions.push(ilike(sysAutoCodePackages.name, `%${params.name}%`));
    }

    const whereClause = and(...conditions);

    const [rows, totalRows] = await Promise.all([
      this.db
        .select()
        .from(sysAutoCodePackages)
        .where(whereClause)
        .orderBy(desc(sysAutoCodePackages.createdAt))
        .limit(pageSize)
        .offset(offset),
      this.db
        .select({ count: count() })
        .from(sysAutoCodePackages)
        .where(whereClause),
    ]);

    const total = totalRows[0]?.count ?? 0;

    return { list: rows, total, page, pageSize };
  }

  /**
   * Create a new template package. Also creates a directory menu.
   */
  async createPackage(dto: CreatePackageDto): Promise<SysAutoCodePackage> {
    const menuId = await this.ensureDirectoryMenu(dto.name);

    const rows = await this.db
      .insert(sysAutoCodePackages)
      .values({
        name: dto.name,
        description: dto.description ?? '',
        templates: dto.templates ?? {},
        tableName: dto.tableName ?? '',
        fields: dto.fields ?? null,
        generateWeb: dto.generateWeb ?? true,
        menuId,
      })
      .returning();

    return rows[0]!;
  }

  /**
   * Single package by id (excluding soft-deleted).
   */
  async findOnePackage(id: string): Promise<SysAutoCodePackage> {
    const rows = await this.db
      .select()
      .from(sysAutoCodePackages)
      .where(and(eq(sysAutoCodePackages.id, id), isNull(sysAutoCodePackages.deletedAt)))
      .limit(1);

    if (rows.length === 0) {
      throw new NotFoundException('Package not found');
    }

    return rows[0]!;
  }

  /**
   * Update an existing template package.
   */
  async updatePackage(id: string, dto: UpdatePackageDto): Promise<SysAutoCodePackage> {
    const existing = await this.findOnePackage(id);

    const updateData: Record<string, unknown> = {
      updatedAt: new Date(),
    };

    if (dto.name !== undefined) updateData.name = dto.name;
    if (dto.description !== undefined) updateData.description = dto.description;
    if (dto.templates !== undefined) updateData.templates = dto.templates;
    if (dto.tableName !== undefined) updateData.tableName = dto.tableName;
    if (dto.fields !== undefined) updateData.fields = dto.fields;
    if (dto.generateWeb !== undefined) updateData.generateWeb = dto.generateWeb;

    const rows = await this.db
      .update(sysAutoCodePackages)
      .set(updateData)
      .where(and(eq(sysAutoCodePackages.id, id), isNull(sysAutoCodePackages.deletedAt)))
      .returning();

    if (rows.length === 0) {
      throw new NotFoundException('Package not found');
    }

    return rows[0]!;
  }

  /**
   * Soft-delete a template package and its associated directory menu.
   */
  async deletePackage(id: string): Promise<void> {
    const pkg = await this.findOnePackage(id);

    // Cascade delete directory menu if it exists
    if (pkg.menuId) {
      // Find direct child menus (page menus under the directory)
      const children = await this.db
        .select({ id: sysMenus.id })
        .from(sysMenus)
        .where(eq(sysMenus.parentId, pkg.menuId));

      const childIds = children.map((c) => c.id);

      // Find button children (menuType=3) of each page child
      let btnIds: string[] = [];
      if (childIds.length > 0) {
        const btnRows = await this.db
          .select({ id: sysMenus.id })
          .from(sysMenus)
          .where(
            and(
              inArray(sysMenus.parentId, childIds),
              eq(sysMenus.menuType, 3),
              isNull(sysMenus.deletedAt),
            ),
          );
        btnIds = btnRows.map((b) => b.id);
      }

      const allMenuIds = [pkg.menuId, ...childIds, ...btnIds];

      // Delete authority_btn entries for all affected menus
      await this.db
        .delete(sysAuthorityBtns)
        .where(inArray(sysAuthorityBtns.menuId, allMenuIds));
      // Delete role-menu assignments first
      await this.db.delete(sysRoleMenus).where(inArray(sysRoleMenus.menuId, allMenuIds));
      // Delete all menus (button children → page children → directory)
      if (btnIds.length > 0) {
        await this.db.delete(sysMenus).where(inArray(sysMenus.id, btnIds));
      }
      if (childIds.length > 0) {
        await this.db.delete(sysMenus).where(inArray(sysMenus.id, childIds));
      }
      await this.db.delete(sysMenus).where(eq(sysMenus.id, pkg.menuId));
    }

    await this.db
      .update(sysAutoCodePackages)
      .set({ deletedAt: sql<Date>`NOW()` })
      .where(and(eq(sysAutoCodePackages.id, id), isNull(sysAutoCodePackages.deletedAt)));
  }

  // =========================================================================
  // Menu auto-creation
  // =========================================================================

  /**
   * Insert a menu record into sys_menus and assign it to super_admin + admin roles.
   * When parentMenuId is provided, creates as a page child under that directory.
   * Returns the created menu ID.
   */
  /** CRUD sub-route permissions — each maps a menu entry + sys_apis entry + Casbin policy */
  private static readonly CRUD_DEFS: { name: string; desc: string; method: string; suffix: string }[] = [
    { name: 'query',       desc: '查询',     method: 'GET',    suffix: '' },
    { name: 'add',         desc: '新增',     method: 'POST',   suffix: '' },
    { name: 'edit',        desc: '编辑',     method: 'PATCH',  suffix: '/:id' },
    { name: 'delete',      desc: '删除',     method: 'DELETE', suffix: '/:id' },
    { name: 'batchDelete', desc: '批量删除', method: 'DELETE', suffix: '/batch' },
  ];

  private async syncTablesToDB(dto: AutoCodeDto): Promise<void> {
    const n = deriveNames(dto.tableName);
    const mainSql = buildCreateTableSql(n.tableName, dto.fields);
    await this.db.execute(sql.raw(mainSql));

    // Create child tables for one-to-many relations
    for (const f of dto.fields) {
      if (f.type === 'relation' && f.relationType === 'one-to-many' && f.detailFields?.length) {
        const childTable = `lc_${singularize(n.tableName.replace(/^lc_/, ''))}_${singularize(f.name)}`;
        const fkCol = `${singularize(n.tableName.replace(/^lc_/, ''))}_id`;
        const childSql = buildCreateTableSql(childTable, f.detailFields, fkCol, n.tableName);
        await this.db.execute(sql.raw(childSql));
      }
    }
  }

  private async autoCreateMenu(dto: AutoCodeDto, parentMenuId?: string | null): Promise<string> {
    const n = deriveNames(dto.tableName);
    const componentName = `./${n.kebabName}/index`;

    // Compute menu path based on parent
    let menuPath = n.routePath; // default: /lc/{kebabName}
    if (parentMenuId) {
      const parentRows = await this.db
        .select({ path: sysMenus.path })
        .from(sysMenus)
        .where(eq(sysMenus.id, parentMenuId))
        .limit(1);
      if (parentRows.length > 0) {
        menuPath = `${parentRows[0].path}/${n.kebabName}`;
      }
    }

    // Skip if menu already exists
    const existing = await this.db
      .select({ id: sysMenus.id })
      .from(sysMenus)
      .where(and(eq(sysMenus.path, menuPath), isNull(sysMenus.deletedAt)))
      .limit(1);

    if (existing.length > 0) {
      return existing[0].id; // Menu already created — return existing ID
    }

    // Get current max sort among siblings
    const sortWhere = parentMenuId
      ? eq(sysMenus.parentId, parentMenuId)
      : isNull(sysMenus.parentId);
    const maxSortRows = await this.db
      .select({ maxSort: sql<number>`COALESCE(MAX(${sysMenus.sort}), -1)` })
      .from(sysMenus)
      .where(sortWhere);
    const nextSort = (maxSortRows[0]?.maxSort ?? -1) + 1;

    // Insert menu record
    const menuRows = await this.db
      .insert(sysMenus)
      .values({
        name: dto.description || n.pascalName,
        path: menuPath,
        component: componentName,
        icon: 'TableOutlined',
        parentId: parentMenuId ?? null,
        sort: nextSort,
        isVisible: 1,
        menuType: 2, // 2 = page/menu (always a page, directories are created separately)
      })
      .returning();

    const menuId = menuRows[0]!.id;

    // Assign to super_admin and admin roles
    const adminRoles = await this.db
      .select({ id: sysRoles.id, code: sysRoles.code })
      .from(sysRoles)
      .where(inArray(sysRoles.code, ['super_admin', 'admin']));

    if (adminRoles.length > 0) {
      await this.db
        .insert(sysRoleMenus)
        .values(
          adminRoles.map((role) => ({
            roleId: role.id,
            menuId,
          })),
        )
        .onConflictDoNothing();
    }

    // ── Create CRUD sub-route permissions (menuType=3) ──
    // Each CRUD action gets:
    //   1. A menuType=3 sub-menu entry (name=desc, permission=lc:{kebab}:{name})
    //   2. A sys_apis entry (method + full path + matching permission)
    //   3. Assigned to admin roles via sys_role_menus
    //   4. Casbin policies for method-level API enforcement
    //
    // Clean up old button-style entries first (migration from BTN_DEFS era)
    const oldBtnChildren = await this.db
      .select({ id: sysMenus.id })
      .from(sysMenus)
      .where(
        and(
          eq(sysMenus.parentId, menuId),
          eq(sysMenus.menuType, 3),
          isNull(sysMenus.deletedAt),
        ),
      );
    if (oldBtnChildren.length > 0) {
      const oldIds = oldBtnChildren.map((r) => r.id);
      await this.db.delete(sysAuthorityBtns).where(inArray(sysAuthorityBtns.menuId, [menuId, ...oldIds]));
      await this.db.delete(sysRoleMenus).where(inArray(sysRoleMenus.menuId, oldIds));
      await this.db.delete(sysMenus).where(inArray(sysMenus.id, oldIds));
    }

    const apiPrefix = '/api/v1/lc';
    const apiGroup = `lc/${n.kebabName}`;

    let crudCount = 0;
    for (let sort = 0; sort < AutocodeService.CRUD_DEFS.length; sort++) {
      const def = AutocodeService.CRUD_DEFS[sort]!;
      const permission = `lc:${n.kebabName}:${def.name}`;
      const apiPath = `${apiPrefix}/${n.kebabName}${def.suffix}`;

      // Skip if this sub-menu already exists under this parent
      const existingSub = await this.db
        .select({ id: sysMenus.id })
        .from(sysMenus)
        .where(
          and(
            eq(sysMenus.parentId, menuId),
            eq(sysMenus.name, def.name),
            eq(sysMenus.menuType, 3),
            isNull(sysMenus.deletedAt),
          ),
        )
        .limit(1);

      if (existingSub.length > 0) {
        crudCount++;
        continue;
      }

      // 1. Create sub-menu entry (menuType=3) with permission key
      const subRows = await this.db
        .insert(sysMenus)
        .values({
          name: def.name,
          path: null,
          component: null,
          icon: null,
          parentId: menuId,
          sort,
          isVisible: 1,
          permission,
          menuType: 3,
        })
        .returning();

      const subMenuId = subRows[0]!.id;
      crudCount++;

      // 2. Insert sys_apis entries
      // For queries (suffix=''), also register the /:id path for single-record GET
      const apiPaths = def.suffix === ''
        ? [apiPath, `${apiPath}/:id`]
        : [apiPath];

      for (const p of apiPaths) {
        const existingApi = await this.db
          .select({ id: sysApis.id })
          .from(sysApis)
          .where(
            and(
              eq(sysApis.method, def.method),
              eq(sysApis.path, p),
              isNull(sysApis.deletedAt),
            ),
          )
          .limit(1);

        if (existingApi.length === 0) {
          await this.db.insert(sysApis).values({
            method: def.method,
            path: p,
            permission,
            description: `${def.desc}${dto.description || n.pascalName}`,
            apiGroup,
          });
        }
      }

      // 3. Assign sub-menu to admin roles via sys_role_menus
      if (adminRoles.length > 0) {
        await this.db
          .insert(sysRoleMenus)
          .values(
            adminRoles.map((role) => ({
              roleId: role.id,
              menuId: subMenuId,
            })),
          )
          .onConflictDoNothing();

        // 4. Write Casbin policies for method-level enforcement
        for (const role of adminRoles) {
          for (const p of apiPaths) {
            await this.casbin.addPolicy(role.code, p, def.method);
          }
        }
      }
    }

    this.logger.log(
      `[AutocodeService] Auto-created menu '${dto.description || n.pascalName}' (${menuPath}), ` +
      `parent=${parentMenuId ?? 'root'}, assigned to ${adminRoles.length} roles, ` +
      `${crudCount} CRUD permissions`,
    );
    return menuId;
  }

  // =========================================================================
  // Package ↔ Generation integration
  // =========================================================================

  /**
   * Ensure a directory menu exists for a package name.
   * Returns the directory menu ID (existing or newly created).
   */
  private async ensureDirectoryMenu(packageName: string): Promise<string> {
    const kebabDirName = toKebabCase(packageName).replace(/[^a-z0-9-]/g, '') || 'untitled';
    const dirPath = `/pkg/${kebabDirName}`;

    // Check if directory menu already exists
    const existingMenu = await this.db
      .select({ id: sysMenus.id })
      .from(sysMenus)
      .where(and(eq(sysMenus.path, dirPath), isNull(sysMenus.deletedAt)))
      .limit(1);

    if (existingMenu.length > 0) {
      return existingMenu[0].id;
    }

    // Get max sort among root menus
    const maxSortRows = await this.db
      .select({ maxSort: sql<number>`COALESCE(MAX(${sysMenus.sort}), -1)` })
      .from(sysMenus)
      .where(isNull(sysMenus.parentId));
    const nextSort = (maxSortRows[0]?.maxSort ?? -1) + 1;

    // Create directory menu
    const menuRows = await this.db
      .insert(sysMenus)
      .values({
        name: packageName,
        path: dirPath,
        component: null,
        icon: 'AppstoreOutlined',
        parentId: null,
        sort: nextSort,
        isVisible: 1,
        menuType: 1, // directory
      })
      .returning();

    const menuId = menuRows[0]!.id;

    // Assign to admin roles
    const adminRoles = await this.db
      .select({ id: sysRoles.id })
      .from(sysRoles)
      .where(inArray(sysRoles.code, ['super_admin', 'admin']));

    if (adminRoles.length > 0) {
      await this.db
        .insert(sysRoleMenus)
        .values(adminRoles.map((role) => ({ roleId: role.id, menuId })))
        .onConflictDoNothing();
    }

    this.logger.log(` Created directory menu '${packageName}' at ${dirPath}`);
    return menuId;
  }

  /**
   * Save the current code generator form config as a template package.
   * Creates a directory menu for the package and stores the field definitions.
   */
  async saveFromConfig(dto: SaveFromConfigDto): Promise<SysAutoCodePackage> {
    const menuId = await this.ensureDirectoryMenu(dto.name);
    let templates: Record<string, string> = {};
    if (dto.generateTemplates) {
      const autoCodeDto: AutoCodeDto = {
        tableName: dto.tableName,
        description: dto.description || dto.name,
        fields: dto.fields,
        generateWeb: dto.generateWeb,
      };
      templates = this.preview(autoCodeDto);
    }

    // Insert package
    const rows = await this.db
      .insert(sysAutoCodePackages)
      .values({
        name: dto.name,
        description: dto.description ?? '',
        templates,
        tableName: dto.tableName,
        fields: dto.fields,
        generateWeb: dto.generateWeb,
        menuId,
      })
      .returning();

    const kebabDirName = toKebabCase(dto.name).replace(/[^a-z0-9-]/g, '') || 'untitled';
    this.logger.log(` Saved package '${dto.name}' with menu /pkg/${kebabDirName} (menuId=${menuId})`);
    return rows[0]!;
  }

  /**
   * Resolve a package name by ID (used internally for history association).
   */
  private async getPackageName(packageId: string): Promise<string> {
    const rows = await this.db
      .select({ name: sysAutoCodePackages.name })
      .from(sysAutoCodePackages)
      .where(and(eq(sysAutoCodePackages.id, packageId), isNull(sysAutoCodePackages.deletedAt)))
      .limit(1);
    return rows[0]?.name ?? '';
  }

  /**
   * Get a package's generation config (for "Load from Package" in the frontend).
   */
  async getPackageConfig(id: string): Promise<{
    tableName: string;
    description: string;
    fields: AutoCodeField[];
    generateWeb: boolean;
    name: string;
    menuId: string | null;
  }> {
    const pkg = await this.findOnePackage(id);
    return {
      tableName: pkg.tableName ?? '',
      description: pkg.description ?? '',
      fields: (pkg.fields as AutoCodeField[]) ?? [],
      generateWeb: pkg.generateWeb ?? true,
      name: pkg.name,
      menuId: pkg.menuId ?? null,
    };
  }

  /**
   * List all packages (lightweight, no pagination) for frontend dropdowns.
   */
  async listAllPackages(): Promise<Array<{ id: string; name: string; tableName: string; description: string }>> {
    const rows = await this.db
      .select({
        id: sysAutoCodePackages.id,
        name: sysAutoCodePackages.name,
        tableName: sysAutoCodePackages.tableName,
        description: sysAutoCodePackages.description,
      })
      .from(sysAutoCodePackages)
      .where(isNull(sysAutoCodePackages.deletedAt))
      .orderBy(desc(sysAutoCodePackages.createdAt));

    return rows.map((r) => ({
      id: r.id,
      name: r.name,
      tableName: r.tableName ?? '',
      description: r.description ?? '',
    }));
  }

  // =========================================================================
  // Entry point updaters
  // =========================================================================

  /**
   * Resolve the monorepo project root.
   * Works whether cwd is the project root or apps/server/.
   */
  private resolveProjectRoot(): string {
    const cwd = process.cwd();
    if (existsSync(path.join(cwd, 'apps', 'server', 'src'))) {
      return cwd;
    }
    // cwd is inside apps/server, go up to project root
    return path.resolve(cwd, '..', '..');
  }

  private async updateSchemaIndex(dto: AutoCodeDto, projectRoot: string): Promise<void> {
    const n = deriveNames(dto.tableName);
    const indexPath = path.join(projectRoot, 'apps/server/src/db/schema/index.ts');
    const exportLine = `export * from './${n.kebabName}.js';`;

    let content = await fs.readFile(indexPath, 'utf-8');
    if (content.includes(exportLine)) {
      return; // Already exists
    }

    content = content.trimEnd() + '\n' + exportLine + '\n';
    await fs.writeFile(indexPath, content, 'utf-8');
  }

  private async updateAppModule(dto: AutoCodeDto, projectRoot: string): Promise<void> {
    const n = deriveNames(dto.tableName);
    const modulePath = path.join(projectRoot, 'apps/server/src/app.module.ts');

    let content = await fs.readFile(modulePath, 'utf-8');

    const importLine = `import { ${n.pascalSingular}Module } from './modules/${n.kebabSingular}/${n.kebabSingular}.module';`;
    const moduleLine = `    ${n.pascalSingular}Module,`;

    // Check if already registered
    if (content.includes(importLine)) {
      return;
    }

    // Add import after the last import statement
    const lastImportMatch = content.match(/^import .+;$/gm);
    if (lastImportMatch && lastImportMatch.length > 0) {
      const lastImport = lastImportMatch[lastImportMatch.length - 1]!;
      content = content.replace(lastImport, `${lastImport}\n${importLine}`);
    }

    // Add module to imports array (before closing ])
    content = content.replace(
      /(\s+)(OperationRecordModule,)/,
      `$1$2\n${moduleLine}`,
    );

    await fs.writeFile(modulePath, content, 'utf-8');
  }

  private async updateUmiRoutes(dto: AutoCodeDto, projectRoot: string): Promise<void> {
    const n = deriveNames(dto.tableName);
    const umircPath = path.join(projectRoot, 'apps/web/.umirc.ts');
    let content = await fs.readFile(umircPath, 'utf-8');

    // Package-scoped module — nest under the package's directory route block
    if (dto.packageId) {
      let pkg: SysAutoCodePackage | null = null;
      try {
        pkg = await this.findOnePackage(dto.packageId);
      } catch { /* fall back to flat route */ }

      if (pkg?.menuId) {
        const parentMenu = await this.db
          .select({ path: sysMenus.path, name: sysMenus.name })
          .from(sysMenus)
          .where(eq(sysMenus.id, pkg.menuId))
          .limit(1);

        if (parentMenu.length > 0 && parentMenu[0].path) {
          const dirPath = parentMenu[0].path; // e.g., /pkg/test
          const dirName = parentMenu[0].name;
          const childPath = `${dirPath}/${n.kebabName}`;

          // Check if child route already exists
          if (content.includes(`path: '${childPath}'`)) return;

          const childEntry = `      { path: '${childPath}', name: '${dto.description || n.pascalName}', icon: 'TableOutlined', component: './${n.kebabName}/index' },`;

          // Look for existing directory route block for this package
          const dirMarker = `path: '${dirPath}'`;
          if (content.includes(dirMarker)) {
            // Directory block exists — append child before its closing },]
            // Find the directory block and insert before its closing ]},
            const dirRegex = new RegExp(
              `(\\{[^}]*path:\\s*'${dirPath.replace(/\//g, '\\/')}'[^}]*routes:\\s*\\[[^\\]]*)(\\][^}]*\\},)`,
              's',
            );
            const match = content.match(dirRegex);
            if (match) {
              content = content.replace(dirRegex, `$1\n${childEntry}\n      $2`);
            }
          } else {
            // No directory block yet — create one with the child
            const dirBlock = `    {
      path: '${dirPath}',
      name: '${dirName}',
      icon: 'AppstoreOutlined',
      routes: [
${childEntry}
      ],
    },`;
            content = content.replace(
              /    \{ path: '\/\*', redirect: '\/dashboard' \},?/,
              `${dirBlock}\n    { path: '/*', redirect: '/dashboard' },`,
            );
          }

          await fs.writeFile(umircPath, content, 'utf-8');
          return;
        }
      }
    }

    // Standalone module (no package) — flat leaf route
    const routePath = n.routePath; // /lc/{kebabName}

    // Check if route already exists with correct component
    const routePattern = `path: '${routePath}'`;
    if (content.includes(routePattern)) {
      // Route exists — ensure it has the component field
      if (!content.includes(`component: './${n.kebabName}/index'`)) {
        // Add missing component to existing route entry
        content = content.replace(
          new RegExp(`(path: '${routePath.replace('/', '\\/')}',[\\s\\S]*?icon: 'TableOutlined',)`, 'm'),
          `$1\n      component: './${n.kebabName}/index',`,
        );
        await fs.writeFile(umircPath, content, 'utf-8');
      }
      return;
    }

    const routeEntry = `    {
      path: '${routePath}',
      name: '${dto.description || n.pascalName}',
      icon: 'TableOutlined',
      component: './${n.kebabName}/index',
    },`;

    content = content.replace(
      /    \{ path: '\/\*', redirect: '\/dashboard' \},?/,
      `${routeEntry}\n    { path: '/*', redirect: '/dashboard' },`,
    );

    await fs.writeFile(umircPath, content, 'utf-8');
  }

  // =========================================================================
  // Delete helpers — remove generated artifacts
  // =========================================================================

  /**
   * Remove the route entry for a generated module from .umirc.ts.
   * Handles both flat routes and child routes inside package directory blocks.
   * When the last child is removed, the directory block is cleaned up too.
   */
  private async removeRouteFromUmirc(n: ReturnType<typeof deriveNames>): Promise<void> {
    const projectRoot = this.resolveProjectRoot();
    const umircPath = path.join(projectRoot, 'apps/web/.umirc.ts');
    if (!existsSync(umircPath)) return;

    let content = await fs.readFile(umircPath, 'utf-8');
    const routePath = n.routePath; // e.g. /lc/course
    const componentPath = `./${n.kebabName}/index`;

    // Remove the entire flat route block containing this path+component.
    // Matches both 4-line blocks (path/name/icon/component) and any variant,
    // as long as the block contains both the path and the component.
    const flatBlockRegex = new RegExp(
      `\\s*\\{[^{}]*path:\\s*'${routePath.replace(/\//g, '\\/')}'[^{}]*component:\\s*'${componentPath.replace(/\//g, '\\/')}'[^{}]*\\},?`,
      'gs',
    );
    if (flatBlockRegex.test(content)) {
      content = content.replace(flatBlockRegex, '');
    } else {
      // Fallback: remove only the component line (child route inside a directory block)
      const lines = content.split('\n');
      content = lines.filter((line) => !line.includes(`component: '${componentPath}'`)).join('\n');
    }

    // Clean up empty directory blocks (all children removed)
    content = content.replace(
      /    \{\n      path: '\/pkg\/[^']+',\n      name: '[^']+',\n      icon: '[^']+',\n      routes: \[\s*\],\n    \},\n?/g,
      '',
    );

    await fs.writeFile(umircPath, content, 'utf-8');
  }

  /**
   * Remove the schema export line from db/schema/index.ts.
   */
  private async removeSchemaExport(n: ReturnType<typeof deriveNames>): Promise<void> {
    const projectRoot = this.resolveProjectRoot();
    const indexPath = path.join(projectRoot, 'apps/server/src/db/schema/index.ts');
    if (!existsSync(indexPath)) return;

    let content = await fs.readFile(indexPath, 'utf-8');

    // Remove: export * from './{kebabName}.js';  (format written by updateSchemaIndex)
    const exportPattern = new RegExp(
      `export \\* from '\\.\\/${n.kebabName}\\.js';\\n?`,
    );
    content = content.replace(exportPattern, '');

    await fs.writeFile(indexPath, content, 'utf-8');
  }

  /**
   * Remove the module registration from app.module.ts.
   */
  private async removeModuleRegistration(n: ReturnType<typeof deriveNames>): Promise<void> {
    const projectRoot = this.resolveProjectRoot();
    const modulePath = path.join(projectRoot, 'apps/server/src/app.module.ts');
    if (!existsSync(modulePath)) return;

    let content = await fs.readFile(modulePath, 'utf-8');

    // Remove import line: import { XxxModule } from './modules/xxx/xxx.module';
    const importPattern = new RegExp(
      `import \\{ ${n.pascalSingular}Module \\} from '\\./modules/${n.kebabSingular}/${n.kebabSingular}\\.module';\\n?`,
    );
    content = content.replace(importPattern, '');

    // Remove module from imports array: XxxModule,
    const moduleArrayPattern = new RegExp(
      `\\s*${n.pascalSingular}Module,\\n?`,
    );
    content = content.replace(moduleArrayPattern, '');

    await fs.writeFile(modulePath, content, 'utf-8');
  }
}
