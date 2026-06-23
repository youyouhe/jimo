import type { AutoCodeField } from './dto/autocode.dto';
// zh_CN locale for high-quality localized demo data
import { fakerZH_CN as faker } from '@faker-js/faker';

// ---------------------------------------------------------------------------
// Name conversion helpers
// ---------------------------------------------------------------------------

export function toPascalCase(name: string): string {
  if (!name) return '';
  return name
    .split('_')
    .map((word) => word.charAt(0).toUpperCase() + word.slice(1).toLowerCase())
    .join('');
}

export function toCamelCase(name: string): string {
  if (!name) return '';
  const pascal = toPascalCase(name);
  return pascal.charAt(0).toLowerCase() + pascal.slice(1);
}

export function toKebabCase(name: string): string {
  if (name.includes('_')) {
    return name.toLowerCase().replace(/_/g, '-');
  }
  return name
    .replace(/([a-z0-9])([A-Z])/g, '$1-$2')
    .replace(/([A-Z])([A-Z][a-z])/g, '$1-$2')
    .toLowerCase();
}

export function singularize(word: string): string {
  if (!word) return '';
  if (word.endsWith('ies')) return word.slice(0, -3) + 'y';
  if (word.endsWith('ses')) return word.slice(0, -2);
  if (word.endsWith('s') && !word.endsWith('ss')) return word.slice(0, -1);
  return word;
}

// ---------------------------------------------------------------------------
// Type mapper
// ---------------------------------------------------------------------------

export function toTsType(field: AutoCodeField): string {
  switch (field.type) {
    case 'varchar':
    case 'text':
    case 'timestamp':
    case 'uuid':
    case 'image':
    case 'file':
    case 'relation':
    case 'dict':
    case 'code':
    case 'point':
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

export function toDrizzleType(field: AutoCodeField): string {
  switch (field.type) {
    case 'varchar':
      return `varchar('${field.name}', { length: ${field.length || 255} })`;
    case 'image':
    case 'file':
      return `varchar('${field.name}', { length: 512 })`;
    case 'dict':
      return `varchar('${field.name}', { length: ${field.length || 64} })`;
    case 'code':
      return `varchar('${field.name}', { length: 100 })`;
    case 'text':
    case 'point':
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

export function toDefaultValue(field: AutoCodeField): string {
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
      case 'code':
        return `.default('')`;
      case 'point':
        return '';
      default:
        return '';
    }
  }
  return '';
}

export function toRequired(field: AutoCodeField): string {
  return field.required ? '.notNull()' : '';
}

/**
 * Filter out removed fields for business code generation.
 * Removed fields are kept in schema (DB column preserved) but excluded from
 * DTOs, services, controllers, and frontend code.
 */
export function activeFields(fields: AutoCodeField[]): AutoCodeField[] {
  return fields.filter((f) => !f.removed);
}

// ---------------------------------------------------------------------------
// Direct SQL DDL helpers (replaces drizzle-kit push to avoid TTY requirement)
// ---------------------------------------------------------------------------

export function toSqlColumnDef(field: AutoCodeField): string {
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
    case 'code':
      colType = 'VARCHAR(100)';
      break;
    case 'text':
    case 'point':
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

export function buildCreateTableSql(tableName: string, fields: AutoCodeField[], fkName?: string, fkRef?: string): string {
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
  cols.push(`  "owner_id" uuid`);
  cols.push(`  "shared_with" jsonb DEFAULT '[]'::jsonb`);
  return `CREATE TABLE IF NOT EXISTS "${tableName}" (\n${cols.join(',\n')}\n)`;
}

// ---------------------------------------------------------------------------
// Derived names for a table definition
// ---------------------------------------------------------------------------

export interface DerivedNames {
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
  /** 前端隔离路径 —— 业务表前端产物落在 lc/ 子目录,与系统页面物理隔离,杜绝同名占用 */
  pageDir: string; // lc/<kebabName> — fs 路径段,拼成 pages/${pageDir}/index.tsx
  pageComponentPath: string; // ./lc/<kebabName>/index — .umirc.ts component + sysMenus.component
  pageMapComponentPath: string; // ./lc/<kebabName>/map
  serviceRelDir: string; // lc/<kebabSingular> — fs 路径段,拼成 services/${serviceRelDir}.ts
  serviceImportAlias: string; // @/services/lc/<kebabSingular> — 前端 generator 内 import
}

export function deriveNames(tableName: string): DerivedNames {
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
    pageDir: `lc/${kebabName}`,
    pageComponentPath: `./lc/${kebabName}/index`,
    pageMapComponentPath: `./lc/${kebabName}/map`,
    serviceRelDir: `lc/${kebabSingular}`,
    serviceImportAlias: `@/services/lc/${kebabSingular}`,
  };
}

// ---------------------------------------------------------------------------
// Drizzle column type names for import filtering
// ---------------------------------------------------------------------------

export function getDrizzleImportNames(field: AutoCodeField): string {
  switch (field.type) {
    case 'varchar': return 'varchar';
    case 'image': return 'varchar';
    case 'file': return 'varchar';
    case 'dict': return 'varchar';
    case 'code': return 'varchar';
    case 'text': return 'text';
    case 'point': return 'text';
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

export function getValidatorDecorators(field: AutoCodeField, forCreate: boolean): string {
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
    case 'code':
    case 'point':
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

export function getSwaggerProp(field: AutoCodeField, forCreate: boolean): string {
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
// Mock data generation (per-field-type)
// ---------------------------------------------------------------------------

/**
 * Context handed to generateMockValue for resolving cross-field dependencies.
 * - dictCache: dictType -> array of status=1 dict value strings (pre-warmed)
 * - parentIds: relationTable -> array of existing parent row ids (uuid strings)
 * - mintCode: produces a format-matching code for type='code' fields.
 *   Tracks batch-local uniqueness via an internal Set and MUST NOT touch
 *   sys_encoding_rule_sequences.
 */
export interface MockCtx {
  dictCache: Record<string, string[]>;
  parentIds: Record<string, string[]>;
  mintCode: (field: AutoCodeField) => string;
  /** Per-field-name used-value sets for honoring field.unique. */
  usedValues: Record<string, Set<string>>;
}

const SYSTEM_COLUMNS = new Set([
  'id',
  'created_at',
  'updated_at',
  'deleted_at',
  'created_by',
  'updated_by',
  'owner_id',
  'shared_with',
]);

/** True for business (non-system) column names. */
export function isBusinessColumn(name: string): boolean {
  return !!name && !SYSTEM_COLUMNS.has(name);
}

/**
 * Generate a single mock value for a field according to its type.
 * Returns a JS primitive matching toTsType (decimal is a string for Drizzle
 * numeric compatibility). The default branch warns and returns a safe default
 * rather than silently returning ''.
 */
export function generateMockValue(
  field: AutoCodeField,
  ctx: MockCtx,
): string | number | boolean | null {
  let value: string | number | boolean | null;

  switch (field.type) {
    case 'varchar': {
      const max = field.length || 255;
      let v = faker.lorem.word();
      if (v.length > max) v = v.slice(0, max);
      value = v;
      break;
    }
    case 'text':
      value = faker.lorem.sentence();
      break;
    case 'integer':
      value = faker.number.int({ min: 0, max: 1000 });
      break;
    case 'bigint':
      value = faker.number.int();
      break;
    case 'decimal':
      // MUST be a string /^\d+\.\d{2}$/ for Drizzle numeric compatibility.
      value = (Math.random() * 1000).toFixed(2);
      break;
    case 'boolean':
      value = Math.random() < 0.5;
      break;
    case 'timestamp':
      value = faker.date.recent({ days: 90 }).toISOString();
      break;
    case 'uuid':
      value = crypto.randomUUID();
      break;
    case 'image':
    case 'file': {
      // Inline SVG data URI — zero external network dependency. The previous
      // picsum.photos source is fronted by the Fastly CDN, which is flaky
      // from CN browser networks and rendered as a broken <img>. A distinct
      // pastel per row keeps mock rows visually distinguishable in lists.
      const bg = faker.helpers.arrayElement([
        'a3d5ff', 'ffd4a3', 'c4f2c4', 'fff3a3', 'e8b3f2', 'a3f2eb', 'ffb3c1', 'c9c4f2',
      ]);
      const label = field.type === 'image' ? 'IMG' : 'FILE';
      const svg =
        `<svg xmlns='http://www.w3.org/2000/svg' width='120' height='120'>` +
        `<rect width='120' height='120' fill='#${bg}'/>` +
        `<text x='60' y='68' font-size='22' fill='#555' text-anchor='middle'>${label}</text>` +
        `</svg>`;
      const uri = `data:image/svg+xml,${encodeURIComponent(svg)}`;
      value = uri.length > 512 ? uri.slice(0, 512) : uri;
      break;
    }
    case 'dict': {
      const opts = (field.dictType && ctx.dictCache[field.dictType]) || [];
      value = opts.length > 0 ? faker.helpers.arrayElement(opts) : '';
      break;
    }
    case 'relation': {
      // Only many-to-one FK columns exist on this table.
      const table = field.relationTable || '';
      const ids = (table && ctx.parentIds[table]) || [];
      if (ids.length > 0) {
        value = faker.helpers.arrayElement(ids);
      } else if (field.required) {
        // Caller must guard required+empty before invoking; defensive null.
        throw new Error(
          `relation field '${field.name}' is required but parent table '${table}' is empty`,
        );
      } else {
        value = null;
      }
      break;
    }
    case 'code':
      value = ctx.mintCode(field);
      break;
    case 'point':
      // GeoJSON Point stored as text — use Beijing center as a stable demo value
      // with a small random offset so rows are distinct on a map.
      value = JSON.stringify({
        type: 'Point',
        coordinates: [
          parseFloat((116.3974 + (Math.random() - 0.5) * 0.1).toFixed(6)),
          parseFloat((39.9093 + (Math.random() - 0.5) * 0.1).toFixed(6)),
        ],
      });
      break;
    default: {
      // Unknown type: warn via console (this module has no logger) and fall
      // back to a safe default derived from toDefaultValue semantics.
      console.warn(
        `[autocode-mock] unknown field type '${(field as any).type}' for '${field.name}'; using toDefaultValue fallback`,
      );
      value = toDefaultValue(field) === '' ? '' : '';
      break;
    }
  }

  // Honor field.unique: ensure distinct value across the batch for this field.
  if (field.unique && typeof value === 'string') {
    const set = (ctx.usedValues[field.name] ||= new Set<string>());
    let base = value;
    let attempt = 0;
    while (set.has(value as string)) {
      attempt += 1;
      value = `${base}_${attempt}`;
      if (attempt > 9999) break; // safety valve
    }
    set.add(value as string);
  }

  return value;
}

// ---------------------------------------------------------------------------
// Form field configuration for frontend page
// ---------------------------------------------------------------------------

export function getProFormComponent(field: AutoCodeField): string {
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
    case 'timestamp':
      return 'ProFormDateTimePicker';
    case 'relation':
    case 'dict':
      return 'ProFormSelect';
    case 'code':
      return 'ProFormText';
    case 'point':
      return 'GeoField';
    default:
      return 'ProFormText';
  }
}

export function getValueType(field: AutoCodeField): string {
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
    case 'code':
      return 'text';
    case 'point':
      return 'geo';
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
