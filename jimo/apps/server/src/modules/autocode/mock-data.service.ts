import { Inject, Injectable, Logger } from '@nestjs/common';
import { DATABASE_CONNECTION, DrizzleDb } from '../../db/connection';
import { DictionaryDetailService } from '../dictionary-detail/dictionary-detail.service';
import { EncodingRuleService } from '../encoding-rule/encoding-rule.service';
import { fakerZH_CN as faker } from '@faker-js/faker';
import { sql } from 'drizzle-orm';
import { AutoCodeDto, AutoCodeField } from './dto/autocode.dto';
import {
  activeFields,
  isBusinessColumn,
  singularize,
  deriveMasterSingular,
  generateMockValue,
  type MockCtx,
} from './autocode-field-utils';

@Injectable()
export class MockDataService {
  private readonly logger = new Logger(MockDataService.name);

  constructor(
    @Inject(DATABASE_CONNECTION) private readonly db: DrizzleDb,
    private readonly dictionaryDetailService: DictionaryDetailService,
    private readonly encodingRuleService: EncodingRuleService,
  ) {}

  /**
   * Insert `dto.mockData.count` mock business rows into lc_<tableName> via raw
   * multi-VALUES INSERT (chunked, ON CONFLICT DO NOTHING). Throws to abort
   * THIS table's mock when a required relation field has an empty parent
   * table; callers must catch (the generate pipeline treats it as non-fatal).
   */
  async insertMockData(dto: AutoCodeDto, userId?: string): Promise<void> {
    const count = dto.mockData?.count ?? 0;
    if (count <= 0 || !dto.mockData?.enabled) return;

    // dto.tableName already carries the lc_ prefix (lc/ namespace); don't double-prefix.
    const tableName = dto.tableName.startsWith('lc_') ? dto.tableName : `lc_${dto.tableName}`;
    const fields = activeFields(dto.fields).filter(
      (f) =>
        isBusinessColumn(f.name) &&
        f.type !== 'calculated' && // virtual — no physical column
        (f.type !== 'relation' || f.relationType === 'many-to-one'),
    );

    if (fields.length === 0) {
      this.logger.log(` mock: no business columns for '${tableName}', skipping`);
      return;
    }

    // 1) Pre-warm context.
    const dictCache: Record<string, string[]> = {};
    const parentIds: Record<string, string[]> = {};

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

    const codeRules: Record<
      string,
      { prefix: string | null; dateFormat: string | null; separator: string; sequenceDigits: number; paddingChar: string }
    > = {};
    const codeUsed: Set<string> = new Set();
    const mintCode = (field: AutoCodeField): string => {
      let prefix = '';
      let dateFormat: string | null = null;
      let separator = '';
      let sequenceDigits = 4;
      let paddingChar = '0';

      if (field.ruleId) {
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

    const buildRow = (): Record<string, string | number | boolean | null> => {
      const row: Record<string, string | number | boolean | null> = {};
      for (const f of fields) {
        row[f.name] = generateMockValue(f, ctx);
      }
      return row;
    };

    const rows: Record<string, string | number | boolean | null>[] = [];
    for (let i = 0; i < count; i += 1) rows.push(buildRow());

    const cols = (userId
      ? [...fields.map((f) => `"${f.name}"`), '"owner_id"', '"created_by"']
      : fields.map((f) => `"${f.name}"`)
    ).join(', ');
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
        .map((row) => {
          const vals = fields.map((f) => escapeValue(row[f.name] ?? null));
          if (userId) {
            vals.push(`'${userId}'::uuid`, `'${userId}'::uuid`);
          }
          return `(${vals.join(', ')})`;
        })
        .join(', ');
      const insertSql = `INSERT INTO "${tableName}" (${cols}) VALUES ${valuesSql} ON CONFLICT DO NOTHING`;
      try {
        await this.db.execute(sql.raw(insertSql));
        inserted += chunk.length;
      } catch (err: unknown) {
        this.logger.warn(` mock: chunk insert failed for '${tableName}': ${(err as Error).message}`);
      }
    }

    try {
      const res = await this.db.execute(
        sql.raw(`SELECT COUNT(*)::int AS c FROM "${tableName}" WHERE deleted_at IS NULL`),
      );
      const total = (res as unknown as any[])?.[0]?.c ?? '?';
      this.logger.log(` mock: inserted ${inserted} rows (table '${tableName}' now has ${total} live rows)`);
    } catch {
      this.logger.log(` mock: inserted ${inserted} rows into '${tableName}'`);
    }

    // One-to-many child detail tables
    const oneToManyFields = activeFields(dto.fields).filter(
      (f) => f.type === 'relation' && f.relationType === 'one-to-many' && (f.detailFields || []).length > 0,
    );
    if (oneToManyFields.length > 0) {
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
        const singularMain = deriveMasterSingular(dto.tableName);
        const singularField = singularize(f.name);
        const childTable = isExisting ? `lc_${f.relationTable}` : `lc_${singularMain}_${singularField}`;
        const fkColumn = isExisting ? (f.relationFkColumn || `${singularMain}_id`) : `${singularMain}_id`;
        const childFields = (f.detailFields || []).filter(
          (df) =>
            isBusinessColumn(df.name) &&
            df.type !== 'calculated' && // virtual — no physical column
            !(df.type === 'relation' && df.relationTable === dto.tableName),
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
        const childCols = (userId
          ? [...childColNames.map((c) => `"${c}"`), '"owner_id"', '"created_by"']
          : childColNames.map((c) => `"${c}"`)
        ).join(', ');
        let childInserted = 0;
        for (let i = 0; i < childRows.length; i += CHUNK_SIZE) {
          const chunk = childRows.slice(i, i + CHUNK_SIZE);
          const valuesSql = chunk
            .map((row) => {
              const vals = childColNames.map((c) => escapeValue(row[c] ?? null));
              if (userId) {
                vals.push(`'${userId}'::uuid`, `'${userId}'::uuid`);
              }
              return `(${vals.join(', ')})`;
            })
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

        if (!isExisting) {
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
            const grandFkColumn = `${singularMain}_${singularField}_id`;
            const grandFields = gf.detailFields.filter(
              (gdf) =>
                isBusinessColumn(gdf.name) &&
                gdf.type !== 'calculated' && // virtual — no physical column
                !(gdf.type === 'relation' && gdf.relationType === 'one-to-many'),
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
            const grandCols = (userId
              ? [...grandColNames.map((c) => `"${c}"`), '"owner_id"', '"created_by"']
              : grandColNames.map((c) => `"${c}"`)
            ).join(', ');
            let grandInserted = 0;
            for (let i = 0; i < grandRows.length; i += CHUNK_SIZE) {
              const chunk = grandRows.slice(i, i + CHUNK_SIZE);
              const valuesSql = chunk
                .map((row) => {
                  const vals = grandColNames.map((c) => escapeValue(row[c] ?? null));
                  if (userId) {
                    vals.push(`'${userId}'::uuid`, `'${userId}'::uuid`);
                  }
                  return `(${vals.join(', ')})`;
                })
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
}
