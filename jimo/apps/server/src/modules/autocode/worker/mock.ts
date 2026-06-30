/**
 * Worker-friendly pure-function port of MockDataService.insertMockData.
 * `sql` is a `postgres`-package connection (NOT drizzle). The three pre-warm
 * queries that used to go through DictionaryDetailService /
 * EncodingRuleService / this.db.execute are inlined as direct SQL with
 * table/column names matching the drizzle schemas exactly. Semantically
 * identical to the original; logger.* → console.*. Still non-fatal-throws on
 * a required relation field with an empty parent table (caller catches).
 */
import { fakerZH_CN as faker } from '@faker-js/faker';
import type { AutoCodeDto, AutoCodeField } from '../dto/autocode.dto';
import {
  activeFields,
  isBusinessColumn,
  singularize,
  generateMockValue,
  type MockCtx,
} from '../autocode-field-utils';

export async function mockInsertData(
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  sql: any,
  dto: AutoCodeDto,
  userId?: string,
): Promise<void> {
  const count = dto.mockData?.count ?? 0;
  if (count <= 0 || !dto.mockData?.enabled) return;

  const tableName = `lc_${dto.tableName}`;
  const fields = activeFields(dto.fields).filter(
    (f) =>
      isBusinessColumn(f.name) &&
      f.type !== 'calculated' &&
      (f.type !== 'relation' || f.relationType === 'many-to-one'),
  );

  if (fields.length === 0) {
    console.log(` mock: no business columns for '${tableName}', skipping`);
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
      const details = await sql`
        SELECT d.value AS value, d.status AS status
        FROM sys_dictionary_details d
        JOIN sys_dictionaries dict ON dict.id = d.dict_id
        WHERE dict.type = ${dt}
          AND dict.deleted_at IS NULL
          AND d.deleted_at IS NULL
        ORDER BY d.sort ASC, d.created_at ASC
      `;
      dictCache[dt] = details
        .filter((r: any) => (r.status ?? 1) === 1 && r.value != null)
        .map((r: any) => String(r.value));
    } catch (err: unknown) {
      console.warn(` mock: failed to load dict '${dt}': ${(err as Error).message}`);
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
      const res = await sql.unsafe(`SELECT id FROM "lc_${rt}" WHERE deleted_at IS NULL`);
      parentIds[rt] = (res as unknown as any[])
        .map((r) => r.id)
        .filter((id): id is string => typeof id === 'string');
    } catch (err: unknown) {
      console.warn(` mock: failed to load parent ids for 'lc_${rt}': ${(err as Error).message}`);
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

  // mintCode reads codeRules lazily → rules must be loaded BEFORE buildRow.
  const codeRuleIds = new Set(
    fields.filter((f) => f.type === 'code' && f.ruleId).map((f) => f.ruleId!),
  );
  for (const rid of codeRuleIds) {
    try {
      const rows = await sql`
        SELECT prefix,
               date_format    AS "dateFormat",
               separator,
               sequence_digits AS "sequenceDigits",
               padding_char   AS "paddingChar"
        FROM sys_encoding_rules
        WHERE id = ${rid}
          AND deleted_at IS NULL
        LIMIT 1
      `;
      const rule: any = rows[0];
      if (!rule) {
        console.warn(` mock: encoding rule '${rid}' not found, skipping`);
        continue;
      }
      codeRules[rid] = {
        prefix: rule.prefix ?? '',
        dateFormat: rule.dateFormat ?? null,
        separator: rule.separator ?? '',
        sequenceDigits: rule.sequenceDigits ?? 4,
        paddingChar: rule.paddingChar ?? '0',
      };
    } catch (err: unknown) {
      console.warn(` mock: failed to load encoding rule '${rid}': ${(err as Error).message}`);
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
        if (userId) vals.push(`'${userId}'::uuid`, `'${userId}'::uuid`);
        return `(${vals.join(', ')})`;
      })
      .join(', ');
    const insertSql = `INSERT INTO "${tableName}" (${cols}) VALUES ${valuesSql} ON CONFLICT DO NOTHING`;
    try {
      await sql.unsafe(insertSql);
      inserted += chunk.length;
    } catch (err: unknown) {
      console.warn(` mock: chunk insert failed for '${tableName}': ${(err as Error).message}`);
    }
  }

  try {
    const res = await sql.unsafe(
      `SELECT COUNT(*)::int AS c FROM "${tableName}" WHERE deleted_at IS NULL`,
    );
    const total = (res as unknown as any[])?.[0]?.c ?? '?';
    console.log(` mock: inserted ${inserted} rows (table '${tableName}' now has ${total} live rows)`);
  } catch {
    console.log(` mock: inserted ${inserted} rows into '${tableName}'`);
  }

  // One-to-many child / grandchild detail tables
  const oneToManyFields = activeFields(dto.fields).filter(
    (f) => f.type === 'relation' && f.relationType === 'one-to-many' && (f.detailFields || []).length > 0,
  );
  if (oneToManyFields.length > 0) {
    let mainIds: string[] = [];
    try {
      const idRes = await sql.unsafe(
        `SELECT id FROM "${tableName}" WHERE deleted_at IS NULL ORDER BY created_at DESC LIMIT ${count}`,
      );
      mainIds = (idRes as unknown as any[]).map((r) => r.id);
    } catch (err: unknown) {
      console.warn(` mock: failed to fetch main ids for child mock: ${(err as Error).message}`);
    }

    for (const f of oneToManyFields) {
      const isExisting = !!(f.relationExistingTable && f.relationTable && f.relationFkColumn);
      const singularMain = singularize(dto.tableName);
      const singularField = singularize(f.name);
      const childTable = isExisting ? `lc_${f.relationTable}` : `lc_${singularMain}_${singularField}`;
      const fkColumn = isExisting ? (f.relationFkColumn || `${singularMain}_id`) : `${singularMain}_id`;
      const childFields = (f.detailFields || []).filter(
        (df) =>
          isBusinessColumn(df.name) &&
          df.type !== 'calculated' &&
          !(df.type === 'relation' && df.relationTable === dto.tableName),
      );
      if (childFields.length === 0 || mainIds.length === 0) continue;

      const childRows: Record<string, string | number | boolean | null>[] = [];
      for (const mainId of mainIds) {
        for (let j = 0; j < count; j += 1) {
          const row: Record<string, string | number | boolean | null> = { [fkColumn]: mainId };
          for (const cf of childFields) row[cf.name] = generateMockValue(cf, ctx);
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
            if (userId) vals.push(`'${userId}'::uuid`, `'${userId}'::uuid`);
            return `(${vals.join(', ')})`;
          })
          .join(', ');
        const insertSql = `INSERT INTO "${childTable}" (${childCols}) VALUES ${valuesSql} ON CONFLICT DO NOTHING`;
        try {
          await sql.unsafe(insertSql);
          childInserted += chunk.length;
        } catch (err: unknown) {
          console.warn(` mock: child chunk insert failed for '${childTable}': ${(err as Error).message}`);
        }
      }
      console.log(` mock: inserted ${childInserted} detail rows into '${childTable}' (${count} per main row)`);
    }
  }
}
