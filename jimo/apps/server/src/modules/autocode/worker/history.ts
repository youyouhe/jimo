/**
 * Pure-function port of AutocodeService history step (saveHistory).
 * Called by tools/generate-worker.ts. No NestJS DI, no Drizzle — direct postgres.
 *
 * Merges agent metadata into templates.__agent (via buildAgentConfigMetadata)
 * whenever hasAgent is true, and stores templates/fields as proper jsonb objects
 * via the tagged template. (sql.unsafe + JSON.stringify double-encodes to a jsonb
 * string scalar, jsonb_typeof='string', which breaks templates.__agent reads —
 * same lesson as worker/entrypoints.ts.)
 */
import type { AutoCodeDto } from '../dto/autocode.dto';
import { buildAgentConfigMetadata } from './agent-config';

export interface SaveHistoryOpts {
  packageName?: string;
  operation?: string;
  changeLog?: string;
}

export async function saveHistory(
  sql: any,
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

  // Inject agent metadata so entity-scoped agent chat can load its config.
  // Key off `hasAgent` (not dto.agentConfig?.enabled) — hasAgent already folds
  // in the existing-record fallback and is the value actually persisted, so it
  // reliably reflects "this row should carry an __agent snapshot". Relying on
  // dto.agentConfig?.enabled at the caller proved unreliable in the update path.
  if (hasAgent) templates.__agent = buildAgentConfigMetadata(dto);

  const packageSlug = (dto as any)._packageSlug ?? 'default';

  // Use the tagged template (NOT sql.unsafe + JSON.stringify) so postgres-js
  // serialises objects to jsonb directly. The unsafe/stringify form produces a
  // jsonb *string scalar* (jsonb_typeof='string'), which breaks every reader
  // that does templates.__agent / templates->'__agent'. Cast jsonb columns
  // explicitly with ::jsonb.
  await sql`
    INSERT INTO sys_auto_code_histories (
      package_name, table_name, business_db, templates, version, fields,
      change_log, operation, parent_id, visibility_strategy, has_approval_flow, has_agent,
      package_slug
    ) VALUES (
      ${asyncPackageName}, ${dto.tableName}, ${businessDB},
      ${templates}::jsonb, ${nextVersion}, ${fields}::jsonb,
      ${changeLog}, ${operation}, ${parentId}, ${visibilityStrategy},
      ${hasApprovalFlow}, ${hasAgent}, ${packageSlug}
    )
  `;
}
