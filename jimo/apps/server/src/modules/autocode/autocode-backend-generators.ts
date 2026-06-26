import type { AutoCodeDto, AutoCodeField } from './dto/autocode.dto';
import {
  toPascalCase,
  toCamelCase,
  toKebabCase,
  singularize,
  toDrizzleType,
  toDefaultValue,
  toRequired,
  getDrizzleImportNames,
  getValidatorDecorators,
  getSwaggerProp,
  deriveNames,
} from './autocode-field-utils';

/**
 * Generate Drizzle pgTable schema definition.
 */
export function generateSchema(dto: AutoCodeDto): string {
  const n = deriveNames(dto.tableName);
  const fieldLines: string[] = ["    id: uuid('id').defaultRandom().primaryKey(),"];

  const relationFields = dto.fields.filter((f) => f.type === 'relation');
  const manyToOneFields = relationFields.filter((f) => f.relationType === 'many-to-one');
  const manyToManyFields = relationFields.filter((f) => f.relationType === 'many-to-many');
  const oneToManyFields = relationFields.filter((f) => f.relationType === 'one-to-many');

  for (const field of dto.fields) {
    if (field.type === 'relation' && field.relationType === 'one-to-many') {
      continue;
    }
    if (field.name === 'id') {
      continue;
    }

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

    let referencesClause = '';
    const isSelfRef = field.relationTable === dto.tableName;
    if (!isSelfRef && field.type === 'relation' && (field.relationType === 'many-to-one' || field.relationType === 'many-to-many') && field.relationTable) {
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
  fieldLines.push("    ownerId: uuid('owner_id'),");
  fieldLines.push("    sharedWith: jsonb('shared_with'),");

  const uniqueFields = dto.fields.filter((f) => f.unique && !(f.type === 'relation' && (f.relationType === 'one-to-many')));
  let extraClause = '';
  if (uniqueFields.length > 0) {
    const uniqueIndexes = uniqueFields.map((f) => {
      return `    uniqueIndex('idx_${dto.tableName}_${f.name}_active')\n      .on(t.${f.name})\n      .where(sql\`\${t.deletedAt} IS NULL\`),`;
    });
    extraClause = `\n  (t) => [\n${uniqueIndexes.join('\n')}\n  ],`;
  }

  const usedTypes = new Set<string>();
  usedTypes.add('uuid');
  for (const field of dto.fields) {
    if (field.type === 'relation' && field.relationType === 'one-to-many') continue;
    usedTypes.add(getDrizzleImportNames(field));
  }
  for (const field of oneToManyFields) {
    for (const df of field.detailFields || []) {
      if (df.type === 'relation' && df.relationType === 'one-to-many') {
        // Grandchild fields
        for (const gdf of df.detailFields || []) {
          if (gdf.type !== 'relation' || gdf.relationType !== 'one-to-many') {
            usedTypes.add(getDrizzleImportNames(gdf));
          }
        }
      } else {
        usedTypes.add(getDrizzleImportNames(df));
      }
    }
  }
  usedTypes.add('timestamp');
  usedTypes.add('jsonb');
  const sortedTypes = Array.from(usedTypes).sort();
  const typeImports = sortedTypes.map((t) => `  ${t},`).join('\n');

  const sqlImport = uniqueFields.length > 0 ? 'import { sql } from \'drizzle-orm\';\n' : '';
  const uniqueIndexImport = uniqueFields.length > 0 ? '  uniqueIndex,\n' : '';

  const relationImports: string[] = [];
  for (const field of [...manyToOneFields, ...manyToManyFields]) {
    if (field.relationTable === dto.tableName) continue;
    if (field.relationTable) {
      const targetNames = deriveNames(field.relationTable);
      relationImports.push(`import { ${targetNames.schemaVar} } from './${targetNames.kebabName}';`);
    }
  }

  let childTableSchemas = '';
  let existingTableSchemaImports = '';
  for (const field of oneToManyFields) {
    if (!field.detailFields || field.detailFields.length === 0) continue;
    const singularMain = singularize(dto.tableName);

    const isExisting = !!(field.relationExistingTable && field.relationTable && field.relationFkColumn);
    if (isExisting) {
      const targetNames = deriveNames(field.relationTable!);
      existingTableSchemaImports += `import { ${targetNames.schemaVar} } from './${targetNames.kebabName}';\n`;
      continue;
    }

    const singularField = singularize(field.name);
    const childTableName = `${singularMain}_${singularField}`;
    const childSchemaVar = toCamelCase(childTableName);
    const childPascalType = toPascalCase(childTableName);
    const fkColName = `${singularMain}_id`;

    const childFieldLines = ["    id: uuid('id').defaultRandom().primaryKey(),"];
    for (const df of field.detailFields) {
      if (!df.name || df.name === 'id') continue;
      if (df.type === 'relation' && df.relationType === 'one-to-many') continue;
      const drizzleType = toDrizzleType(df);
      const required = toRequired(df);
      const defaultVal = toDefaultValue(df);
      childFieldLines.push(`    ${df.name}: ${drizzleType}${required}${defaultVal},`);
    }
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

    // Second-level: grandchild tables (one-to-many within a child table)
    for (const gf of field.detailFields) {
      if (gf.type !== 'relation' || gf.relationType !== 'one-to-many') continue;
      if (!gf.detailFields || gf.detailFields.length === 0) continue;

      const singularChild = singularize(field.name);
      const singularGrand = singularize(gf.name);
      const grandTableName = `${singularMain}_${singularChild}_${singularGrand}`;
      const grandSchemaVar = toCamelCase(grandTableName);
      const grandPascalType = toPascalCase(grandTableName);
      const grandFkColName = `${singularMain}_${singularChild}_id`;

      const grandFieldLines = ["    id: uuid('id').defaultRandom().primaryKey(),"];
      for (const gdf of gf.detailFields) {
        if (!gdf.name || gdf.name === 'id') continue;
        if (gdf.type === 'relation' && gdf.relationType === 'one-to-many') continue;
        const drizzleType = toDrizzleType(gdf);
        const required = toRequired(gdf);
        const defaultVal = toDefaultValue(gdf);
        grandFieldLines.push(`    ${gdf.name}: ${drizzleType}${required}${defaultVal},`);
      }
      grandFieldLines.push(`    ${grandFkColName}: uuid('${grandFkColName}').notNull().references(() => ${childSchemaVar}.id),`);
      grandFieldLines.push("    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),");
      grandFieldLines.push("    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),");
      grandFieldLines.push("    deletedAt: timestamp('deleted_at', { withTimezone: true }),");

      childTableSchemas += `
export const ${grandSchemaVar} = pgTable(
  'lc_${grandTableName}',
  {
${grandFieldLines.join('\n')}
  },
);

export type ${grandPascalType} = typeof ${grandSchemaVar}.$inferSelect;
export type New${grandPascalType} = typeof ${grandSchemaVar}.$inferInsert;
`;
    }
  }

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
export function generateCreateDto(dto: AutoCodeDto): string {
  const n = deriveNames(dto.tableName);
  // 'code' type fields are auto-generated server-side — never user-submitted
  const creatableFields = dto.fields.filter((f) => f.creatable && f.type !== 'code');

  const fieldStrings = creatableFields.map((f) => {
    const swagger = getSwaggerProp(f, true);
    const validators = getValidatorDecorators(f, true);
    const isOptionalFK = f.type === 'relation' && !f.required;
    const dtoType = f.type === 'boolean' ? 'boolean'
      : f.type === 'integer' || f.type === 'bigint' || f.type === 'decimal' ? 'number'
      : isOptionalFK ? 'string | null'
      : 'string';
    if (f.type === 'relation' && f.relationType === 'one-to-many') {
      const arraySwagger = `  @ApiPropertyOptional({ description: '${f.description || f.name}', type: [Object] })`;
      const arrayValidator = '  @IsOptional()\n  @IsArray()';
      return `${arraySwagger}\n${arrayValidator}\n  ${f.name}?: any[];`;
    }

    const typeDecl = isOptionalFK ? `${dtoType} | null` : f.required ? dtoType : `${dtoType} | undefined`;
    return `${swagger}\n${validators}\n  ${f.name}${f.required ? '!' : '?'}: ${typeDecl};`;
  });

  const needsNumber = creatableFields.some((f) => f.type === 'integer' || f.type === 'bigint' || f.type === 'decimal');
  const needsBoolean = creatableFields.some((f) => f.type === 'boolean');
  const needsUuid = creatableFields.some((f) => f.type === 'uuid' || f.type === 'relation');
  const needsArray = creatableFields.some((f) => f.type === 'relation' && (f.relationType === 'one-to-many'));
  const needsType = needsNumber || needsBoolean;

  const validatorNames: string[] = [];
  if (creatableFields.some((f) => f.required)) {
    validatorNames.push('IsNotEmpty');
  }
  if (creatableFields.some((f) => !f.required)) {
    validatorNames.push('IsOptional');
  }
  if (creatableFields.some((f) => f.type === 'varchar' || f.type === 'text' || f.type === 'timestamp' || f.type === 'image' || f.type === 'file' || f.type === 'dict' || f.type === 'point')) {
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
export function generateQueryDto(dto: AutoCodeDto): string {
  const n = deriveNames(dto.tableName);
  const searchableFields = dto.fields.filter((f) => f.searchable);

  const isNumericType = (f: AutoCodeField) => f.type === 'integer' || f.type === 'bigint' || f.type === 'decimal';

  const fieldStrings = searchableFields.flatMap((f) => {
    if (f.type === 'relation') {
      return [`  @ApiPropertyOptional()\n  @IsOptional()\n  @IsUUID()\n  ${f.name}?: string;`];
    }
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
export function generateUpdateDto(dto: AutoCodeDto): string {
  const n = deriveNames(dto.tableName);

  return `import { PartialType } from '@nestjs/swagger';
import { Create${n.pascalSingular}Dto } from './create-${n.kebabSingular}.dto';

export class Update${n.pascalSingular}Dto extends PartialType(Create${n.pascalSingular}Dto) {}
`;
}

/**
 * Generate NestJS CRUD service.
 */
export function generateService(dto: AutoCodeDto): string {
  const n = deriveNames(dto.tableName);
  const visibilityStrategy = dto.visibilityStrategy ?? 'private';
  const searchableFields = dto.fields.filter((f) => f.searchable);
  // code fields are auto-generated server-side — never in DTO, so skip unique checks for them
  const uniqueFields = dto.fields.filter((f) => f.unique && f.type !== 'code' && !(f.type === 'relation' && (f.relationType === 'one-to-many')));
  const relationFields = dto.fields.filter((f) => f.type === 'relation');
  const manyToManyFields: AutoCodeField[] = []; // M2M merged into manyToOneFields
  const oneToManyFields = relationFields.filter((f) => f.relationType === 'one-to-many');
  const manyToOneFields = relationFields.filter((f) => f.relationType === 'many-to-one' || f.relationType === 'many-to-many');
  const manyToOneSchemaVars = new Set(manyToOneFields.filter(f => f.relationTable).map(f => deriveNames(f.relationTable!).schemaVar));

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
    } else if (field.type === 'timestamp') {
      queryFilters += `    if (${alias}) {\n      conditions.push(eq(${n.schemaVar}.${field.name}, new Date(${alias})));\n    }\n`;
    } else {
      queryFilters += `    if (${alias}) {\n      conditions.push(eq(${n.schemaVar}.${field.name}, ${alias}));\n    }\n`;
    }
  }

  const updateFields = dto.fields.filter((f) => f.editable && !(f.type === 'relation' && (f.relationType === 'one-to-many')));
  let updateDataBuilder = '';
  for (const field of updateFields) {
    const valueExpr = field.type === 'decimal' ? `String(dto.${field.name})`
      : field.type === 'timestamp' ? `dto.${field.name} ? new Date(dto.${field.name}) : undefined`
      : (field.type === 'relation' && field.relationType === 'many-to-one') ? `dto.${field.name} ?? undefined`
      : `dto.${field.name}`;
    updateDataBuilder += `    if (dto.${field.name} !== undefined) updateData.${field.name} = ${valueExpr};\n`;
  }

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

  let updateUniqueChecks = '';
  for (const field of updateFields.filter((f) => f.unique && f.type !== 'code')) {
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

  // 'code' fields are auto-generated via EncodingRuleService — never from DTO
  const creatableFields = dto.fields.filter((f) => f.creatable && !(f.type === 'relation' && (f.relationType === 'one-to-many')) && f.type !== 'code');

  const codeFields = dto.fields.filter((f) => f.type === 'code');
  const hasCodeFields = codeFields.length > 0;

  const editableFields = dto.fields.filter((f) => f.editable && !(f.type === 'relation' && (f.relationType === 'one-to-many')));
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
      fkColName = `${singularMain}_id`;
      childImports += `import { ${childSchemaVar} } from '../../db/schema/${n.kebabName}';\n`;
    }
    const detailCols = field.detailFields.filter(df => df.name !== 'id' && !(df.type === 'relation' && df.relationTable === dto.tableName) && !(df.type === 'relation' && df.relationType === 'one-to-many'));
    const childRelFields = (field.detailFields || []).filter(df => df.name !== 'id' && df.type === 'relation' && df.relationTable && df.relationTable !== dto.tableName);

    let childRelImports = '';
    let childRelSelectFields = '';
    let childRelJoins = '';
    for (const crf of childRelFields) {
      const crfTarget = deriveNames(crf.relationTable!);
      const crfDisplay = crf.relationDisplayField || 'id';
      childRelImports += `import { ${crfTarget.schemaVar} } from '../../db/schema/${crfTarget.kebabName}';\n`;
      childRelSelectFields += `\n      ${crf.name}_display: ${crfTarget.schemaVar}.${crfDisplay},`;
      childRelJoins += `\n        .leftJoin(${crfTarget.schemaVar}, eq(${childSchemaVar}.${crf.name}, ${crfTarget.schemaVar}.id))`;
    }
    if (childRelImports) childImports += childRelImports;

    // Build grandchild (one-to-many within child) field list for cascade operations
    const grandchildFields = (field.detailFields || []).filter(
      (gf) => gf.type === 'relation' && gf.relationType === 'one-to-many' && gf.detailFields && gf.detailFields.length > 0,
    );
    const grandchildAttach = grandchildFields.map((gf) => {
      const singularChild = singularize(field.name);
      const singularGrand = singularize(gf.name);
      const grandTableName = `${singularMain}_${singularChild}_${singularGrand}`;
      const grandSchemaVar2 = toCamelCase(grandTableName);
      const grandFkCol = `${singularMain}_${singularChild}_id`;
      const grandMethodName = toPascalCase(`${field.name}_${gf.name}`);
      return { grandSchemaVar2, grandFkCol, grandMethodName, gf };
    });

    const grandAttachBlock = grandchildAttach.length > 0 ? `
    if (rows.length > 0) {
      const childIds = rows.map((r) => r.id);
${grandchildAttach.map(({ grandSchemaVar2, grandFkCol, gf }) => `      const ${gf.name}Rows = await this.db.select().from(${grandSchemaVar2}).where(and(inArray(${grandSchemaVar2}.${grandFkCol}, childIds), isNull(${grandSchemaVar2}.deletedAt)));
      const ${gf.name}ByChild = new Map<string, any[]>();
      for (const r of ${gf.name}Rows) { if (r.${grandFkCol} == null) continue; const a = ${gf.name}ByChild.get(r.${grandFkCol}) || []; a.push(r); ${gf.name}ByChild.set(r.${grandFkCol}, a); }
      for (const r of rows) { (r as any).${gf.name} = ${gf.name}ByChild.get(r.id) || []; }`).join('\n')}
    }` : '';

    // When adding display fields via leftJoin, must explicitly select all needed columns
    // including id and FK — otherwise updateChildItems cannot diff by id.
    // When no join is needed, use SELECT * (empty string) which includes id automatically.
    const getSelectExpr = childRelSelectFields
      ? `{\n      id: ${childSchemaVar}.id,\n      ${fkColName}: ${childSchemaVar}.${fkColName},\n      ${detailCols.map((c: any) => `${c.name}: ${childSchemaVar}.${c.name},\n      `).join('')}${childRelSelectFields}\n    }`
      : '';
    childMethods += `
  async get${toPascalCase(field.name)}(${fkColName}: string): Promise<any[]> {
    const rows = await this.db
      .select(${getSelectExpr || ''})
      .from(${childSchemaVar})${childRelJoins}
      .where(and(eq(${childSchemaVar}.${fkColName}, ${fkColName}), isNull(${childSchemaVar}.deletedAt)));
${grandAttachBlock}
    return rows;
  }

  async create${toPascalCase(field.name)}(${fkColName}: string, details: any[]): Promise<void> {
    if (details.length === 0) return;
    const values = details.map((d) => ({
      ${fkColName},
      ${detailCols.map(c => c.type === 'decimal' ? `${c.name}: String(d.${c.name})` : c.type === 'timestamp' ? `${c.name}: d.${c.name} ? new Date(d.${c.name}) : ${c.required ? 'new Date()' : 'null'}` : `${c.name}: d.${c.name}`).join(',\n      ')},
    }));
    const inserted = await this.db.insert(${childSchemaVar}).values(values).returning();
${grandchildAttach.length > 0 ? `    for (let i = 0; i < inserted.length; i++) {
      const d = details[i];
      const childId = inserted[i].id;
${grandchildAttach.map(({ grandMethodName, gf }) => `      if (d.${gf.name} && (d.${gf.name} as any[]).length > 0) {
        await this.create${grandMethodName}(childId, d.${gf.name} as any[]);
      }`).join('\n')}
    }` : ''}
  }

  async update${toPascalCase(field.name)}(${fkColName}: string, details: any[]): Promise<void> {
    const existing = await this.get${toPascalCase(field.name)}(${fkColName});
    const existingIds = new Set(existing.map((r) => r.id));
    const incomingIds = new Set(details.filter((d) => d.id).map((d) => d.id));

    // Soft-delete rows no longer present
    const toDelete = existing.filter((r) => !incomingIds.has(r.id));
    if (toDelete.length > 0) {
${grandchildAttach.length > 0 ? `      for (const del of toDelete) {
${grandchildAttach.map(({ grandMethodName }) => `        await this.remove${grandMethodName}(del.id);`).join('\n')}
      }` : ''}
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
          ${detailCols.map(c => c.type === 'decimal' ? `${c.name}: String(d.${c.name})` : c.type === 'timestamp' ? `${c.name}: d.${c.name} ? new Date(d.${c.name}) : ${c.required ? 'new Date()' : 'null'}` : `${c.name}: d.${c.name}`).join(',\n          ')},
          updatedAt: sql\`NOW()\`,
        })
        .where(eq(${childSchemaVar}.id, d.id));
${grandchildAttach.length > 0 ? `${grandchildAttach.map(({ grandMethodName, gf }) => `      if (d.${gf.name} !== undefined) {
        await this.update${grandMethodName}(d.id, d.${gf.name} as any[]);
      }`).join('\n')}` : ''}
    }

    // Insert new rows (no id or temp id)
    const newRows = details.filter((d) => !d.id);
    if (newRows.length > 0) {
      await this.create${toPascalCase(field.name)}(${fkColName}, newRows);
    }
  }

  async remove${toPascalCase(field.name)}(${fkColName}: string): Promise<void> {
${grandchildAttach.length > 0 ? `    const childRows = await this.db.select({ id: ${childSchemaVar}.id }).from(${childSchemaVar}).where(and(eq(${childSchemaVar}.${fkColName}, ${fkColName}), isNull(${childSchemaVar}.deletedAt)));
    for (const cr of childRows) {
${grandchildAttach.map(({ grandMethodName }) => `      await this.remove${grandMethodName}(cr.id);`).join('\n')}
    }` : ''}
    await this.db
      .update(${childSchemaVar})
      .set({ deletedAt: sql\`NOW()\` })
      .where(and(eq(${childSchemaVar}.${fkColName}, ${fkColName}), isNull(${childSchemaVar}.deletedAt)));
  }
`;

    // Grandchild CRUD methods for one-to-many within this child table
    for (const gf of field.detailFields) {
      if (gf.type !== 'relation' || gf.relationType !== 'one-to-many') continue;
      if (!gf.detailFields || gf.detailFields.length === 0) continue;

      const singularChild = singularize(field.name);
      const singularGrand = singularize(gf.name);
      const grandTableName = `${singularMain}_${singularChild}_${singularGrand}`;
      const grandSchemaVar = toCamelCase(grandTableName);
      const grandFkColName = `${singularMain}_${singularChild}_id`;

      childImports += `import { ${grandSchemaVar} } from '../../db/schema/${n.kebabName}';\n`;

      const grandDetailCols = gf.detailFields.filter(
        (gdf) => gdf.name !== 'id' && !(gdf.type === 'relation' && gdf.relationType === 'one-to-many'),
      );

      const grandMethodName = toPascalCase(`${field.name}_${gf.name}`);

      childMethods += `
  async get${grandMethodName}(${grandFkColName}: string): Promise<any[]> {
    return this.db
      .select()
      .from(${grandSchemaVar})
      .where(and(eq(${grandSchemaVar}.${grandFkColName}, ${grandFkColName}), isNull(${grandSchemaVar}.deletedAt)));
  }

  async create${grandMethodName}(${grandFkColName}: string, details: any[]): Promise<void> {
    if (details.length === 0) return;
    const values = details.map((d) => ({
      ${grandFkColName},
      ${grandDetailCols.map(c => c.type === 'decimal' ? `${c.name}: String(d.${c.name})` : c.type === 'timestamp' ? `${c.name}: d.${c.name} ? new Date(d.${c.name}) : ${c.required ? 'new Date()' : 'null'}` : `${c.name}: d.${c.name}`).join(',\n      ')},
    }));
    await this.db.insert(${grandSchemaVar}).values(values);
  }

  async update${grandMethodName}(${grandFkColName}: string, details: any[]): Promise<void> {
    const existing = await this.get${grandMethodName}(${grandFkColName});
    const existingIds = new Set(existing.map((r) => r.id));
    const incomingIds = new Set(details.filter((d) => d.id).map((d) => d.id));

    const toDelete = existing.filter((r) => !incomingIds.has(r.id));
    if (toDelete.length > 0) {
      await this.db
        .update(${grandSchemaVar})
        .set({ deletedAt: sql\`NOW()\` })
        .where(and(inArray(${grandSchemaVar}.id, toDelete.map((r) => r.id)), isNull(${grandSchemaVar}.deletedAt)));
    }

    for (const d of details.filter((d) => d.id && existingIds.has(d.id))) {
      await this.db
        .update(${grandSchemaVar})
        .set({
          ${grandDetailCols.map(c => c.type === 'decimal' ? `${c.name}: String(d.${c.name})` : c.type === 'timestamp' ? `${c.name}: d.${c.name} ? new Date(d.${c.name}) : ${c.required ? 'new Date()' : 'null'}` : `${c.name}: d.${c.name}`).join(',\n          ')},
          updatedAt: sql\`NOW()\`,
        })
        .where(eq(${grandSchemaVar}.id, d.id));
    }

    const newRows = details.filter((d) => !d.id);
    if (newRows.length > 0) {
      await this.create${grandMethodName}(${grandFkColName}, newRows);
    }
  }

  async remove${grandMethodName}(${grandFkColName}: string): Promise<void> {
    await this.db
      .update(${grandSchemaVar})
      .set({ deletedAt: sql\`NOW()\` })
      .where(and(eq(${grandSchemaVar}.${grandFkColName}, ${grandFkColName}), isNull(${grandSchemaVar}.deletedAt)));
  }
`;
    }
  }

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
    : `${singularMain}_id`;
      const detailCols = (field.detailFields || []).filter(df => df.name !== 'id' && !(df.type === 'relation' && df.relationTable === dto.tableName));
      const childBatchRelFields2 = (field.detailFields || []).filter(df => df.name !== 'id' && df.type === 'relation' && df.relationTable && df.relationTable !== dto.tableName);
      let childBatchRelSelect2 = '';
      let childBatchRelJoins2 = '';
      for (const crf2 of childBatchRelFields2) {
        const crf2Target = deriveNames(crf2.relationTable!);
        const crf2Display = crf2.relationDisplayField || 'id';
        childBatchRelSelect2 += `\n          ${crf2.name}_display: ${crf2Target.schemaVar}.${crf2Display},`;
        childBatchRelJoins2 += `\n            .leftJoin(${crf2Target.schemaVar}, eq(${childSchemaVar}.${crf2.name}, ${crf2Target.schemaVar}.id))`;
      }
      const batchSelectExpr = childBatchRelSelect2
        ? `{\n          id: ${childSchemaVar}.id,\n          ${fkColName}: ${childSchemaVar}.${fkColName},${detailCols.map((c: any) => `\n          ${c.name}: ${childSchemaVar}.${c.name},`).join('')}${childBatchRelSelect2}\n        }`
        : '';
      // grandchild attach block for findAll
      const grandchildAttachInFindAll = (field.detailFields || [])
        .filter(gf => gf.type === 'relation' && gf.relationType === 'one-to-many' && gf.detailFields && gf.detailFields.length > 0)
        .map(gf => {
          const singularMain2 = singularize(dto.tableName);
          const singularChild2 = singularize(field.name);
          const singularGrand2 = singularize(gf.name);
          const grandSchemaVar2 = toCamelCase(`${singularMain2}_${singularChild2}_${singularGrand2}`);
          const grandFkCol2 = `${singularMain2}_${singularChild2}_id`;
          return `      if (${field.name}Rows.length > 0) {
        const ${field.name}ChildIds = ${field.name}Rows.map((r: any) => r.id);
        const ${gf.name}Rows2 = await this.db.select().from(${grandSchemaVar2}).where(and(inArray(${grandSchemaVar2}.${grandFkCol2}, ${field.name}ChildIds), isNull(${grandSchemaVar2}.deletedAt)));
        const ${gf.name}ByChild = new Map<string, any[]>();
        for (const r of ${gf.name}Rows2) { if (r.${grandFkCol2} == null) continue; const a = ${gf.name}ByChild.get(r.${grandFkCol2}) || []; a.push(r); ${gf.name}ByChild.set(r.${grandFkCol2}, a); }
        for (const r of ${field.name}Rows) { (r as any).${gf.name} = ${gf.name}ByChild.get(r.id) || []; }
      }`;
        }).join('\n');
	  return `      const ${field.name}Rows = await this.db
        .select(${batchSelectExpr || ''})
        .from(${childSchemaVar})${childBatchRelJoins2}
        .where(and(inArray(${childSchemaVar}.${fkColName}, masterIds), isNull(${childSchemaVar}.deletedAt)));
${grandchildAttachInFindAll ? grandchildAttachInFindAll + '\n' : ''}      const ${field.name}ByMaster = new Map<string, any[]>();
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

  const oneToManyAttachInFindOne = oneToManyFields.map((field) => `    (rows[0] as any).${field.name} = await this.get${toPascalCase(field.name)}(id);`).join('\n');

  const oneToManyRemoveCleanup = oneToManyFields.map((field) => `    await this.remove${toPascalCase(field.name)}(id);
`).join('');

  const oneToManyBatchRemoveCleanup = oneToManyFields.length > 0 ? `    // Remove child detail rows for each id
    for (const id of ids) {
      try {
${oneToManyFields.map((field) => `        await this.remove${toPascalCase(field.name)}(id);`).join('\n')}
      } catch {
        // Record may not exist, ignore
      }
    }
` : '';

  const hasManyToOne = manyToOneFields.length > 0;
  const hasSelfRef = manyToOneFields.some((f) => f.relationTable === dto.tableName);
  let manyToOneSchemaImports = '';
  let manyToOneSelectFields = '';
  let manyToOneJoins = '';
  let selfRefSelects = '';
  let selfRefJoins = '';
  for (const f of manyToOneFields) {
    if (!f.relationTable) continue;
    if (f.relationTable === dto.tableName) {
      selfRefSelects += `\n      ${f.name}_display: parent_alias.${f.relationDisplayField || 'id'},`;
      selfRefJoins += `\n        .leftJoin(parent_alias, eq(${n.schemaVar}.${f.name}, parent_alias.id))`;
      continue;
    }
    const targetNames = deriveNames(f.relationTable);
    const displayField = f.relationDisplayField || 'id';
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
${hasSelfRef ? "import { alias } from 'drizzle-orm/pg-core';\n" : ''}import { DATABASE_CONNECTION, DrizzleDb } from '../../db/connection';
import { OwnershipHelper } from '../../common/ownership/ownership.helper';
import { ${n.schemaVar}, ${n.schemaType} } from '../../db/schema/${n.kebabName}';
${manyToOneSchemaImports}${childImports}${hasCodeFields ? "import { EncodingRuleService } from '../encoding-rule/encoding-rule.service.js';\n" : ''}import { Create${n.pascalSingular}Dto } from './dto/create-${n.kebabSingular}.dto';
import { Update${n.pascalSingular}Dto } from './dto/update-${n.kebabSingular}.dto';
import { Query${n.pascalSingular}Dto } from './dto/query-${n.kebabSingular}.dto';
import { ApiErrorCode, PaginatedData } from '@jimo/shared';
import { SQL } from 'drizzle-orm';

@Injectable()
export class ${n.pascalSingular}Service {
  constructor(
    @Inject(DATABASE_CONNECTION) private readonly db: DrizzleDb,${hasCodeFields ? `\n    private readonly encodingRuleService: EncodingRuleService,` : ''}
    private readonly ownershipHelper: OwnershipHelper,
  ) {}

  async findAll(query: Query${n.pascalSingular}Dto, userId?: string, isAdmin: boolean = false): Promise<PaginatedData<${n.schemaType}>> {
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
${visibilityStrategy === 'department' ? `    const _deptScope = userId ? await this.ownershipHelper.viewerDeptScope(userId) : undefined;
    const _ownership = this.ownershipHelper.visibleCondition(${n.schemaVar}.ownerId, ${n.schemaVar}.sharedWith, userId, isAdmin, 'department', _deptScope);` : `    const _ownership = this.ownershipHelper.visibleCondition(${n.schemaVar}.ownerId, ${n.schemaVar}.sharedWith, userId, isAdmin, '${visibilityStrategy}');`}
    if (_ownership) conditions.push(_ownership);

${queryFilters}
    const whereClause = and(...conditions);
${hasSelfRef ? `    const parent_alias = alias(${n.schemaVar}, 'parent_alias');\n` : ''}
    const [rows, totalRows] = await Promise.all([
      this.db
        .select(${hasManyToOne ? `{
          ...getTableColumns(${n.schemaVar}),${manyToOneSelectFields}${selfRefSelects}
        }` : ``})
        .from(${n.schemaVar})${manyToOneJoins}${selfRefJoins}
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

  async findOne(id: string, userId?: string, isAdmin: boolean = false): Promise<${n.schemaType}> {
    const conditions = [eq(${n.schemaVar}.id, id), isNull(${n.schemaVar}.deletedAt)];
    ${visibilityStrategy === 'department' ? `const _deptScope = userId ? await this.ownershipHelper.viewerDeptScope(userId) : undefined;
    const _ownership = this.ownershipHelper.visibleCondition(${n.schemaVar}.ownerId, ${n.schemaVar}.sharedWith, userId, isAdmin, '${visibilityStrategy}', _deptScope);` : `const _ownership = this.ownershipHelper.visibleCondition(${n.schemaVar}.ownerId, ${n.schemaVar}.sharedWith, userId, isAdmin, '${visibilityStrategy}');`}
    if (_ownership) conditions.push(_ownership);
${hasSelfRef ? `    const parent_alias = alias(${n.schemaVar}, 'parent_alias');\n` : ''}    const rows = await this.db
      .select(${hasManyToOne ? `{
        ...getTableColumns(${n.schemaVar}),${manyToOneSelectFields}${selfRefSelects}
      }` : ``})
      .from(${n.schemaVar})${manyToOneJoins}${selfRefJoins}
      .where(and(...conditions))
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

  async create(dto: Create${n.pascalSingular}Dto, userId?: string): Promise<${n.schemaType}> {
${uniqueChecks}${hasCodeFields ? codeFields.map(f => `    const ${f.name} = await this.encodingRuleService.generateNext('${f.ruleId ?? ''}');`).join('\n') + '\n' : ''}${oneToManyFields.length > 0 ? `
    return this.db.transaction(async (tx) => {
      const rows = await tx
        .insert(${n.schemaVar})
        .values({
          ownerId: userId,
${creatableFields.map(f => f.type === 'decimal' ? `          ${f.name}: String(dto.${f.name}),` : f.type === 'timestamp' ? `          ${f.name}: dto.${f.name} ? new Date(dto.${f.name}) : ${f.required ? 'new Date()' : 'null'},` : `          ${f.name}: dto.${f.name},`).join('\n')}${hasCodeFields ? '\n' + codeFields.map(f => `          ${f.name},`).join('\n') : ''}
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
    : `${singularMain}_id`;
  const detailCols = (field.detailFields || []).filter(df => df.name !== 'id' && !(df.type === 'relation' && df.relationTable === dto.tableName));
  return `      if (dto.${field.name} && (dto.${field.name} as any[]).length > 0) {
        await tx.insert(${childSchemaVar}).values(
          (dto.${field.name} as any[]).map((d: any) => ({
            ${fkColName}: created.id,
            ${detailCols.map(c => c.type === 'decimal' ? `${c.name}: String(d.${c.name})` : c.type === 'timestamp' ? `${c.name}: d.${c.name} ? new Date(d.${c.name}) : ${c.required ? 'new Date()' : 'null'}` : `${c.name}: d.${c.name}`).join(',\n            ')},
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
        ownerId: userId,
${creatableFields.map(f => f.type === 'decimal' ? `        ${f.name}: String(dto.${f.name}),` : f.type === 'timestamp' ? `        ${f.name}: dto.${f.name} ? new Date(dto.${f.name}) : ${f.required ? 'new Date()' : 'null'},` : `        ${f.name}: dto.${f.name},`).join('\n')}${hasCodeFields ? '\n' + codeFields.map(f => `        ${f.name},`).join('\n') : ''}
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

  async update(id: string, dto: Update${n.pascalSingular}Dto, userId?: string, isAdmin: boolean = false): Promise<${n.schemaType}> {
    const existing = await this.findOne(id, userId, isAdmin);

${updateUniqueChecks}
    type ${n.pascalSingular}UpdateFields = {
${editableFields.map(f => {
      const tsType = f.type === 'boolean' ? 'boolean' : f.type === 'integer' || f.type === 'bigint' ? 'number' : f.type === 'timestamp' ? 'Date' : 'string';
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
      .where(
        isAdmin
          ? and(eq(${n.schemaVar}.id, id), isNull(${n.schemaVar}.deletedAt))
          : and(eq(${n.schemaVar}.id, id), isNull(${n.schemaVar}.deletedAt), eq(${n.schemaVar}.ownerId, userId!)),
      )
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

  async remove(id: string, userId?: string, isAdmin: boolean = false): Promise<void> {
    await this.findOne(id, userId, isAdmin);

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
      .where(
        isAdmin
          ? and(eq(${n.schemaVar}.id, id), isNull(${n.schemaVar}.deletedAt))
          : and(eq(${n.schemaVar}.id, id), isNull(${n.schemaVar}.deletedAt), eq(${n.schemaVar}.ownerId, userId!)),
      );
  }

  async batchRemove(ids: string[], userId?: string, isAdmin: boolean = false): Promise<{ count: number }> {
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
      .where(
        isAdmin
          ? and(inArray(${n.schemaVar}.id, ids), isNull(${n.schemaVar}.deletedAt))
          : and(inArray(${n.schemaVar}.id, ids), isNull(${n.schemaVar}.deletedAt), eq(${n.schemaVar}.ownerId, userId!)),
      )
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
export function generateController(dto: AutoCodeDto): string {
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
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import { ${n.pascalSingular}Service } from './${n.kebabSingular}.service';
import { Create${n.pascalSingular}Dto } from './dto/create-${n.kebabSingular}.dto';
import { Update${n.pascalSingular}Dto } from './dto/update-${n.kebabSingular}.dto';
import { Query${n.pascalSingular}Dto } from './dto/query-${n.kebabSingular}.dto';
import { BatchDeleteDto } from '../../common/dto/batch-delete.dto';
import {
  ApiResponse as ApiResp,
  PaginatedResponse,
} from '@jimo/shared';
import { ${n.schemaType} } from '../../db/schema/${n.kebabName}';

@ApiTags('lc/${n.kebabName}')
@ApiBearerAuth()
@Controller('lc/${n.kebabName}')
export class ${n.pascalSingular}Controller {
  constructor(private readonly ${n.camelSingular}Service: ${n.pascalSingular}Service) {}

  @Get()
  @ApiOperation({ summary: 'Get paginated list of ${n.kebabName}' })
  @ApiResponse({ status: 200, description: 'Returns paginated ${n.kebabName}' })
  async findAll(@Query() query: Query${n.pascalSingular}Dto, @CurrentUser() user: { sub: string; roles: string[] }): Promise<PaginatedResponse<${n.schemaType}>> {
    const roles = user?.roles ?? [];
    const isAdmin = roles.includes('super_admin') || roles.includes('admin');
    const data = await this.${n.camelSingular}Service.findAll(query, user?.sub, isAdmin);
    return { code: 0, msg: 'success', data };
  }

  @Get(':id')
  @ApiOperation({ summary: 'Get ${n.kebabSingular} by id' })
  @ApiResponse({ status: 200, description: 'Returns the ${n.kebabSingular}' })
  @ApiResponse({ status: 404, description: '${n.pascalSingular} not found' })
  async findOne(@Param('id') id: string, @CurrentUser() user: { sub: string; roles: string[] }): Promise<ApiResp<${n.schemaType}>> {
    const roles = user?.roles ?? [];
    const isAdmin = roles.includes('super_admin') || roles.includes('admin');
    const data = await this.${n.camelSingular}Service.findOne(id, user?.sub, isAdmin);
    return { code: 0, msg: 'success', data };
  }

  @Post()
  @HttpCode(HttpStatus.CREATED)
  @ApiOperation({ summary: 'Create a new ${n.kebabSingular}' })
  @ApiResponse({ status: 201, description: '${n.pascalSingular} created successfully' })
  @ApiResponse({ status: 409, description: 'Unique constraint conflict' })
  async create(@Body() dto: Create${n.pascalSingular}Dto, @CurrentUser() user: { sub: string }): Promise<ApiResp<${n.schemaType}>> {
    const data = await this.${n.camelSingular}Service.create(dto, user?.sub);
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
    @CurrentUser() user: { sub: string; roles: string[] },
  ): Promise<ApiResp<${n.schemaType}>> {
    const roles = user?.roles ?? [];
    const isAdmin = roles.includes('super_admin') || roles.includes('admin');
    const data = await this.${n.camelSingular}Service.update(id, dto, user?.sub, isAdmin);
    return { code: 0, msg: 'success', data };
  }

  @Delete('batch')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Batch delete ${n.kebabName} by ids' })
  @ApiResponse({ status: 200, description: '${n.pascalName} deleted successfully' })
  async batchRemove(@Body() dto: BatchDeleteDto, @CurrentUser() user: { sub: string; roles: string[] }): Promise<ApiResp<{ count: number }>> {
    const roles = user?.roles ?? [];
    const isAdmin = roles.includes('super_admin') || roles.includes('admin');
    const data = await this.${n.camelSingular}Service.batchRemove(dto.ids, user?.sub, isAdmin);
    return { code: 0, msg: 'success', data };
  }

  @Delete(':id')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Delete ${n.kebabSingular} by id' })
  @ApiResponse({ status: 200, description: '${n.pascalSingular} deleted successfully' })
  @ApiResponse({ status: 404, description: '${n.pascalSingular} not found' })
  async remove(@Param('id') id: string, @CurrentUser() user: { sub: string; roles: string[] }): Promise<ApiResp<null>> {
    const roles = user?.roles ?? [];
    const isAdmin = roles.includes('super_admin') || roles.includes('admin');
    await this.${n.camelSingular}Service.remove(id, user?.sub, isAdmin);
    return { code: 0, msg: 'success', data: null };
  }
}
`;
}

/**
 * Generate NestJS module file.
 */
export function generateModule(dto: AutoCodeDto): string {
  const n = deriveNames(dto.tableName);
  const hasCodeFields = dto.fields.some((f) => f.type === 'code');

  return `import { Module } from '@nestjs/common';
import { ${n.pascalSingular}Controller } from './${n.kebabSingular}.controller';
import { ${n.pascalSingular}Service } from './${n.kebabSingular}.service';${hasCodeFields ? `\nimport { EncodingRuleModule } from '../encoding-rule/encoding-rule.module.js';` : ''}

@Module({${hasCodeFields ? `\n  imports: [EncodingRuleModule],` : ''}
  controllers: [${n.pascalSingular}Controller],
  providers: [${n.pascalSingular}Service],
  exports: [${n.pascalSingular}Service],
})
export class ${n.pascalSingular}Module {}
`;
}

// ---------------------------------------------------------------------------
// Agent service / module generators
// ---------------------------------------------------------------------------

/**
 * Build a JSON Schema property string for a single AutoCodeField.
 */
function fieldToJsonSchemaProp(f: AutoCodeField): string {
  const desc = (f.description || f.name).replace(/'/g, "\\'");
  let typeStr: string;
  switch (f.type) {
    case 'integer': case 'bigint': typeStr = 'number'; break;
    case 'decimal': typeStr = 'string'; break;
    case 'boolean': typeStr = 'boolean'; break;
    case 'timestamp': typeStr = 'string'; break;
    case 'uuid': typeStr = 'string'; break;
    case 'relation': typeStr = 'string'; break;
    case 'dict': typeStr = 'string'; break;
    default: typeStr = 'string'; break;
  }
  return `{ type: '${typeStr}', description: '${desc}' }`;
}

/**
 * Generate EntityAgentService that wraps entity CRUD as AI-callable tools.
 */
export function generateAgentService(dto: AutoCodeDto): string {
  const n = deriveNames(dto.tableName);
  const enabledTools = dto.agentConfig?.tools ?? ['query', 'create', 'update', 'delete', 'search', 'mock'];

  const creatableFields = dto.fields.filter(
    (f) => f.creatable && !(f.type === 'relation' && f.relationType === 'one-to-many') && f.type !== 'code',
  );
  const editableFields = dto.fields.filter(
    (f) => f.editable && !(f.type === 'relation' && f.relationType === 'one-to-many'),
  );
  const searchableFields = dto.fields.filter((f) => f.searchable);
  const requiredCreatable = creatableFields.filter((f) => f.required);

  const tools: string[] = [];

  // ---- query tool ----
  if (enabledTools.includes('query')) {
    tools.push(`    query_${n.camelName}: {
      description: 'Get a ${n.kebabSingular} record by ID',
      parameters: {
        type: 'object',
        properties: { id: { type: 'string', description: 'Record UUID' } },
        required: ['id'],
      },
      execute: async (args: { id: string }) => {
        return this.${n.camelSingular}Service.findOne(args.id, userId, true);
      },
    }`);
  }

  // ---- create tool ----
  if (enabledTools.includes('create') && creatableFields.length > 0) {
    const createProps = creatableFields.map((f) => `        ${f.name}: ${fieldToJsonSchemaProp(f)},`).join('\n');
    const createReq = requiredCreatable.map((f) => `'${f.name}'`).join(', ');
    tools.push(`    create_${n.camelName}: {
      description: 'Create a new ${n.kebabSingular} record',
      parameters: {
        type: 'object',
        properties: {
${createProps}
        },
        required: [${createReq}],
      },
      execute: async (args: any) => {
        return this.${n.camelSingular}Service.create(args, userId);
      },
    }`);
  }

  // ---- update tool ----
  if (enabledTools.includes('update') && editableFields.length > 0) {
    const updateProps = editableFields.map((f) => `        ${f.name}: ${fieldToJsonSchemaProp(f)},`).join('\n');
    tools.push(`    update_${n.camelName}: {
      description: 'Update a ${n.kebabSingular} record',
      parameters: {
        type: 'object',
        properties: {
          id: { type: 'string', description: 'Record UUID' },
${updateProps}
        },
        required: ['id'],
      },
      execute: async (args: any) => {
        return this.${n.camelSingular}Service.update(args.id, args, userId, true);
      },
    }`);
  }

  // ---- delete tool ----
  if (enabledTools.includes('delete')) {
    tools.push(`    delete_${n.camelName}: {
      description: 'Soft-delete a ${n.kebabSingular} record by ID',
      parameters: {
        type: 'object',
        properties: { id: { type: 'string', description: 'Record UUID' } },
        required: ['id'],
      },
      execute: async (args: { id: string }) => {
        await this.${n.camelSingular}Service.remove(args.id, userId, true);
        return { deleted: args.id };
      },
    }`);
  }

  // ---- search tool ----
  if (enabledTools.includes('search')) {
    const searchProps = ['page', 'pageSize', ...searchableFields.map((f) => f.name)];
    const propLines: string[] = [];
    propLines.push('        page: { type: \'number\', description: \'Page number (1-based)\' },');
    propLines.push('        pageSize: { type: \'number\', description: \'Items per page\' },');
    for (const f of searchableFields) {
      if (f.type === 'relation') continue;
      if (f.type === 'integer' || f.type === 'bigint' || f.type === 'decimal') {
        propLines.push(`        ${f.name}Min: { type: 'number', description: '${f.description || f.name} minimum' },`);
        propLines.push(`        ${f.name}Max: { type: 'number', description: '${f.description || f.name} maximum' },`);
      } else {
        propLines.push(`        ${f.name}: ${fieldToJsonSchemaProp(f)},`);
      }
    }
    tools.push(`    search_${n.camelName}: {
      description: 'Search ${n.kebabName} with filters and pagination',
      parameters: {
        type: 'object',
        properties: {
${propLines.join('\n')}
        },
      },
      execute: async (args: any) => {
        return this.${n.camelSingular}Service.findAll(args, userId, true);
      },
    }`);
  }

  // ---- mock tool ----
  if (enabledTools.includes('mock')) {
    tools.push(`    mock_${n.camelName}: {
      description: 'Generate mock data rows for ${n.kebabName}',
      parameters: {
        type: 'object',
        properties: { count: { type: 'number', description: 'Number of mock rows (1-100)' } },
      },
      execute: async (args: { count?: number }) => {
        const result = await this.autocodeService.generateMockForTable('${dto.tableName}', args.count ?? 10);
        return { ok: true, inserted: result.inserted };
      },
    }`);
  }

  const systemPrompt = dto.agentConfig?.systemPrompt ?? '';

  return `import { Injectable, Inject } from '@nestjs/common';
import { DATABASE_CONNECTION, DrizzleDb } from '../../../db/connection';
import { ${n.pascalSingular}Service } from '../${n.kebabSingular}.service';
import { AutocodeService } from '../../autocode/autocode.service';

/**
 * Entity agent service for ${n.kebabName}.
 * Wraps CRUD operations as AI-callable tool definitions.
${systemPrompt ? ` * System prompt: ${systemPrompt}` : ''}
 */
@Injectable()
export class ${n.pascalSingular}AgentService {
  constructor(
    private readonly ${n.camelSingular}Service: ${n.pascalSingular}Service,
    @Inject(DATABASE_CONNECTION) private readonly db: DrizzleDb,
    private readonly autocodeService: AutocodeService,
  ) {}

  /**
   * Return AI-callable tool definitions scoped to the given user.
   * Tools are compatible with the Vercel AI SDK streamText() tools parameter.
   */
  getTools(userId: string): Record<string, any> {
    return {
${tools.join(',\n\n')},
    };
  }
}
`;
}

/**
 * Generate NestJS module file for the entity agent service.
 */
export function generateAgentModule(dto: AutoCodeDto): string {
  const n = deriveNames(dto.tableName);

  return `import { Module } from '@nestjs/common';
import { ${n.pascalSingular}Module } from '../${n.kebabSingular}.module';
import { AutocodeModule } from '../../autocode/autocode.module';
import { ${n.pascalSingular}AgentService } from './${n.kebabSingular}.agent.service';

@Module({
  imports: [${n.pascalSingular}Module, AutocodeModule],
  providers: [${n.pascalSingular}AgentService],
  exports: [${n.pascalSingular}AgentService],
})
export class ${n.pascalSingular}AgentModule {}
`;
}
