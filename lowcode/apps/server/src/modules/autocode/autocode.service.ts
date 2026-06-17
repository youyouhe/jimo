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
} from '../../db/schema/auto-code-histories';
import {
  sysAutoCodePackages,
  type SysAutoCodePackage,
} from '../../db/schema/auto-code-packages';
import { sysMenus } from '../../db/schema/menus';
import { sysRoleMenus } from '../../db/schema/role-menus';
import { sysRoles } from '../../db/schema/roles';
import { sysAuthorityBtns } from '../../db/schema/authority-btns';
import { sysApis } from '../../db/schema/apis';
import { CASBIN_SERVICE_TOKEN, ICasbinService } from '../role/role.service';
import { DictionaryDetailService } from '../dictionary-detail/dictionary-detail.service';
import { EncodingRuleService } from '../encoding-rule/encoding-rule.service';
import { fakerZH_CN as faker } from '@faker-js/faker';
import { AutoCodeDto, AutoCodeField } from './dto/autocode.dto';
import { UpdateModuleDto } from './dto/update-module.dto';
import { CreatePackageDto, UpdatePackageDto, SaveFromConfigDto } from './dto/package.dto';
import { buildErGraph, type ErGraph, type ErHistoryInput } from './er-graph.util';

// Re-export job types for backward compatibility with autocode.controller.ts
export type { GenerateJobStatus, GenerateStep, GenerateStepStatus } from './autocode-field-utils';

// Pure helpers
import {
  toKebabCase,
  singularize,
  activeFields,
  buildCreateTableSql,
  deriveNames,
  generateMockValue,
  isBusinessColumn,
  type DerivedNames,
  type GenerateJobStatus,
  type GenerateStep,
  type GenerateStepStatus,
  type MockCtx,
} from './autocode-field-utils';

// Backend code generators
import {
  generateSchema,
  generateCreateDto,
  generateQueryDto,
  generateUpdateDto,
  generateService,
  generateController,
  generateModule,
} from './autocode-backend-generators';

// Frontend code generators
import {
  generateFrontendService,
  generateFrontendPage,
} from './autocode-frontend-generators';

// ---------------------------------------------------------------------------
// Service
// ---------------------------------------------------------------------------

@Injectable()
export class AutocodeService {
  private readonly logger = new Logger(AutocodeService.name);

  constructor(
    @Inject(DATABASE_CONNECTION) private readonly db: DrizzleDb,
    @Inject(CASBIN_SERVICE_TOKEN) private readonly casbin: ICasbinService,
    private readonly dictionaryDetailService: DictionaryDetailService,
    private readonly encodingRuleService: EncodingRuleService,
  ) {}

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
    files[`release/lowcode/apps/server/src/db/schema/${n.kebabName}.ts`] = generateSchema(dto);

    // For all business code: exclude removed fields
    const activeDto: AutoCodeDto = { ...dto, fields: activeFields(dto.fields) };

    // DTOs
    files[`release/lowcode/apps/server/src/modules/${n.kebabSingular}/dto/create-${n.kebabSingular}.dto.ts`] = generateCreateDto(activeDto);
    files[`release/lowcode/apps/server/src/modules/${n.kebabSingular}/dto/query-${n.kebabSingular}.dto.ts`] = generateQueryDto(activeDto);
    files[`release/lowcode/apps/server/src/modules/${n.kebabSingular}/dto/update-${n.kebabSingular}.dto.ts`] = generateUpdateDto(activeDto);

    // Service
    files[`release/lowcode/apps/server/src/modules/${n.kebabSingular}/${n.kebabSingular}.service.ts`] = generateService(activeDto);

    // Controller
    files[`release/lowcode/apps/server/src/modules/${n.kebabSingular}/${n.kebabSingular}.controller.ts`] = generateController(activeDto);

    // Module
    files[`release/lowcode/apps/server/src/modules/${n.kebabSingular}/${n.kebabSingular}.module.ts`] = generateModule(activeDto);

    // Frontend files (only if generateWeb is true)
    if (dto.generateWeb) {
      files[`release/lowcode/apps/web/src/services/${n.kebabSingular}.ts`] = generateFrontendService(activeDto);
      files[`release/lowcode/apps/web/src/pages/${n.kebabName}/index.tsx`] = generateFrontendPage(activeDto);
    }

    return files;
  }

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

  /**
   * Insert `dto.mockData.count` mock business rows into lc_<tableName> via raw
   * multi-VALUES INSERT (chunked, ON CONFLICT DO NOTHING). Throws to abort
   * THIS table's mock when a required relation field has an empty parent
   * table; callers must catch (the generate pipeline treats it as non-fatal).
   */
  private async insertMockData(dto: AutoCodeDto): Promise<void> {
    const count = dto.mockData?.count ?? 0;
    if (count <= 0 || !dto.mockData?.enabled) return;

    const tableName = `lc_${dto.tableName}`;
    const fields = activeFields(dto.fields).filter(
      (f) => isBusinessColumn(f.name) && (f.type !== 'relation' || f.relationType === 'many-to-one'),
    );

    if (fields.length === 0) {
      this.logger.log(` mock: no business columns for '${tableName}', skipping`);
      return;
    }

    // 1) Pre-warm context.
    const dictCache: Record<string, string[]> = {};
    const parentIds: Record<string, string[]> = {};

    // dict cache: per distinct dictType (status=1 filtered).
    const dictTypes = new Set(
      fields.filter((f) => f.type === 'dict' && f.dictType).map((f) => f.dictType!),
    );
    for (const dt of dictTypes) {
      try {
        const details = await this.dictionaryDetailService.findByDictType(dt);
        dictCache[dt] = details
          .filter((d: any) => (d.status ?? 1) === 1 && d.value != null)
          .map((d: any) => String(d.value));
      } catch (err: unknown) {
        this.logger.warn(` mock: failed to load dict '${dt}': ${(err as Error).message}`);
        dictCache[dt] = [];
      }
    }

    // parent ids: per distinct many-to-one relationTable (deleted_at IS NULL).
    const relTables = new Set(
      fields
        .filter((f) => f.type === 'relation' && f.relationType === 'many-to-one' && f.relationTable)
        .map((f) => f.relationTable!),
    );
    for (const rt of relTables) {
      try {
        const res = await this.db.execute(
          sql.raw(`SELECT id FROM "lc_${rt}" WHERE deleted_at IS NULL`),
        );
        parentIds[rt] = (res as unknown as any[])
          .map((r) => r.id)
          .filter((id): id is string => typeof id === 'string');
      } catch (err: unknown) {
        this.logger.warn(` mock: failed to load parent ids for 'lc_${rt}': ${(err as Error).message}`);
        parentIds[rt] = [];
      }
    }

    // Required relation field with empty parent -> abort THIS table's mock.
    for (const f of fields) {
      if (
        f.type === 'relation' &&
        f.relationType === 'many-to-one' &&
        f.required &&
        f.relationTable &&
        (parentIds[f.relationTable] || []).length === 0
      ) {
        throw new Error(
          `required relation field '${f.name}' has empty parent table 'lc_${f.relationTable}'`,
        );
      }
    }

    // mintCode: builds prefix+date+zero-padded random seq, batch-local unique
    // via a Set. Does NOT touch sys_encoding_rule_sequences.
    const codeRules: Record<
      string,
      {
        prefix: string | null;
        dateFormat: string | null;
        separator: string;
        sequenceDigits: number;
        paddingChar: string;
      }
    > = {};
    const codeUsed: Set<string> = new Set();
    const mintCode = (field: AutoCodeField): string => {
      // Try to honor the configured rule's format if ruleId resolves.
      let prefix = '';
      let dateFormat: string | null = null;
      let separator = '';
      let sequenceDigits = 4;
      let paddingChar = '0';

      // Synchronous best-effort: ruleId lookup must be done up-front by caller
      // for true fidelity; here we keep it self-contained with a reasonable
      // default shape (prefix 'CODE' if no ruleId) so the value always matches
      // the documented /^<prefix>\d{8}\d+$/ format expectation.
      if (field.ruleId) {
        // EncodingRuleService.findOne is async; we cannot await inside this
        // sync closure. Caller pre-warms resolved rule params below via the
        // `codeRules` map when ruleId is present.
        const cached = codeRules[field.ruleId];
        if (cached) {
          prefix = cached.prefix ?? '';
          dateFormat = cached.dateFormat ?? null;
          separator = cached.separator ?? '';
          sequenceDigits = cached.sequenceDigits ?? 4;
          paddingChar = cached.paddingChar ?? '0';
        }
      }

      const now = new Date();
      const yyyy = now.getFullYear();
      const MM = String(now.getMonth() + 1).padStart(2, '0');
      const dd = String(now.getDate()).padStart(2, '0');
      let datePart = '';
      if (dateFormat === 'yyyyMMdd') datePart = `${yyyy}${MM}${dd}`;
      else if (dateFormat === 'yyyy') datePart = String(yyyy);
      else if (dateFormat === 'yyMM') datePart = `${String(yyyy).slice(-2)}${MM}`;
      else if (dateFormat === 'none' || !dateFormat) datePart = '';
      else datePart = `${yyyy}${MM}${dd}`;

      // Random sequence, retry on collision against batch-local Set.
      let code = '';
      let attempt = 0;
      do {
        const seq = faker.number.int({ min: 0, max: Math.pow(10, sequenceDigits) - 1 });
        const seqPart = String(seq).padStart(sequenceDigits, paddingChar);
        const parts: string[] = [];
        if (prefix) parts.push(prefix);
        if (datePart) parts.push(datePart);
        parts.push(seqPart);
        code = parts.join(separator);
        attempt += 1;
        if (attempt > 9999) break;
      } while (codeUsed.has(code));
      codeUsed.add(code);
      return code;
    };

    // Pre-warm code rule params for all code fields (async, before mintCode).
    const codeRuleIds = new Set(
      fields.filter((f) => f.type === 'code' && f.ruleId).map((f) => f.ruleId!),
    );
    for (const rid of codeRuleIds) {
      try {
        const rule: any = await this.encodingRuleService.findOne(rid);
        codeRules[rid] = {
          prefix: rule.prefix ?? '',
          dateFormat: rule.dateFormat ?? null,
          separator: rule.separator ?? '',
          sequenceDigits: rule.sequenceDigits ?? 4,
          paddingChar: rule.paddingChar ?? '0',
        };
      } catch (err: unknown) {
        this.logger.warn(` mock: failed to load encoding rule '${rid}': ${(err as Error).message}`);
      }
    }

    const ctx: MockCtx = { dictCache, parentIds, mintCode, usedValues: {} };

    // 2) Build rows.
    const buildRow = (): Record<string, string | number | boolean | null> => {
      const row: Record<string, string | number | boolean | null> = {};
      for (const f of fields) {
        row[f.name] = generateMockValue(f, ctx);
      }
      return row;
    };

    const rows: Record<string, string | number | boolean | null>[] = [];
    for (let i = 0; i < count; i += 1) rows.push(buildRow());

    // 3) Build escaped multi-VALUES INSERT, chunked at 100.
    const cols = fields.map((f) => `"${f.name}"`).join(', ');
    const CHUNK_SIZE = 100;
    let inserted = 0;

    const escapeValue = (v: string | number | boolean | null): string => {
      if (v === null || v === undefined) return 'NULL';
      if (typeof v === 'number') return String(v);
      if (typeof v === 'boolean') return v ? 'TRUE' : 'FALSE';
      return `'${String(v).replace(/'/g, "''").replace(/\0/g, '')}'`;
    };

    for (let i = 0; i < rows.length; i += CHUNK_SIZE) {
      const chunk = rows.slice(i, i + CHUNK_SIZE);
      const valuesSql = chunk
        .map((row) => `(${fields.map((f) => escapeValue(row[f.name] ?? null)).join(', ')})`)
        .join(', ');
      const insertSql = `INSERT INTO "${tableName}" (${cols}) VALUES ${valuesSql} ON CONFLICT DO NOTHING`;
      try {
        await this.db.execute(sql.raw(insertSql));
        inserted += chunk.length;
      } catch (err: unknown) {
        this.logger.warn(` mock: chunk insert failed for '${tableName}': ${(err as Error).message}`);
      }
    }

    // 4) Post-validate and log.
    try {
      const res = await this.db.execute(
        sql.raw(`SELECT COUNT(*)::int AS c FROM "${tableName}" WHERE deleted_at IS NULL`),
      );
      const total = (res as unknown as any[])?.[0]?.c ?? '?';
      this.logger.log(` mock: inserted ${inserted} rows (table '${tableName}' now has ${total} live rows)`);
    } catch {
      this.logger.log(` mock: inserted ${inserted} rows into '${tableName}'`);
    }

    // 5) One-to-many child (detail) tables — insert `count` detail rows per main row,
    //    linked back via FK. Mirrors the main-table escaping/chunking.
    const oneToManyFields = activeFields(dto.fields).filter(
      (f) => f.type === 'relation' && f.relationType === 'one-to-many' && (f.detailFields || []).length > 0,
    );
    if (oneToManyFields.length > 0) {
      // Fetch the main ids we just inserted (latest `count` rows) for FK linkage.
      let mainIds: string[] = [];
      try {
        const idRes = await this.db.execute(
          sql.raw(`SELECT id FROM "${tableName}" WHERE deleted_at IS NULL ORDER BY created_at DESC LIMIT ${count}`),
        );
        mainIds = (idRes as unknown as any[]).map((r) => r.id);
      } catch (err: unknown) {
        this.logger.warn(` mock: failed to fetch main ids for child mock: ${(err as Error).message}`);
      }

      for (const f of oneToManyFields) {
        const isExisting = !!(f.relationExistingTable && f.relationTable && f.relationFkColumn);
        const singularMain = singularize(dto.tableName);
        const singularField = singularize(f.name);
        const childTable = isExisting ? `lc_${f.relationTable}` : `lc_${singularMain}_${singularField}`;
        // FK column must match the generator's naming: toCamelCase(singularMain)_id
        // (e.g. material_orders -> materialOrder_id, not snake_case material_order_id)
        const camelMain = singularMain.replace(/_([a-z])/g, (_, c) => c.toUpperCase());
        const fkColumn = isExisting ? (f.relationFkColumn || `${camelMain}_id`) : `${camelMain}_id`;
        // Child business columns: detailFields minus system cols and the self-referential FK.
        const childFields = (f.detailFields || []).filter(
          (df) => isBusinessColumn(df.name) && !(df.type === 'relation' && df.relationTable === dto.tableName),
        );
        if (childFields.length === 0 || mainIds.length === 0) continue;

        const childRows: Record<string, string | number | boolean | null>[] = [];
        for (const mainId of mainIds) {
          for (let j = 0; j < count; j += 1) {
            const row: Record<string, string | number | boolean | null> = { [fkColumn]: mainId };
            for (const cf of childFields) {
              row[cf.name] = generateMockValue(cf, ctx);
            }
            childRows.push(row);
          }
        }

        const childColNames = [fkColumn, ...childFields.map((cf) => cf.name)];
        const childCols = childColNames.map((c) => `"${c}"`).join(', ');
        let childInserted = 0;
        for (let i = 0; i < childRows.length; i += CHUNK_SIZE) {
          const chunk = childRows.slice(i, i + CHUNK_SIZE);
          const valuesSql = chunk
            .map((row) => `(${childColNames.map((c) => escapeValue(row[c] ?? null)).join(', ')})`)
            .join(', ');
          const insertSql = `INSERT INTO "${childTable}" (${childCols}) VALUES ${valuesSql} ON CONFLICT DO NOTHING`;
          try {
            await this.db.execute(sql.raw(insertSql));
            childInserted += chunk.length;
          } catch (err: unknown) {
            this.logger.warn(` mock: child chunk insert failed for '${childTable}': ${(err as Error).message}`);
          }
        }
        this.logger.log(` mock: inserted ${childInserted} detail rows into '${childTable}' (${count} per main row)`);

        // Grandchild (third-level) mock rows — one-to-many within child
        if (!isExisting) {
          // Collect inserted child IDs for FK linkage
          let childIds: string[] = [];
          try {
            const childIdRes = await this.db.execute(
              sql.raw(`SELECT id FROM "${childTable}" WHERE deleted_at IS NULL ORDER BY created_at DESC LIMIT ${mainIds.length * count}`),
            );
            childIds = (childIdRes as unknown as any[]).map((r) => r.id);
          } catch { /* ignore */ }

          for (const gf of (f.detailFields || [])) {
            if (gf.type !== 'relation' || gf.relationType !== 'one-to-many') continue;
            if (!gf.detailFields || gf.detailFields.length === 0) continue;

            const singularGrand = singularize(gf.name);
            const grandTable = `lc_${singularMain}_${singularField}_${singularGrand}`;
            const grandFkRaw = `${singularMain}_${singularField}`;
            const grandFkColumn = grandFkRaw.replace(/_([a-z])/g, (_, c: string) => c.toUpperCase()) + '_id';
            const grandFields = gf.detailFields.filter(
              (gdf) => isBusinessColumn(gdf.name) && !(gdf.type === 'relation' && gdf.relationType === 'one-to-many'),
            );
            if (grandFields.length === 0 || childIds.length === 0) continue;

            const grandRows: Record<string, string | number | boolean | null>[] = [];
            for (const childId of childIds) {
              for (let j = 0; j < count; j += 1) {
                const row: Record<string, string | number | boolean | null> = { [grandFkColumn]: childId };
                for (const gdf of grandFields) {
                  row[gdf.name] = generateMockValue(gdf, ctx);
                }
                grandRows.push(row);
              }
            }

            const grandColNames = [grandFkColumn, ...grandFields.map((gdf) => gdf.name)];
            const grandCols = grandColNames.map((c) => `"${c}"`).join(', ');
            let grandInserted = 0;
            for (let i = 0; i < grandRows.length; i += CHUNK_SIZE) {
              const chunk = grandRows.slice(i, i + CHUNK_SIZE);
              const valuesSql = chunk
                .map((row) => `(${grandColNames.map((c) => escapeValue(row[c] ?? null)).join(', ')})`)
                .join(', ');
              const insertSql = `INSERT INTO "${grandTable}" (${grandCols}) VALUES ${valuesSql} ON CONFLICT DO NOTHING`;
              try {
                await this.db.execute(sql.raw(insertSql));
                grandInserted += chunk.length;
              } catch (err: unknown) {
                this.logger.warn(` mock: grandchild chunk insert failed for '${grandTable}': ${(err as Error).message}`);
              }
            }
            this.logger.log(` mock: inserted ${grandInserted} grandchild rows into '${grandTable}' (${count} per child row)`);
          }
        }
      }
    }
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
        files[`release/lowcode/apps/web/src/services/${n.kebabSingular}.ts`] = generateFrontendService(activeDto, relationDictTypes);
        files[`release/lowcode/apps/web/src/pages/${n.kebabName}/index.tsx`] = generateFrontendPage(activeDto, relationDictTypes);
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
      const serverDir = path.join(projectRoot, 'release', 'lowcode', 'apps', 'server');
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
    { key: 'mock-data', label: '正在生成 mock 数据...' },
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
        `release/lowcode/apps/server/src/db/schema/${n.kebabName}.ts`,
        `release/lowcode/apps/server/src/modules/${n.kebabSingular}/${n.kebabSingular}.service.ts`,
        `release/lowcode/apps/server/src/modules/${n.kebabSingular}/${n.kebabSingular}.controller.ts`,
        `release/lowcode/apps/server/src/modules/${n.kebabSingular}/${n.kebabSingular}.module.ts`,
        `release/lowcode/apps/server/src/modules/${n.kebabSingular}/dto/create-${n.kebabSingular}.dto.ts`,
        `release/lowcode/apps/server/src/modules/${n.kebabSingular}/dto/query-${n.kebabSingular}.dto.ts`,
        `release/lowcode/apps/server/src/modules/${n.kebabSingular}/dto/update-${n.kebabSingular}.dto.ts`,
        `release/lowcode/apps/web/src/services/${n.kebabSingular}.ts`,
        `release/lowcode/apps/web/src/pages/${n.kebabName}/index.tsx`,
      ];
      for (const p of expectedPaths) {
        const fullPath = path.join(projectRoot, p);
        if (existsSync(fullPath)) {
          await fs.rm(fullPath, { force: true });
          deletedFiles.push(p);
        }
      }
      // Remove module directory if empty
      const moduleDir = path.join(projectRoot, `release/lowcode/apps/server/src/modules/${n.kebabSingular}`);
      if (existsSync(moduleDir)) {
        try { await fs.rmdir(moduleDir); } catch { /* not empty */ }
        try { await fs.rmdir(path.join(moduleDir, 'dto')); } catch { /* not empty */ }
      }
      const pageDir = path.join(projectRoot, `release/lowcode/apps/web/src/pages/${n.kebabName}`);
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
      await updateStep(4, 'running');
      const componentPath = `./${n.kebabName}/index`;
      const menuRows = await this.db
        .select({ id: sysMenus.id, name: sysMenus.name, path: sysMenus.path })
        .from(sysMenus)
        .where(and(eq(sysMenus.component, componentPath), isNull(sysMenus.deletedAt)));
      if (menuRows.length > 0) {
        const pageMenuIds = menuRows.map((m) => m.id);
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
          if (cascade) {
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
                const result = await this.cleanupTableSoft(refTableName, projectRoot);
                deletedFiles.push(...result.deletedFiles);
                removedMenus += result.removedMenus;
              } catch { /* continue with drop even if file cleanup fails */ }
              try {
                await this.db.execute(sql.raw(`DROP TABLE IF EXISTS "${refDbTable}" CASCADE`));
              } catch { /* ignore drop failures */ }
              try {
                await this.db
                  .delete(sysAutoCodeHistories)
                  .where(eq(sysAutoCodeHistories.tableName, refTableName));
              } catch { /* ignore */ }
            }
          }
          // Drop child detail tables for one-to-many relations
          for (const field of oneToManyFields) {
            const isExisting = !!(field.relationExistingTable && field.relationTable && field.relationFkColumn);
            if (isExisting) continue;
            const singularMain = singularize(tableName);
            const singularField = singularize(field.name);
            const childDbName = `lc_${singularMain}_${singularField}`;
            // Drop grandchild tables first (one-to-many within child)
            for (const gf of (field.detailFields || [])) {
              if (gf.type !== 'relation' || gf.relationType !== 'one-to-many') continue;
              const singularGrand = singularize(gf.name);
              const grandDbName = `lc_${singularMain}_${singularField}_${singularGrand}`;
              try {
                await this.db.execute(sql.raw(`DROP TABLE IF EXISTS "${grandDbName}" CASCADE`));
              } catch { /* Grandchild table may not exist, ignore */ }
            }
            try {
              await this.db.execute(sql.raw(`DROP TABLE IF EXISTS "${childDbName}" CASCADE`));
            } catch { /* Child table may not exist, ignore */ }
          }
          await this.db.execute(sql.raw(`DROP TABLE IF EXISTS "${dbTableName}" CASCADE`));
          droppedTable = true;
        }
      } catch { /* Table may not exist or drop failed */ }
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
   */
  async startGenerate(dto: AutoCodeDto): Promise<string> {
    const jobId = randomUUID();
    const steps = AutocodeService.GENERATE_STEPS.map((s) => ({
      key: s.key,
      label: s.label,
      status: 'pending' as const,
    }));

    await this.writeJobStatus(jobId, {
      jobId,
      status: 'processing',
      steps,
      progress: 0,
      currentStepLabel: '准备中...',
    });

    this.executeGenerateAsync(jobId, dto).catch((err) => {
      this.logger.error(` Unhandled error in generate job ${jobId}:`, err);
    });

    return jobId;
  }

  /**
   * Read current job status from disk.
   */
  async getJobStatus(jobId: string): Promise<GenerateJobStatus | null> {
    return this.readJobStatus(jobId);
  }

  // =========================================================================
  // Async update with progress tracking
  // =========================================================================

  /**
   * Start async module update with progress tracking.
   */
  async startUpdate(dto: UpdateModuleDto): Promise<string> {
    const latest = await this.getLatestVersion(dto.tableName);
    if (!latest) {
      throw new NotFoundException(`No existing version found for table '${dto.tableName}'. Use generate to create it first.`);
    }

    const oldFields = (latest.fields as AutoCodeField[]) ?? [];
    const hasChanges = this.hasStructuralChange(oldFields, dto.fields);

    if (!hasChanges && !dto.force) {
      throw new ConflictException(
        '没有检测到表结构变更（仅修改了字段描述或表描述，不影响数据库和代码）。如需修改描述，可直接编辑代码文件。',
      );
    }

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
      const latest = await this.getLatestVersion(dto.tableName);
      if (!latest) {
        throw new Error(`Version record for '${dto.tableName}' not found`);
      }

      const oldFields = (latest.fields as AutoCodeField[]) ?? [];
      const oldVersion = latest.version ?? 1;
      const changeLog = this.computeChangeLog(oldFields, dto.fields);

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

      if (autoCodeDto.generateWeb) {
        const n2 = deriveNames(autoCodeDto.tableName);
        const activeDto2: AutoCodeDto = { ...autoCodeDto, fields: activeFields(autoCodeDto.fields) };
        const relationDictTypes2 = await this.lookupRelationDisplayDictTypes(activeDto2.fields);
        if ([...relationDictTypes2.values()].some((v) => v !== null)) {
          files[`release/lowcode/apps/web/src/services/${n2.kebabSingular}.ts`] = generateFrontendService(activeDto2, relationDictTypes2);
          files[`release/lowcode/apps/web/src/pages/${n2.kebabName}/index.tsx`] = generateFrontendPage(activeDto2, relationDictTypes2);
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
      await this.updateSchemaIndex(autoCodeDto, projectRoot);
      await this.updateAppModule(autoCodeDto, projectRoot);
      if (autoCodeDto.generateWeb) {
        await this.updateUmiRoutes(autoCodeDto, projectRoot);
      }
      await updateStep(1, 'completed');

      // Step 3: drizzle-kit push
      await updateStep(2, 'running', '正在同步数据库...');
      try {
        const { exec } = await import('node:child_process');
        const { promisify } = await import('node:util');
        const execAsync = promisify(exec);
        const serverDir = path.join(projectRoot, 'release', 'lowcode', 'apps', 'server');
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

      // Step 5: Update entry points
      await updateStep(4, 'running');
      await this.updateAppModule(autoCodeDto, projectRoot);
      if (dto.generateWeb) {
        await this.updateUmiRoutes(autoCodeDto, projectRoot);
      }
      await updateStep(4, 'completed');

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
          `release/lowcode/apps/server/src/db/schema/${n.kebabName}.ts`,
          `release/lowcode/apps/server/src/modules/${n.kebabSingular}/${n.kebabSingular}.service.ts`,
          `release/lowcode/apps/server/src/modules/${n.kebabSingular}/${n.kebabSingular}.controller.ts`,
          `release/lowcode/apps/server/src/modules/${n.kebabSingular}/${n.kebabSingular}.module.ts`,
          `release/lowcode/apps/server/src/modules/${n.kebabSingular}/dto/create-${n.kebabSingular}.dto.ts`,
          `release/lowcode/apps/server/src/modules/${n.kebabSingular}/dto/query-${n.kebabSingular}.dto.ts`,
          `release/lowcode/apps/server/src/modules/${n.kebabSingular}/dto/update-${n.kebabSingular}.dto.ts`,
          `release/lowcode/apps/web/src/services/${n.kebabSingular}.ts`,
          `release/lowcode/apps/web/src/pages/${n.kebabName}/index.tsx`,
        ];
        for (const p of expectedPaths) {
          const fullPath = path.join(root, p);
          if (existsSync(fullPath)) {
            await fs.rm(fullPath, { force: true });
          }
        }
        const moduleDir = path.join(root, `release/lowcode/apps/server/src/modules/${n.kebabSingular}`);
        if (existsSync(moduleDir)) {
          try { await fs.rmdir(path.join(moduleDir, 'dto')); } catch { /* not empty */ }
          try { await fs.rmdir(moduleDir); } catch { /* not empty */ }
        }
        const pageDir = path.join(root, `release/lowcode/apps/web/src/pages/${n.kebabName}`);
        if (existsSync(pageDir)) {
          try { await fs.rmdir(pageDir); } catch { /* not empty */ }
        }
        await this.removeSchemaExport(n);
        await this.removeModuleRegistration(n);
        await this.removeRouteFromUmirc(n);
        this.logger.log(` Force mode: cleaned up existing files for '${dto.tableName}'`);
      }

      // Step 1: Generate code in memory
      await updateStep(0, 'running');
      files = this.preview(dto);
      projectRoot = this.resolveProjectRoot();

      if (dto.generateWeb) {
        const n = deriveNames(dto.tableName);
        const activeDto: AutoCodeDto = { ...dto, fields: activeFields(dto.fields) };
        const relationDictTypes = await this.lookupRelationDisplayDictTypes(activeDto.fields);
        if ([...relationDictTypes.values()].some((v) => v !== null)) {
          files[`release/lowcode/apps/web/src/services/${n.kebabSingular}.ts`] = generateFrontendService(activeDto, relationDictTypes);
          files[`release/lowcode/apps/web/src/pages/${n.kebabName}/index.tsx`] = generateFrontendPage(activeDto, relationDictTypes);
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
      await this.updateSchemaIndex(dto, projectRoot);
      await this.updateAppModule(dto, projectRoot);
      if (dto.generateWeb) {
        await this.updateUmiRoutes(dto, projectRoot);
      }
      await updateStep(1, 'completed');

      // Step 3: drizzle-kit push
      await updateStep(2, 'running', '正在同步数据库表...');
      let pushSucceeded = false;
      try {
        const { exec } = await import('node:child_process');
        const { promisify } = await import('node:util');
        const execAsync = promisify(exec);
        const serverDir = path.join(projectRoot, 'release', 'lowcode', 'apps', 'server');
        await execAsync('npx --no-install drizzle-kit push --force', {
          cwd: serverDir, timeout: 60000,
          env: { ...process.env, DRIZZLE_SILENT: '1' },
        });
        pushSucceeded = true;
        this.logger.log(` drizzle-kit push (silent) completed for '${dto.tableName}'`);
      } catch (pushErr: unknown) {
        this.logger.error(` drizzle-kit push FAILED for '${dto.tableName}':`, pushErr);
      }
      await updateStep(2, 'completed');

      // Step 4: Generate mock business data (NON-FATAL).
      // Runs only when schema-sync succeeded and dto.mockData.enabled is set.
      await updateStep(3, 'running');
      try {
        if (dto.mockData?.enabled && pushSucceeded) {
          await this.insertMockData(dto);
        }
      } catch (mockErr: unknown) {
        const msg = mockErr instanceof Error ? mockErr.message : String(mockErr);
        this.logger.warn(` mock insert skipped for '${dto.tableName}': ${msg}`);
      } finally {
        await updateStep(3, 'completed');
      }

      // Step 5: Create menu
      await updateStep(4, 'running');
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
      await updateStep(4, 'completed');

      // Step 6: Save history
      await updateStep(5, 'running');
      try {
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
      await updateStep(5, 'completed');

      // Step 7: Update remaining entry points (LAST — triggers nest --watch restart)
      await updateStep(6, 'running');
      await this.updateAppModule(dto, projectRoot);
      if (dto.generateWeb) {
        await this.updateUmiRoutes(dto, projectRoot);
      }
      await updateStep(6, 'completed');

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

  async rollbackHistory(id: string): Promise<{ restoredFiles: string[] }> {
    const history = await this.findOneHistory(id);
    const templates = history.templates as Record<string, string>;
    const projectRoot = this.resolveProjectRoot();
    const restoredFiles: string[] = [];

    for (const [relativePath, content] of Object.entries(templates)) {
      const absolutePath = path.join(projectRoot, relativePath);
      const dir = path.dirname(absolutePath);
      await fs.mkdir(dir, { recursive: true });
      await fs.writeFile(absolutePath, content, 'utf-8');
      restoredFiles.push(relativePath);
    }

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

  async deleteHistory(id: string): Promise<{ deletedFiles: string[]; droppedTable: boolean; removedMenus: number }> {
    const history = await this.findOneHistory(id);
    const tableName = history.tableName;
    const n = deriveNames(tableName);
    const projectRoot = this.resolveProjectRoot();

    const deletedFiles: string[] = [];
    let droppedTable = false;
    let removedMenus = 0;

    const expectedPaths = [
      `release/lowcode/apps/server/src/db/schema/${n.kebabName}.ts`,
      `release/lowcode/apps/server/src/modules/${n.kebabSingular}/${n.kebabSingular}.service.ts`,
      `release/lowcode/apps/server/src/modules/${n.kebabSingular}/${n.kebabSingular}.controller.ts`,
      `release/lowcode/apps/server/src/modules/${n.kebabSingular}/${n.kebabSingular}.module.ts`,
      `release/lowcode/apps/server/src/modules/${n.kebabSingular}/dto/create-${n.kebabSingular}.dto.ts`,
      `release/lowcode/apps/server/src/modules/${n.kebabSingular}/dto/query-${n.kebabSingular}.dto.ts`,
      `release/lowcode/apps/server/src/modules/${n.kebabSingular}/dto/update-${n.kebabSingular}.dto.ts`,
      `release/lowcode/apps/web/src/services/${n.kebabSingular}.ts`,
      `release/lowcode/apps/web/src/pages/${n.kebabName}/index.tsx`,
    ];
    for (const p of expectedPaths) {
      const fullPath = path.join(projectRoot, p);
      if (existsSync(fullPath)) {
        await fs.rm(fullPath, { force: true });
        deletedFiles.push(p);
      }
    }
    const moduleDir = path.join(projectRoot, `release/lowcode/apps/server/src/modules/${n.kebabSingular}`);
    if (existsSync(moduleDir)) {
      try { await fs.rmdir(moduleDir); } catch { /* not empty */ }
      try { await fs.rmdir(path.join(moduleDir, 'dto')); } catch { /* not empty */ }
    }
    const pageDir = path.join(projectRoot, `release/lowcode/apps/web/src/pages/${n.kebabName}`);
    if (existsSync(pageDir)) {
      try { await fs.rmdir(pageDir); } catch { /* not empty */ }
    }

    await this.removeRouteFromUmirc(n);
    await this.removeSchemaExport(n);
    await this.removeModuleRegistration(n);

    const dbTableName = `lc_${tableName}`;
    const componentPath = `./${n.kebabName}/index`;
    const menuRows = await this.db
      .select({ id: sysMenus.id, name: sysMenus.name, path: sysMenus.path })
      .from(sysMenus)
      .where(and(eq(sysMenus.component, componentPath), isNull(sysMenus.deletedAt)));
    if (menuRows.length > 0) {
      const pageMenuIds = menuRows.map((m) => m.id);
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
      await this.db.delete(sysAuthorityBtns).where(inArray(sysAuthorityBtns.menuId, allMenuIds));
      await this.db.delete(sysRoleMenus).where(inArray(sysRoleMenus.menuId, allMenuIds));
      await this.db.delete(sysMenus).where(inArray(sysMenus.id, allMenuIds));
      removedMenus = allMenuIds.length;
    }

    try {
      const tableExists = await this.db.execute(sql`
        SELECT COUNT(*) as cnt FROM information_schema.tables
        WHERE table_schema = 'public' AND table_name = ${dbTableName}
      `);
      if ((tableExists[0] as any)?.cnt > 0) {
        await this.db.execute(sql.raw(`DROP TABLE IF EXISTS "${dbTableName}" CASCADE`));
        droppedTable = true;
      }
    } catch { /* Table may not exist or drop failed */ }

    await this.db
      .delete(sysAutoCodeHistories)
      .where(eq(sysAutoCodeHistories.tableName, tableName));

    return { deletedFiles, droppedTable, removedMenus };
  }

  // =========================================================================
  // Soft cleanup helper
  // =========================================================================

  private async cleanupTableSoft(
    tableName: string,
    projectRoot: string,
  ): Promise<{ deletedFiles: string[]; removedMenus: number }> {
    const n = deriveNames(tableName);
    const deletedFiles: string[] = [];
    let removedMenus = 0;

    const expectedPaths = [
      `release/lowcode/apps/server/src/db/schema/${n.kebabName}.ts`,
      `release/lowcode/apps/server/src/modules/${n.kebabSingular}/${n.kebabSingular}.service.ts`,
      `release/lowcode/apps/server/src/modules/${n.kebabSingular}/${n.kebabSingular}.controller.ts`,
      `release/lowcode/apps/server/src/modules/${n.kebabSingular}/${n.kebabSingular}.module.ts`,
      `release/lowcode/apps/server/src/modules/${n.kebabSingular}/dto/create-${n.kebabSingular}.dto.ts`,
      `release/lowcode/apps/server/src/modules/${n.kebabSingular}/dto/query-${n.kebabSingular}.dto.ts`,
      `release/lowcode/apps/server/src/modules/${n.kebabSingular}/dto/update-${n.kebabSingular}.dto.ts`,
      `release/lowcode/apps/web/src/services/${n.kebabSingular}.ts`,
      `release/lowcode/apps/web/src/pages/${n.kebabName}/index.tsx`,
    ];
    for (const p of expectedPaths) {
      const fullPath = path.join(projectRoot, p);
      if (existsSync(fullPath)) {
        await fs.rm(fullPath, { force: true });
        deletedFiles.push(p);
      }
    }
    const moduleDir = path.join(projectRoot, `release/lowcode/apps/server/src/modules/${n.kebabSingular}`);
    if (existsSync(moduleDir)) {
      try { await fs.rmdir(path.join(moduleDir, 'dto')); } catch { /* not empty */ }
      try { await fs.rmdir(moduleDir); } catch { /* not empty */ }
    }
    const pageDir = path.join(projectRoot, `release/lowcode/apps/web/src/pages/${n.kebabName}`);
    if (existsSync(pageDir)) {
      try { await fs.rmdir(pageDir); } catch { /* not empty */ }
    }

    await this.removeRouteFromUmirc(n);
    await this.removeSchemaExport(n);
    await this.removeModuleRegistration(n);

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
  // Impact analysis
  // =========================================================================

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
    } catch { /* Table doesn't exist */ }

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
    } catch { /* No foreign keys or query failed */ }

    const componentPath = `./${n.kebabName}/index`;
    const menuRows = await this.db
      .select({ id: sysMenus.id, name: sysMenus.name, path: sysMenus.path })
      .from(sysMenus)
      .where(and(eq(sysMenus.component, componentPath), isNull(sysMenus.deletedAt)));
    const menus = menuRows.map((m) => ({ id: m.id, name: m.name, path: m.path ?? '' }));

    let roleMenuCount = 0;
    if (menus.length > 0) {
      const menuIds = menus.map((m) => m.id);
      const rmRows = await this.db
        .select({ count: sql<number>`COUNT(*)` })
        .from(sysRoleMenus)
        .where(inArray(sysRoleMenus.menuId, menuIds));
      roleMenuCount = Number((rmRows[0] as any)?.count ?? 0);
    }

    const projectRoot = this.resolveProjectRoot();
    const files: string[] = [];
    const expectedPaths = [
      `release/lowcode/apps/server/src/db/schema/${n.kebabName}.ts`,
      `release/lowcode/apps/server/src/modules/${n.kebabSingular}/${n.kebabSingular}.service.ts`,
      `release/lowcode/apps/server/src/modules/${n.kebabSingular}/${n.kebabSingular}.controller.ts`,
      `release/lowcode/apps/server/src/modules/${n.kebabSingular}/${n.kebabSingular}.module.ts`,
      `release/lowcode/apps/server/src/modules/${n.kebabSingular}/dto/create-${n.kebabSingular}.dto.ts`,
      `release/lowcode/apps/server/src/modules/${n.kebabSingular}/dto/query-${n.kebabSingular}.dto.ts`,
      `release/lowcode/apps/server/src/modules/${n.kebabSingular}/dto/update-${n.kebabSingular}.dto.ts`,
      `release/lowcode/apps/web/src/services/${n.kebabSingular}.ts`,
      `release/lowcode/apps/web/src/pages/${n.kebabName}/index.tsx`,
    ];
    for (const p of expectedPaths) {
      if (existsSync(path.join(projectRoot, p))) {
        files.push(p);
      }
    }

    const hasHistory = (await this.db
      .select({ id: sysAutoCodeHistories.id })
      .from(sysAutoCodeHistories)
      .where(eq(sysAutoCodeHistories.tableName, tableName))
      .limit(1)).length > 0;

    return { tableName, dbTableName, recordCount, referencedBy, menus, roleMenuCount, files, hasHistory };
  }

  // =========================================================================
  // Version management helpers
  // =========================================================================

  computeChangeLog(oldFields: AutoCodeField[], newFields: AutoCodeField[]): string {
    const changes: string[] = [];
    const oldMap = new Map(oldFields.map((f) => [f.name, f]));
    const newMap = new Map(newFields.map((f) => [f.name, f]));

    for (const f of newFields) {
      if (!oldMap.has(f.name)) changes.push(`新增字段 ${f.name}(${f.type})`);
    }
    for (const f of oldFields) {
      if (!newMap.has(f.name)) changes.push(`移除字段 ${f.name}(${f.type})`);
    }
    for (const f of newFields) {
      const old = oldMap.get(f.name);
      if (old && old.type !== f.type) changes.push(`修改字段 ${f.name}: ${old.type} → ${f.type}`);
    }
    for (const f of newFields) {
      const old = oldMap.get(f.name);
      if (old && !old.removed && f.removed) changes.push(`停用字段 ${f.name}(${f.type})`);
      if (old && old.removed && !f.removed) changes.push(`恢复字段 ${f.name}(${f.type})`);
    }

    return changes.length > 0 ? changes.join('; ') : '无变更';
  }

  hasStructuralChange(oldFields: AutoCodeField[], newFields: AutoCodeField[]): boolean {
    const oldMap = new Map(oldFields.map((f) => [f.name, f]));
    const newMap = new Map(newFields.map((f) => [f.name, f]));

    if (oldMap.size !== newMap.size) return true;

    for (const f of newFields) {
      if (!oldMap.has(f.name)) return true;
    }
    for (const f of oldFields) {
      if (!newMap.has(f.name)) return true;
    }

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
      ) return true;
    }

    return false;
  }

  getRemovedFields(oldFields: AutoCodeField[], newFields: AutoCodeField[]): AutoCodeField[] {
    const newNames = new Set(newFields.map((f) => f.name));
    return oldFields.filter((f) => !newNames.has(f.name));
  }

  async getLatestVersion(tableName: string): Promise<SysAutoCodeHistory & { menuName?: string } | null> {
    const rows = await this.db
      .select()
      .from(sysAutoCodeHistories)
      .where(eq(sysAutoCodeHistories.tableName, tableName))
      .orderBy(desc(sysAutoCodeHistories.version), desc(sysAutoCodeHistories.createdAt))
      .limit(1);

    const record = rows[0] ?? null;

    if (record && !record.fields) {
      const parsed = await this.parseFieldsFromSchema(tableName);
      if (parsed.length > 0) {
        (record as any).fields = parsed;
      }
    }

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

  private async parseFieldsFromSchema(tableName: string): Promise<AutoCodeField[]> {
    try {
      const n = deriveNames(tableName);
      const projectRoot = this.resolveProjectRoot();
      const schemaPath = path.join(projectRoot, 'release/lowcode/apps/server/src/db/schema', `${n.kebabName}.ts`);

      if (!existsSync(schemaPath)) return [];

      const content = await fs.readFile(schemaPath, 'utf-8');
      const fields: AutoCodeField[] = [];

      const columnPattern = /^\s+(\w+):\s+(\w+)\('(\w+)'(?:,\s*\{[^}]*\})?\)(\.notNull\(\))?(\.default\([^)]*\))?(\.references\([^)]*\))?/gm;
      let match: RegExpExecArray | null;

      while ((match = columnPattern.exec(content)) !== null) {
        const colName = match[3]!;

        if (['id', 'created_at', 'updated_at', 'deleted_at', 'created_by', 'updated_by'].includes(colName)) {
          continue;
        }

        const drizzleType = match[2]!;
        const isNotNull = !!match[4];

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
            if (match[6]) { fieldType = 'relation'; } else { fieldType = 'uuid'; }
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

  async getHistoryVersions(tableName: string): Promise<SysAutoCodeHistory[]> {
    return this.db
      .select()
      .from(sysAutoCodeHistories)
      .where(eq(sysAutoCodeHistories.tableName, tableName))
      .orderBy(desc(sysAutoCodeHistories.version), desc(sysAutoCodeHistories.createdAt));
  }

  // =========================================================================
  // ER Graph
  // =========================================================================

  async getErGraph(packageId?: string): Promise<ErGraph> {
    const rows = await this.db
      .select()
      .from(sysAutoCodeHistories)
      .orderBy(
        desc(sysAutoCodeHistories.tableName),
        desc(sysAutoCodeHistories.version),
        desc(sysAutoCodeHistories.createdAt),
      );

    const latestByTable = new Map<string, SysAutoCodeHistory>();
    for (const row of rows) {
      if (!row.tableName) continue;
      const prev = latestByTable.get(row.tableName);
      if (!prev || (row.version ?? 0) > (prev.version ?? 0)) {
        latestByTable.set(row.tableName, row);
      }
    }
    let histories = Array.from(latestByTable.values());

    if (packageId) {
      let pkgName: string | undefined;
      try {
        const pkg = await this.findOnePackage(packageId);
        pkgName = pkg.name;
      } catch { /* package not found */ }
      histories = pkgName
        ? histories.filter((h) => h.packageName === pkgName)
        : [];
    }

    if (histories.length === 0) {
      return { nodes: [], edges: [] };
    }

    const componentPaths = histories.map(
      (h) => `./${deriveNames(h.tableName!).kebabName}/index`,
    );
    const menuRows = await this.db
      .select({ component: sysMenus.component, name: sysMenus.name })
      .from(sysMenus)
      .where(and(inArray(sysMenus.component, componentPaths), isNull(sysMenus.deletedAt)));
    const menuNameByComponent = new Map(menuRows.map((m) => [m.component, m.name]));

    const inputs: ErHistoryInput[] = histories.map((h) => {
      const componentPath = `./${deriveNames(h.tableName!).kebabName}/index`;
      return {
        tableName: h.tableName!,
        description: menuNameByComponent.get(componentPath) || h.tableName!,
        packageName: h.packageName,
        fields: (h.fields as AutoCodeField[]) || null,
      };
    });

    return buildErGraph(inputs);
  }

  // =========================================================================
  // Package CRUD
  // =========================================================================

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

  async updatePackage(id: string, dto: UpdatePackageDto): Promise<SysAutoCodePackage> {
    await this.findOnePackage(id);

    const updateData: Record<string, unknown> = { updatedAt: new Date() };
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

  async deletePackage(id: string): Promise<void> {
    const pkg = await this.findOnePackage(id);

    if (pkg.menuId) {
      const children = await this.db
        .select({ id: sysMenus.id })
        .from(sysMenus)
        .where(eq(sysMenus.parentId, pkg.menuId));

      const childIds = children.map((c) => c.id);

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

      await this.db.delete(sysAuthorityBtns).where(inArray(sysAuthorityBtns.menuId, allMenuIds));
      await this.db.delete(sysRoleMenus).where(inArray(sysRoleMenus.menuId, allMenuIds));
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

    for (const f of dto.fields) {
      if (f.type === 'relation' && f.relationType === 'one-to-many' && f.detailFields?.length) {
        const singularMain = singularize(n.tableName.replace(/^lc_/, ''));
        const childTable = `lc_${singularMain}_${singularize(f.name)}`;
        const fkCol = `${singularMain.replace(/_([a-z])/g, (_, c) => c.toUpperCase())}_id`;
        const childSql = buildCreateTableSql(childTable, f.detailFields, fkCol, n.tableName);
        await this.db.execute(sql.raw(childSql));

        // Grandchild tables (one-to-many within child)
        for (const gf of f.detailFields) {
          if (gf.type === 'relation' && gf.relationType === 'one-to-many' && gf.detailFields?.length) {
            const singularChild = singularize(f.name);
            const singularGrand = singularize(gf.name);
            const grandTable = `lc_${singularMain}_${singularChild}_${singularGrand}`;
            const grandFkColRaw = `${singularMain}_${singularChild}`;
            const grandFkCol = grandFkColRaw.replace(/_([a-z])/g, (_, c: string) => c.toUpperCase()) + '_id';
            const grandSql = buildCreateTableSql(grandTable, gf.detailFields, grandFkCol, childTable);
            await this.db.execute(sql.raw(grandSql));
          }
        }
      }
    }
  }

  private async autoCreateMenu(dto: AutoCodeDto, parentMenuId?: string | null): Promise<string> {
    const n = deriveNames(dto.tableName);
    const componentName = `./${n.kebabName}/index`;

    let menuPath = n.routePath;
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

    const existing = await this.db
      .select({ id: sysMenus.id })
      .from(sysMenus)
      .where(and(eq(sysMenus.path, menuPath), isNull(sysMenus.deletedAt)))
      .limit(1);

    if (existing.length > 0) {
      return existing[0].id;
    }

    const sortWhere = parentMenuId
      ? eq(sysMenus.parentId, parentMenuId)
      : isNull(sysMenus.parentId);
    const maxSortRows = await this.db
      .select({ maxSort: sql<number>`COALESCE(MAX(${sysMenus.sort}), -1)` })
      .from(sysMenus)
      .where(sortWhere);
    const nextSort = (maxSortRows[0]?.maxSort ?? -1) + 1;

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
        menuType: 2,
      })
      .returning();

    const menuId = menuRows[0]!.id;

    const adminRoles = await this.db
      .select({ id: sysRoles.id, code: sysRoles.code })
      .from(sysRoles)
      .where(inArray(sysRoles.code, ['super_admin', 'admin']));

    if (adminRoles.length > 0) {
      await this.db
        .insert(sysRoleMenus)
        .values(adminRoles.map((role) => ({ roleId: role.id, menuId })))
        .onConflictDoNothing();
    }

    // Clean up old button-style entries first
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

      if (adminRoles.length > 0) {
        await this.db
          .insert(sysRoleMenus)
          .values(adminRoles.map((role) => ({ roleId: role.id, menuId: subMenuId })))
          .onConflictDoNothing();

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

  private async ensureDirectoryMenu(packageName: string): Promise<string> {
    const kebabDirName = toKebabCase(packageName).replace(/[^a-z0-9-]/g, '') || 'untitled';
    const dirPath = `/pkg/${kebabDirName}`;

    const existingMenu = await this.db
      .select({ id: sysMenus.id })
      .from(sysMenus)
      .where(and(eq(sysMenus.path, dirPath), isNull(sysMenus.deletedAt)))
      .limit(1);

    if (existingMenu.length > 0) {
      return existingMenu[0].id;
    }

    const maxSortRows = await this.db
      .select({ maxSort: sql<number>`COALESCE(MAX(${sysMenus.sort}), -1)` })
      .from(sysMenus)
      .where(isNull(sysMenus.parentId));
    const nextSort = (maxSortRows[0]?.maxSort ?? -1) + 1;

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
        menuType: 1,
      })
      .returning();

    const menuId = menuRows[0]!.id;

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

  private async getPackageName(packageId: string): Promise<string> {
    const rows = await this.db
      .select({ name: sysAutoCodePackages.name })
      .from(sysAutoCodePackages)
      .where(and(eq(sysAutoCodePackages.id, packageId), isNull(sysAutoCodePackages.deletedAt)))
      .limit(1);
    return rows[0]?.name ?? '';
  }

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

  private resolveProjectRoot(): string {
    let dir = process.cwd();
    const root = path.parse(dir).root;
    while (dir !== root) {
      if (existsSync(path.join(dir, 'release', 'lowcode', 'apps', 'server', 'src'))) {
        return dir;
      }
      dir = path.resolve(dir, '..');
    }
    throw new Error(`Cannot resolve project root from cwd=${process.cwd()}`);
  }

  private async updateSchemaIndex(dto: AutoCodeDto, projectRoot: string): Promise<void> {
    const n = deriveNames(dto.tableName);
    const indexPath = path.join(projectRoot, 'release/lowcode/apps/server/src/db/schema/index.ts');
    const exportLine = `export * from './${n.kebabName}.js';`;

    let content = await fs.readFile(indexPath, 'utf-8');
    if (content.includes(exportLine)) return;

    content = content.trimEnd() + '\n' + exportLine + '\n';
    await fs.writeFile(indexPath, content, 'utf-8');
  }

  private async updateAppModule(dto: AutoCodeDto, projectRoot: string): Promise<void> {
    const n = deriveNames(dto.tableName);
    const modulePath = path.join(projectRoot, 'release/lowcode/apps/server/src/app.module.ts');

    let content = await fs.readFile(modulePath, 'utf-8');

    const importLine = `import { ${n.pascalSingular}Module } from './modules/${n.kebabSingular}/${n.kebabSingular}.module';`;
    const moduleLine = `    ${n.pascalSingular}Module,`;

    if (content.includes(importLine)) return;

    const lastImportMatch = content.match(/^import .+;$/gm);
    if (lastImportMatch && lastImportMatch.length > 0) {
      const lastImport = lastImportMatch[lastImportMatch.length - 1]!;
      content = content.replace(lastImport, `${lastImport}\n${importLine}`);
    }

    content = content.replace(
      /(\s+)(OperationRecordModule,)/,
      `$1$2\n${moduleLine}`,
    );

    await fs.writeFile(modulePath, content, 'utf-8');
  }

  private async updateUmiRoutes(dto: AutoCodeDto, projectRoot: string): Promise<void> {
    const n = deriveNames(dto.tableName);
    const umircPath = path.join(projectRoot, 'release/lowcode/apps/web/.umirc.ts');
    let content = await fs.readFile(umircPath, 'utf-8');

    if (dto.packageId) {
      let pkg: SysAutoCodePackage | null = null;
      try { pkg = await this.findOnePackage(dto.packageId); } catch { /* fall back to flat route */ }

      if (pkg?.menuId) {
        const parentMenu = await this.db
          .select({ path: sysMenus.path, name: sysMenus.name })
          .from(sysMenus)
          .where(eq(sysMenus.id, pkg.menuId))
          .limit(1);

        if (parentMenu.length > 0 && parentMenu[0].path) {
          const dirPath = parentMenu[0].path;
          const dirName = parentMenu[0].name;
          const childPath = `${dirPath}/${n.kebabName}`;

          if (content.includes(`path: '${childPath}'`)) return;

          const childEntry = `      { path: '${childPath}', name: '${dto.description || n.pascalName}', icon: 'TableOutlined', component: './${n.kebabName}/index' },`;

          const dirMarker = `path: '${dirPath}'`;
          if (content.includes(dirMarker)) {
            const dirRegex = new RegExp(
              `(\\{[^}]*path:\\s*'${dirPath.replace(/\//g, '\\/')}'[^}]*routes:\\s*\\[[^\\]]*)(\\][^}]*\\},)`,
              's',
            );
            const match = content.match(dirRegex);
            if (match) {
              content = content.replace(dirRegex, `$1\n${childEntry}\n      $2`);
            }
          } else {
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

    const routePath = n.routePath;
    const routePattern = `path: '${routePath}'`;
    if (content.includes(routePattern)) {
      if (!content.includes(`component: './${n.kebabName}/index'`)) {
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

  private async removeRouteFromUmirc(n: DerivedNames): Promise<void> {
    const projectRoot = this.resolveProjectRoot();
    const umircPath = path.join(projectRoot, 'release/lowcode/apps/web/.umirc.ts');
    if (!existsSync(umircPath)) return;

    let content = await fs.readFile(umircPath, 'utf-8');
    const routePath = n.routePath;
    const componentPath = `./${n.kebabName}/index`;

    const flatBlockRegex = new RegExp(
      `\\s*\\{[^{}]*path:\\s*'${routePath.replace(/\//g, '\\/')}'[^{}]*component:\\s*'${componentPath.replace(/\//g, '\\/')}'[^{}]*\\},?`,
      'gs',
    );
    if (flatBlockRegex.test(content)) {
      content = content.replace(flatBlockRegex, '');
    } else {
      const lines = content.split('\n');
      content = lines.filter((line) => !line.includes(`component: '${componentPath}'`)).join('\n');
    }

    content = content.replace(
      /    \{\n      path: '\/pkg\/[^']+',\n      name: '[^']+',\n      icon: '[^']+',\n      routes: \[\s*\],\n    \},\n?/g,
      '',
    );

    await fs.writeFile(umircPath, content, 'utf-8');
  }

  private async removeSchemaExport(n: DerivedNames): Promise<void> {
    const projectRoot = this.resolveProjectRoot();
    const indexPath = path.join(projectRoot, 'release/lowcode/apps/server/src/db/schema/index.ts');
    if (!existsSync(indexPath)) return;

    let content = await fs.readFile(indexPath, 'utf-8');

    const exportPattern = new RegExp(
      `export \\* from '\\.\\/${n.kebabName}\\.js';\\n?`,
    );
    content = content.replace(exportPattern, '');

    await fs.writeFile(indexPath, content, 'utf-8');
  }

  private async removeModuleRegistration(n: DerivedNames): Promise<void> {
    const projectRoot = this.resolveProjectRoot();
    const modulePath = path.join(projectRoot, 'release/lowcode/apps/server/src/app.module.ts');
    if (!existsSync(modulePath)) return;

    let content = await fs.readFile(modulePath, 'utf-8');

    const importPattern = new RegExp(
      `import \\{ ${n.pascalSingular}Module \\} from '\\./modules/${n.kebabSingular}/${n.kebabSingular}\\.module';\\n?`,
    );
    content = content.replace(importPattern, '');

    const moduleArrayPattern = new RegExp(
      `\\s*${n.pascalSingular}Module,\\n?`,
    );
    content = content.replace(moduleArrayPattern, '');

    await fs.writeFile(modulePath, content, 'utf-8');
  }
}
