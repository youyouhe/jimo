#!/usr/bin/env tsx
/**
 * generate-worker.ts — standalone worker that processes sys_generate_jobs.
 *
 * Runs via `tsx` OUTSIDE the NestJS watch process, so dev watch restarts can
 * no longer interrupt a generate job. Mirrors cleanup-worker.mjs architecture:
 * createRequire to borrow server's postgres, FOR UPDATE SKIP LOCKED to claim,
 * direct SQL + fs + child_process (no Drizzle, no NestJS DI).
 *
 * Lifecycle: AutocodeService.startGenerate INSERTs a pending row (payload=dto)
 * → this worker polls, claims, runs the 7-step generate pipeline (reusing the
 * pure generator functions), then marks done/failed.
 */
import { createRequire } from 'node:module';
import { fileURLToPath, pathToFileURL } from 'node:url';
import * as path from 'node:path';
import * as fs from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { exec } from 'node:child_process';
import { promisify } from 'node:util';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const serverPkg = path.resolve(__dirname, '../apps/server/package.json');
const require = createRequire(pathToFileURL(serverPkg));
// eslint-disable-next-line @typescript-eslint/no-var-requires
const postgres: any = require('postgres');
const execAsync = promisify(exec);

// Generators + pure utils (reused verbatim — they are pure functions)
import { deriveNames, activeFields } from '../apps/server/src/modules/autocode/autocode-field-utils';
import {
  generateSchema, generateService, generateController,
  generateCreateDto, generateQueryDto, generateUpdateDto,
  generateModule, generateAgentService, generateAgentModule,
} from '../apps/server/src/modules/autocode/autocode-backend-generators';
import {
  generateFrontendService, generateFrontendPage, generateFrontendGridPage,
  generateFrontendDocumentListPage, generateFrontendDocumentPage, generateFrontendMapPage,
} from '../apps/server/src/modules/autocode/autocode-frontend-generators';
import { generateServiceContractSpec, generateHttpContractSpec } from '../apps/server/src/modules/autocode/autocode-test-generators';
import { isReservedTableName } from '../apps/server/src/modules/autocode/reserved-names';
// Replicated step functions (mock/menu/history/entrypoints) — postgres-direct
import { mockInsertData } from '../apps/server/src/modules/autocode/worker/mock';
import { autoCreateMenu, autoCreateMapMenu } from '../apps/server/src/modules/autocode/worker/menu';
import { saveHistory } from '../apps/server/src/modules/autocode/worker/history';
import { enqueueEntrypoints } from '../apps/server/src/modules/autocode/worker/entrypoints';

type AutoCodeDto = any;

const GENERATE_STEPS = [
  { key: 'generate', label: '正在生成代码...' },
  { key: 'write', label: '正在写入文件...' },
  { key: 'schema-sync', label: '正在同步数据库表...' },
  { key: 'mock', label: '正在生成示例数据...' },
  { key: 'menu', label: '正在创建菜单...' },
  { key: 'history', label: '正在保存版本...' },
  { key: 'entrypoints', label: '正在更新入口文件...' },
];

const UPDATE_STEPS = [
  { key: 'generate', label: '正在生成代码...' },
  { key: 'write', label: '正在覆盖文件...' },
  { key: 'schema-sync', label: '正在同步数据库...' },
  { key: 'history', label: '正在保存版本...' },
  { key: 'entrypoints', label: '正在更新入口文件...' },
];

function resolveProjectRoot(): string {
  let dir = process.cwd();
  const root = path.parse(dir).root;
  while (dir !== root) {
    if (existsSync(path.join(dir, 'release', 'jimo', 'apps', 'server', 'src'))) return dir;
    dir = path.resolve(dir, '..');
  }
  // fallback from script location
  dir = path.resolve(__dirname, '../..');
  while (dir !== root) {
    if (existsSync(path.join(dir, 'release', 'jimo', 'apps', 'server', 'src'))) return dir;
    dir = path.resolve(dir, '..');
  }
  throw new Error(`Cannot resolve project root from cwd=${process.cwd()}`);
}

/** Replicate AutocodeService.preview — pure: dto → files map (no DB). */
function preview(dto: AutoCodeDto): Record<string, string> {
  const n = deriveNames(dto.tableName);
  const files: Record<string, string> = {};
  files[`release/jimo/apps/server/src/db/schema/${n.kebabName}.ts`] = generateSchema(dto);
  const activeDto = { ...dto, fields: activeFields(dto.fields) };
  const mod = `release/jimo/apps/server/src/modules/${n.kebabSingular}`;
  files[`${mod}/dto/create-${n.kebabSingular}.dto.ts`] = generateCreateDto(activeDto);
  files[`${mod}/dto/query-${n.kebabSingular}.dto.ts`] = generateQueryDto(activeDto);
  files[`${mod}/dto/update-${n.kebabSingular}.dto.ts`] = generateUpdateDto(activeDto);
  files[`${mod}/${n.kebabSingular}.service.ts`] = generateService(activeDto);
  files[`${mod}/${n.kebabSingular}.controller.ts`] = generateController(activeDto);
  files[`${mod}/${n.kebabSingular}.module.ts`] = generateModule(activeDto);
  files[`${mod}/${n.kebabSingular}.service.contract.spec.ts`] = generateServiceContractSpec(activeDto);
  files[`${mod}/${n.kebabSingular}.http.contract.spec.ts`] = generateHttpContractSpec(activeDto);
  if (dto.agentConfig?.enabled) {
    files[`${mod}/agent/${n.kebabSingular}.agent.service.ts`] = generateAgentService(activeDto);
    files[`${mod}/agent/${n.kebabSingular}.agent.module.ts`] = generateAgentModule(activeDto);
  }
  if (dto.generateWeb) {
    files[`release/jimo/apps/web/src/services/${n.serviceRelDir}.ts`] = generateFrontendService(activeDto);
    if (dto.pageType === 'document') {
      files[`release/jimo/apps/web/src/pages/${n.pageDir}/index.tsx`] = generateFrontendDocumentListPage(activeDto);
      files[`release/jimo/apps/web/src/pages/${n.pageDir}/detail.tsx`] = generateFrontendDocumentPage(activeDto);
    } else if (dto.pageType === 'grid') {
      files[`release/jimo/apps/web/src/pages/${n.pageDir}/index.tsx`] = generateFrontendGridPage(activeDto);
    } else {
      files[`release/jimo/apps/web/src/pages/${n.pageDir}/index.tsx`] = generateFrontendPage(activeDto);
    }
    if (activeDto.fields.some((f: any) => !f.removed && f.type === 'point')) {
      files[`release/jimo/apps/web/src/pages/${n.pageDir}/map.tsx`] = generateFrontendMapPage(activeDto);
    }
  }
  return files;
}

async function updateStep(sql: any, jobId: string, stepIndex: number, stepStatus: string, STEPS: readonly { key: string; label: string }[] = GENERATE_STEPS): Promise<void> {
  const steps = STEPS.map((s, i) => ({
    key: s.key, label: s.label,
    status: i < stepIndex ? 'completed' : i === stepIndex ? stepStatus : 'pending',
  }));
  const overall = stepStatus === 'failed' ? 'failed' : 'running';
  // Note: postgres-js auto-JSON.stringify's a value used with ::jsonb, so pass
  // the array directly (NOT JSON.stringify'd) to avoid double-encoding.
  await sql`
    UPDATE sys_generate_jobs
    SET payload = jsonb_set(COALESCE(payload, '{}'::jsonb), '{steps}', ${steps}::jsonb),
        status = ${overall}, updated_at = NOW()
    WHERE id = ${jobId}
  `;
}

async function processGenerateJob(sql: any, job: any): Promise<void> {
  const jobId: string = job.id;
  const dto: AutoCodeDto = job.payload?.dto;
  if (!dto) throw new Error('job payload missing dto');
  const projectRoot = resolveProjectRoot();
  const createdFiles: string[] = [];

  // Step 0: force cleanup
  if (dto.force) {
    if (isReservedTableName(dto.tableName)) {
      throw new Error(`拒绝删除:表 '${dto.tableName}' 是系统保留名,不会处理其系统文件(保护平台自带资产)。`);
    }
    const n = deriveNames(dto.tableName);
    const expectedPaths = [
      `release/jimo/apps/server/src/db/schema/${n.kebabName}.ts`,
      `release/jimo/apps/server/src/modules/${n.kebabSingular}/${n.kebabSingular}.service.ts`,
      `release/jimo/apps/server/src/modules/${n.kebabSingular}/${n.kebabSingular}.controller.ts`,
      `release/jimo/apps/server/src/modules/${n.kebabSingular}/${n.kebabSingular}.module.ts`,
      `release/jimo/apps/server/src/modules/${n.kebabSingular}/dto/create-${n.kebabSingular}.dto.ts`,
      `release/jimo/apps/server/src/modules/${n.kebabSingular}/dto/query-${n.kebabSingular}.dto.ts`,
      `release/jimo/apps/server/src/modules/${n.kebabSingular}/dto/update-${n.kebabSingular}.dto.ts`,
      `release/jimo/apps/server/src/modules/${n.kebabSingular}/${n.kebabSingular}.service.contract.spec.ts`,
      `release/jimo/apps/server/src/modules/${n.kebabSingular}/${n.kebabSingular}.http.contract.spec.ts`,
      `release/jimo/apps/web/src/services/${n.serviceRelDir}.ts`,
      `release/jimo/apps/web/src/pages/${n.pageDir}/index.tsx`,
    ];
    for (const p of expectedPaths) {
      const fp = path.join(projectRoot, p);
      if (existsSync(fp)) await fs.rm(fp, { force: true });
    }
    const moduleDir = path.join(projectRoot, `release/jimo/apps/server/src/modules/${n.kebabSingular}`);
    if (existsSync(moduleDir)) {
      for (const sub of ['dto', 'agent']) {
        try { await fs.rmdir(path.join(moduleDir, sub)); } catch { /* */ }
      }
      try { await fs.rmdir(moduleDir); } catch { /* */ }
    }
    console.log(`[generate-worker] Force cleanup for '${dto.tableName}'`);
  }

  // Step 1: preview
  await updateStep(sql, jobId, 0, 'running');
  const files = preview(dto);
  await updateStep(sql, jobId, 0, 'completed');

  // Step 2: write files
  await updateStep(sql, jobId, 1, 'running');
  for (const [rel, content] of Object.entries(files)) {
    const abs = path.join(projectRoot, rel);
    await fs.mkdir(path.dirname(abs), { recursive: true });
    await fs.writeFile(abs, content as string, 'utf-8');
    createdFiles.push(rel);
  }
  await updateStep(sql, jobId, 1, 'completed');

  // Step 3: drizzle-kit push
  await updateStep(sql, jobId, 2, 'running');
  let pushSucceeded = false;
  try {
    const serverDir = path.join(projectRoot, 'release', 'jimo', 'apps', 'server');
    await execAsync('npx --no-install drizzle-kit push --force', {
      cwd: serverDir, timeout: 60000, env: { ...process.env, DRIZZLE_SILENT: '1' },
    });
    pushSucceeded = true;
    console.log(`[generate-worker] push completed for '${dto.tableName}'`);
  } catch (e) {
    console.error(`[generate-worker] push FAILED for '${dto.tableName}':`, (e as Error).message);
  }
  await updateStep(sql, jobId, 2, 'completed');

  // Step 4: mock data
  await updateStep(sql, jobId, 3, 'running');
  try {
    if (dto.mockData?.enabled && pushSucceeded) {
      await mockInsertData(sql, dto, undefined);
    }
  } catch (e) {
    console.warn(`[generate-worker] mock skipped:`, (e as Error).message);
  }
  await updateStep(sql, jobId, 3, 'completed');

  // Step 5: menu + map menu
  await updateStep(sql, jobId, 4, 'running');
  const hasPointFields = !!dto.generateWeb && dto.fields.some((f: any) => !f.removed && f.type === 'point');
  const menuParentId = (await resolvePackageParentMenu(sql, dto)) ?? null;
  try {
    await autoCreateMenu(sql, dto, menuParentId);
    if (hasPointFields) await autoCreateMapMenu(sql, dto, menuParentId);
  } catch (e) {
    console.error(`[generate-worker] menu FAILED:`, (e as Error).message);
  }
  await updateStep(sql, jobId, 4, 'completed');

  // Step 6: history
  await updateStep(sql, jobId, 5, 'running');
  try {
    await saveHistory(sql, dto, files, undefined);
  } catch (e) {
    console.error(`[generate-worker] history FAILED:`, (e as Error).message);
  }
  await updateStep(sql, jobId, 5, 'completed');

  // Step 7: enqueue entrypoints (existing cleanup-worker processes it)
  await updateStep(sql, jobId, 6, 'running');
  await enqueueEntrypoints(sql, jobId, dto, hasPointFields, createdFiles);
  await updateStep(sql, jobId, 6, 'completed');
}

/** Compute field-level change log (ported pure fn from HistoryService). */
function computeChangeLog(oldFields: any[], newFields: any[]): string {
  const changes: string[] = [];
  const oldMap = new Map(oldFields.map((f: any) => [f.name, f]));
  const newMap = new Map(newFields.map((f: any) => [f.name, f]));
  for (const f of newFields) if (!oldMap.has(f.name)) changes.push(`新增字段 ${f.name}(${f.type})`);
  for (const f of oldFields) if (!newMap.has(f.name)) changes.push(`移除字段 ${f.name}(${f.type})`);
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

/**
 * processUpdateJob — UPDATE_STEPS (5 steps: preview/write/push/history/entrypoints).
 * No force-cleanup, no mock, no menu (table already exists). Reuses preview +
 * file-write + push + saveHistory(operation='update', changeLog) + enqueueEntrypoints.
 */
async function processUpdateJob(sql: any, job: any): Promise<void> {
  const jobId: string = job.id;
  const dto: any = job.payload?.dto; // UpdateModuleDto
  if (!dto) throw new Error('update job payload missing dto');
  const projectRoot = resolveProjectRoot();
  const createdFiles: string[] = [];

  // Look up latest version (oldFields for changeLog + version bump + defaults)
  const latestRows = await sql`
    SELECT id, version, fields, has_approval_flow, has_agent, visibility_strategy
    FROM sys_auto_code_histories
    WHERE table_name = ${dto.tableName}
    ORDER BY version DESC NULLS LAST, created_at DESC
    LIMIT 1
  `;
  const latest: any = latestRows[0];
  if (!latest) throw new Error(`Version record for '${dto.tableName}' not found`);

  // fields may be a JSON string (double-serialised by older saveHistory calls)
  const rawFields = latest.fields;
  const oldFields: any[] = Array.isArray(rawFields)
    ? rawFields
    : typeof rawFields === 'string'
      ? (() => { try { return JSON.parse(rawFields); } catch { return []; } })()
      : [];
  const changeLog = computeChangeLog(oldFields, dto.fields);

  const autoCodeDto: AutoCodeDto = {
    tableName: dto.tableName,
    description: dto.description || '',
    fields: dto.fields,
    generateWeb: dto.generateWeb ?? true,
    pageType: dto.pageType ?? 'list',
    approvalFlow: dto.approvalFlow ?? (latest.has_approval_flow ? { enabled: true } : undefined),
    agentConfig: dto.agentConfig ?? (latest.has_agent ? { enabled: true } : undefined),
    visibilityStrategy: dto.visibilityStrategy ?? latest.visibility_strategy ?? 'private',
    packageId: dto.packageId,
    force: dto.force,
  };

  // Step 1: preview
  await updateStep(sql, jobId, 0, 'running', UPDATE_STEPS);
  const files = preview(autoCodeDto);
  await updateStep(sql, jobId, 0, 'completed', UPDATE_STEPS);

  // Step 2: write files (overwrite)
  await updateStep(sql, jobId, 1, 'running', UPDATE_STEPS);
  for (const [rel, content] of Object.entries(files)) {
    const abs = path.join(projectRoot, rel);
    await fs.mkdir(path.dirname(abs), { recursive: true });
    await fs.writeFile(abs, content as string, 'utf-8');
    createdFiles.push(rel);
  }
  await updateStep(sql, jobId, 1, 'completed', UPDATE_STEPS);

  // Step 3: drizzle-kit push (ALTER table to match new schema)
  await updateStep(sql, jobId, 2, 'running', UPDATE_STEPS);
  try {
    const serverDir = path.join(projectRoot, 'release', 'jimo', 'apps', 'server');
    await execAsync('npx --no-install drizzle-kit push --force', {
      cwd: serverDir, timeout: 60000, env: { ...process.env, DRIZZLE_SILENT: '1' },
    });
    console.log(`[generate-worker] update push completed for '${dto.tableName}'`);
  } catch (e) {
    console.error(`[generate-worker] update push FAILED for '${dto.tableName}':`, (e as Error).message);
  }
  await updateStep(sql, jobId, 2, 'completed', UPDATE_STEPS);

  // Step 4: history (operation='update', changeLog)
  await updateStep(sql, jobId, 3, 'running', UPDATE_STEPS);
  try {
    await saveHistory(sql, autoCodeDto, files, { operation: 'update', changeLog });
  } catch (e) {
    console.error(`[generate-worker] update history FAILED:`, (e as Error).message);
  }
  await updateStep(sql, jobId, 3, 'completed', UPDATE_STEPS);

  // Step 5: enqueue entrypoints
  await updateStep(sql, jobId, 4, 'running', UPDATE_STEPS);
  await enqueueEntrypoints(sql, jobId, autoCodeDto, false, createdFiles);
  await updateStep(sql, jobId, 4, 'completed', UPDATE_STEPS);
}

/** If dto.packageId set, resolve its menuId (parent for the new menu). */
async function resolvePackageParentMenu(sql: any, dto: AutoCodeDto): Promise<string | null> {
  if (!dto.packageId) return null;
  try {
    const rows = await sql`SELECT menu_id FROM sys_auto_code_packages WHERE id = ${dto.packageId} AND deleted_at IS NULL LIMIT 1`;
    return (rows[0]?.menu_id as string) ?? null;
  } catch {
    return null;
  }
}

async function main(): Promise<void> {
  const dbUrl = process.env.DATABASE_URL;
  if (!dbUrl) { console.error('[generate-worker] DATABASE_URL not set'); process.exit(1); }
  const sql = postgres(dbUrl, { max: 2 });
  const projectRoot = resolveProjectRoot();
  console.log(`[generate-worker] Started. PROJECT_ROOT=${projectRoot}`);
  console.log(`[generate-worker] Polling sys_generate_jobs every 2s...`);
  const POLL_INTERVAL = 2000;

  const poll = async (): Promise<void> => {
    let job: any;
    try {
      const rows = await sql`
        UPDATE sys_generate_jobs
        SET status = 'running', started_at = NOW()
        WHERE id = (
          SELECT id FROM sys_generate_jobs
          WHERE status = 'pending' ORDER BY created_at ASC LIMIT 1 FOR UPDATE SKIP LOCKED
        )
        RETURNING *
      `;
      job = rows[0];
    } catch (e) {
      console.error('[generate-worker] Poll error:', (e as Error).message);
      setTimeout(poll, POLL_INTERVAL);
      return;
    }
    if (!job) { setTimeout(poll, POLL_INTERVAL); return; }

    try {
      const jobType = job.job_type ?? 'generate';
      if (jobType === 'update') await processUpdateJob(sql, job);
      else await processGenerateJob(sql, job);
      await sql`
        UPDATE sys_generate_jobs
        SET status = 'done', finished_at = NOW(), result = ${{ completedAt: new Date().toISOString() }}::jsonb
        WHERE id = ${job.id}
      `;
      console.log(`[generate-worker] ✅ Job ${job.id} done (${job.table_name})`);
    } catch (e) {
      console.error(`[generate-worker] ❌ Job ${job.id} failed:`, (e as Error).message);
      await sql`
        UPDATE sys_generate_jobs
        SET status = 'failed', finished_at = NOW(), error = ${(e as Error).message}
        WHERE id = ${job.id}
      `;
    }
    setTimeout(poll, 200);
  };

  poll();
  process.on('SIGINT', async () => { console.log('[generate-worker] Shutting down...'); await sql.end(); process.exit(0); });
}

main().catch((e) => { console.error(e); process.exit(1); });
