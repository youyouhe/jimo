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

/**
 * Strip the lc_ business-table prefix if present. 'lc_contracts' → 'contracts'.
 * Idempotent: 'contracts' → 'contracts'.
 */
export function stripLcPrefix(name: string): string {
  return name.startsWith('lc_') ? name.slice(3) : name;
}

/**
 * Singular master stem used to derive sub-table names, FK columns, and LIKE
 * prefixes. Strips lc_ FIRST, then singularizes — so 'lc_contracts' → 'contract'
 * (NOT 'lc_contract'). Mirrors the canonical derivation in menu.service.ts.
 */
export function deriveMasterSingular(tableName: string): string {
  return singularize(stripLcPrefix(tableName));
}

/**
 * Canonical sub-table (one-to-many child) physical name.
 * 'lc_contracts' + 'items' → 'lc_contract_item'.
 */
export function deriveSubTableName(masterTableName: string, childFieldName: string): string {
  return `lc_${deriveMasterSingular(masterTableName)}_${singularize(childFieldName)}`;
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
    case 'calculated':
      return field.resultType === 'number' ? 'number' : 'string';
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
    case 'calculated':
      return ''; // virtual — no physical column
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
 * A unique column must carry a value: the generated partial unique index
 * `idx_<table>_<col>_active WHERE deleted_at IS NULL` collides on the column's
 * empty default (`.default('')`) whenever two non-deleted rows share it. Force
 * required=true for any field that will get a unique index, so the column is
 * NOT NULL with no empty default, and the create DTO validates it as @IsNotEmpty.
 *
 * Filter condition mirrors unique-index generation (generateSchema in
 * autocode-backend-generators.ts): one-to-many relations are excluded (they
 * don't produce a unique index), so they are left untouched here.
 */
export function enforceUniqueRequired(fields: AutoCodeField[]): AutoCodeField[] {
  return fields.map((f) =>
    f.unique && !(f.type === 'relation' && f.relationType === 'one-to-many') && !f.required
      ? { ...f, required: true }
      : f,
  );
}

/**
 * Filter out removed fields for business code generation.
 * Removed fields are kept in schema (DB column preserved) but excluded from
 * DTOs, services, controllers, and frontend code. Also enforces unique→required
 * (see enforceUniqueRequired) so generated business code treats unique columns
 * as mandatory.
 */
export function activeFields(fields: AutoCodeField[]): AutoCodeField[] {
  return enforceUniqueRequired(fields).filter((f) => !f.removed);
}

/**
 * Build a deterministic JSON-literal sample value for a field, as a snippet of
 * source code (e.g. `'SAMPLE_NAME'` / `1` / `true`) for embedding in a generated
 * spec's create/update body. Stable (no faker/ctx) so the generated assertions
 * can hard-code the same value. Callers should exclude relation/calculated/code
 * fields first. Spec generators override this with a per-case token for unique
 * fields (see generateServiceContractSpec/generateHttpContractSpec).
 */
export function buildSpecSampleValue(field: AutoCodeField): string {
  switch (field.type) {
    case 'varchar':
    case 'text':
    case 'image':
    case 'file':
      return `'SAMPLE_${field.name.toUpperCase()}'`;
    case 'integer':
    case 'bigint':
      return '1';
    case 'decimal':
      return `'10.00'`;
    case 'boolean':
      return 'true';
    case 'timestamp':
      return `'2025-01-01T00:00:00.000Z'`;
    case 'uuid':
      return `'00000000-0000-0000-0000-0000000000aa'`;
    case 'dict':
      return `'sample'`;
    case 'point':
      return `'{"type":"Point","coordinates":[116.39,39.91]}'`;
    default:
      return `''`;
  }
}

// ---------------------------------------------------------------------------
// Direct SQL DDL helpers (replaces drizzle-kit push to avoid TTY requirement)
// ---------------------------------------------------------------------------

export function toSqlColumnDef(field: AutoCodeField): string {
  if (field.type === 'calculated') return ''; // virtual — no physical column
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
    if (f.removed || f.type === 'relation' || f.type === 'calculated') continue;
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
  tableName: string;       // full table name, always lc_-prefixed (e.g. lc_students)
  baseName: string;        // table name without lc_ prefix (e.g. students)
  packageSlug: string;     // package directory slug (e.g. hr)
  pascalName: string;      // PascalCase of baseName (e.g. Students)
  pascalSingular: string;  // PascalCase singular of baseName (e.g. Student)
  camelName: string;
  camelSingular: string;
  kebabName: string;       // kebab-case of baseName (e.g. students)
  kebabSingular: string;   // kebab-case singular of baseName (e.g. student)
  lcKebabSingular: string; // lc-prefixed kebab singular (e.g. lc-student) — used for file names
  moduleDir: string;       // backend module path segment: lc/<slug>/lc-<singular> (e.g. lc/hr/lc-student)
  /** Relative path from the generated module dir back to src/ (e.g. '../../../../' for lc/<slug>/lc-name/) */
  srcRelPath: string;
  /** Relative path from the dto/ subdir back to src/ (one level deeper than srcRelPath) */
  dtoSrcRelPath: string;
  routePath: string;
  schemaVar: string;
  schemaType: string;
  /** 前端隔离路径 —— 业务表前端产物落在 lc/ 子目录 */
  pageDir: string;           // lc/<kebabName> — pages/${pageDir}/index.tsx
  pageComponentPath: string; // ./lc/<kebabName>/index
  pageMapComponentPath: string;
  serviceRelDir: string;     // lc/<kebabSingular> — services/${serviceRelDir}.ts
  serviceImportAlias: string;
}

export function deriveNames(tableName: string, packageSlug: string = ''): DerivedNames {
  // Strip lc_ prefix for name generation so class/var names stay clean (e.g. StudentModule not LcStudentModule)
  const baseName = tableName.startsWith('lc_') ? tableName.slice(3) : tableName;
  // Ensure DB table name always has lc_ prefix
  const fullTableName = tableName.startsWith('lc_') ? tableName : `lc_${tableName}`;

  const pascalName = toPascalCase(baseName);
  const pascalSingular = toPascalCase(singularize(baseName));
  const camelName = toCamelCase(baseName);
  const camelSingular = toCamelCase(singularize(baseName));
  const kebabName = toKebabCase(baseName);
  const kebabSingular = toKebabCase(singularize(baseName));
  const lcKebabSingular = `lc-${kebabSingular}`;
  const slug = packageSlug || 'default';
  const moduleDir = `lc/${slug}/${lcKebabSingular}`;
  // moduleDir has 3 path segments (lc/<slug>/lc-<name>), so:
  // - from module root: 4 levels up reach src/
  // - from dto/ subdir: 5 levels up reach src/
  const srcRelPath = '../../../../';
  const dtoSrcRelPath = '../../../../../';
  const routePath = `/lc/${kebabName}`;

  return {
    tableName: fullTableName,
    baseName,
    packageSlug: slug,
    pascalName,
    pascalSingular,
    camelName,
    camelSingular,
    kebabName,
    kebabSingular,
    lcKebabSingular,
    moduleDir,
    srcRelPath,
    dtoSrcRelPath,
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
    case 'calculated': return ''; // virtual — no column, no import
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
    case 'calculated':
      // Virtual field — never stored; computed on read by the generated service.
      // Mock inserts exclude calculated columns, so this branch is defensive.
      value = null;
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
    case 'calculated':
      // Read-only computed value; excluded from create/edit forms (like 'code').
      return 'ProFormText';
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
    case 'calculated':
      return field.resultType === 'number' ? 'digit' : 'text';
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
