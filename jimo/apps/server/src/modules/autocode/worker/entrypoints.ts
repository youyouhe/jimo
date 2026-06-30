/**
 * Pure-function port of EntrypointService.enqueueEntrypointJob.
 * Mirrors the original DB writes exactly:
 *   1) best-effort cancel stale `cleanup` jobs for this table_name.
 *   2) INSERT a new `entrypoints` job row in pending status.
 * The entrypoints job is then processed by the existing cleanup-worker
 * (processEntrypointsJob) — schema index / app.module / .umirc registration.
 */
import { deriveNames } from '../autocode-field-utils';
import type { AutoCodeDto } from '../dto/autocode.dto';

// Structural shim for the postgres sql tag so this file compiles without a hard
// postgres import; at runtime the real `postgres` instance satisfies it.
// eslint-disable-next-line @typescript-eslint/no-explicit-any
type PostgresSql = any;

export async function enqueueEntrypoints(
  sql: PostgresSql,
  jobId: string,
  dto: AutoCodeDto,
  hasPointFields: boolean,
  createdFiles: string[],
): Promise<void> {
  // 1) Cancel stale cleanup jobs for this table (best-effort).
  try {
    await sql`
      UPDATE sys_cleanup_jobs
      SET status = 'failed', finished_at = NOW(), error = 'Superseded by regenerate'
      WHERE table_name = ${dto.tableName}
        AND job_type = 'cleanup'
        AND status IN ('pending', 'running')
    `;
  } catch {
    /* best-effort, matches original behavior */
  }

  // 2) INSERT entrypoints job row.
  const n = deriveNames(dto.tableName);
  const payload = {
    jobId,
    tableName: dto.tableName,
    description: dto.description,
    generateWeb: dto.generateWeb ?? true,
    hasPointFields,
    agentEnabled: dto.agentConfig?.enabled ?? false,
    pageType: dto.pageType ?? 'list',
    kebabName: n.kebabName,
    kebabSingular: n.kebabSingular,
    pascalSingular: n.pascalSingular,
    routePath: n.routePath,
    pageDir: n.pageDir,
    pageComponentPath: n.pageComponentPath,
    pageMapComponentPath: n.pageMapComponentPath,
    createdFiles,
  };

  // Use tagged template so postgres-js serialises the object to jsonb directly
  // (sql.unsafe + JSON.stringify produced a jsonb string, not object, causing
  // cleanup-worker's payload?.createdFiles to be undefined).
  await sql`
    INSERT INTO sys_cleanup_jobs (id, table_name, status, job_type, payload)
    VALUES (gen_random_uuid(), ${dto.tableName}, 'pending', 'entrypoints', ${payload}::jsonb)
  `;
}
