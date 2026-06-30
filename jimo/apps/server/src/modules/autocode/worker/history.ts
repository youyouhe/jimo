/**
 * Pure-function port of AutocodeService history step (saveHistory).
 * Called by tools/generate-worker.ts. No NestJS DI, no Drizzle — direct postgres.
 *
 * Known divergence: the original merges agent metadata into templates.__agent
 * via a private service method; omitted here (caller may pre-set files.__agent).
 */
import type { Sql } from 'postgres';
import type { AutoCodeDto } from '../dto/autocode.dto';

type AnyPostgresSql = Sql;

export interface SaveHistoryOpts {
  packageName?: string;
  operation?: string;
  changeLog?: string;
}

export async function saveHistory(
  sql: AnyPostgresSql,
  dto: AutoCodeDto,
  files: Record<string, any>,
  opts?: SaveHistoryOpts,
): Promise<void> {
  const latestRows = await sql`
    SELECT id, version
    FROM sys_auto_code_histories
    WHERE table_name = ${dto.tableName}
    ORDER BY version DESC NULLS LAST, created_at DESC
    LIMIT 1
  `;
  const existing: { id: string; version: number | null } | null =
    latestRows.length > 0 ? (latestRows[0] as { id: string; version: number | null }) : null;

  const nextVersion = existing ? (existing.version ?? 1) + 1 : 1;

  const asyncPackageName = opts?.packageName ?? '';
  const templates: Record<string, any> = { ...files };
  const businessDB = (dto as any).businessDB || '';
  const fields = dto.fields ?? [];
  const changeLog = opts?.changeLog ?? (dto.force ? '强制重新生成' : '初始创建');
  const operation = opts?.operation ?? 'create';
  const parentId = existing?.id ?? null;
  const visibilityStrategy =
    (dto.visibilityStrategy as string | undefined) ??
    (existing as any)?.visibilityStrategy ??
    'private';
  const hasApprovalFlow =
    dto.approvalFlow?.enabled ?? (existing as any)?.hasApprovalFlow ?? false;
  const hasAgent =
    dto.agentConfig?.enabled ?? (existing as any)?.hasAgent ?? false;

  // Pass JSON strings without ::jsonb cast — postgres-js binds them as 'text'
  // and the column type (jsonb) handles the coercion automatically. Using
  // ::jsonb with a pre-serialised string causes double-encoding (jsonb_typeof='string').
  const packageSlug = (dto as any)._packageSlug ?? 'default';

  await sql.unsafe(
    `INSERT INTO sys_auto_code_histories (
      package_name, table_name, business_db, templates, version, fields,
      change_log, operation, parent_id, visibility_strategy, has_approval_flow, has_agent,
      package_slug
    ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13)`,
    [
      asyncPackageName, dto.tableName, businessDB,
      JSON.stringify(templates), nextVersion,
      JSON.stringify(fields), changeLog, operation,
      parentId, visibilityStrategy, hasApprovalFlow, hasAgent,
      packageSlug,
    ],
  );
}
