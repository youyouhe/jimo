#!/usr/bin/env node
/**
 * cleanup-worker.mjs
 *
 * Standalone Node.js worker (no TypeScript, no NestJS) that processes
 * sys_cleanup_jobs rows.  Because it never imports the app source, it is
 * immune to TS compilation errors that would kill a NestJS watch process.
 *
 * Responsibilities per job:
 *   1. Delete generated .ts files from disk
 *   2. Remove schema export from db/schema/index.ts
 *   3. Remove dangling imports in other schema files
 *   4. Remove module registration from app.module.ts
 *   5. Remove routes from .umirc.ts
 *   6. DROP the lc_<table> Postgres table (CASCADE)
 *   7. Soft-delete menu rows + cascade button children
 *   8. Soft-delete sys_apis rows + remove Casbin policies
 *   9. Mark job done / failed
 */

import fs from 'fs';
import path from 'path';
import { fileURLToPath, pathToFileURL } from 'url';
import { createRequire } from 'module';
import { readFile, writeFile, rm, rmdir, readdir, stat } from 'fs/promises';

// postgres パッケージは ESM の import map に乗らないため createRequire 経由でロード
const __filename = fileURLToPath(import.meta.url);
const __dirname_tmp = path.dirname(__filename);
// server の node_modules から postgres を解決
const serverDir = path.resolve(__dirname_tmp, '../apps/server');
const _require = createRequire(pathToFileURL(path.join(serverDir, 'package.json')));
const postgres = _require('postgres');

// ── paths ────────────────────────────────────────────────────────────────────
const __dirname = __dirname_tmp;

// PROJECT_ROOT must match NestJS's AutocodeService.resolveProjectRoot() EXACTLY:
// both walk up from cwd to the dir containing release/jimo/apps/server/src, then
// prefix code paths with release/jimo/... and job-status paths with .tmp/...
// The worker and NestJS communicate via JSON files under <PROJECT_ROOT>/.tmp/generate-jobs
// — if the two roots disagree the worker writes "completed" where NestJS never reads
// it and the UI stays stuck at 0% (this is exactly the bug that recurred here:
// JIMO_ROOT=release/jimo made code paths right but put .tmp under release/jimo,
// while NestJS puts .tmp under the git root).
function resolveProjectRoot() {
  let dir = process.cwd();
  const root = path.parse(dir).root;
  while (dir !== root) {
    if (fs.existsSync(path.join(dir, 'release', 'jimo', 'apps', 'server', 'src'))) {
      return dir;
    }
    dir = path.resolve(dir, '..');
  }
  // fallback: worker lives at release/jimo/tools/ → git root is three levels up
  return path.resolve(__dirname, '..', '..', '..');
}

const PROJECT_ROOT = resolveProjectRoot();
const SERVER_SRC   = path.join(PROJECT_ROOT, 'release/jimo/apps/server/src');
const SCHEMA_INDEX = path.join(SERVER_SRC, 'db/schema/index.ts');
const APP_MODULE   = path.join(SERVER_SRC, 'app.module.ts');
const GENERATED_MODULE = path.join(SERVER_SRC, 'generated.module.ts');
const UMIRC             = path.join(PROJECT_ROOT, 'release/jimo/apps/web/.umirc.ts');
const GENERATED_ROUTES  = path.join(PROJECT_ROOT, 'release/jimo/apps/web/src/generated-routes.ts');

// ── name derivation (mirrors autocode-field-utils.ts) ────────────────────────
function toPascalCase(name) {
  if (!name) return '';
  return name.split('_').map(w => w.charAt(0).toUpperCase() + w.slice(1).toLowerCase()).join('');
}
function toCamelCase(name) {
  const p = toPascalCase(name);
  return p.charAt(0).toLowerCase() + p.slice(1);
}
function toKebabCase(name) {
  if (name.includes('_')) return name.toLowerCase().replace(/_/g, '-');
  return name.replace(/([a-z0-9])([A-Z])/g, '$1-$2').replace(/([A-Z])([A-Z][a-z])/g, '$1-$2').toLowerCase();
}
function singularize(word) {
  if (!word) return '';
  if (word.endsWith('ies')) return word.slice(0, -3) + 'y';
  if (word.endsWith('ses')) return word.slice(0, -2);
  if (word.endsWith('s') && !word.endsWith('ss')) return word.slice(0, -1);
  return word;
}
function deriveNames(tableName, packageSlug = '') {
  // Strip lc_ prefix for name generation — class/var names stay clean (e.g. StudentModule not LcStudentModule)
  const baseName           = tableName.startsWith('lc_') ? tableName.slice(3) : tableName;
  const fullTableName      = tableName.startsWith('lc_') ? tableName : `lc_${tableName}`;
  const kebabName          = toKebabCase(baseName);          // verify-e (without lc-)
  const kebabSingular      = toKebabCase(singularize(baseName));
  const lcKebabSingular    = `lc-${kebabSingular}`;          // lc-verify-e
  const pascalSingular     = toPascalCase(singularize(baseName)); // VerifyE
  const pascalName         = toPascalCase(baseName);          // VerifyE
  const slug               = packageSlug || 'default';
  const moduleDir          = `lc/${slug}/${lcKebabSingular}`;
  const srcRelPath         = '../../../../';
  const dtoSrcRelPath      = '../../../../../';
  const routePath          = `/lc/${kebabName}`;
  const pageDir            = `lc/${kebabName}`;
  const pageComponentPath  = `./lc/${kebabName}/index`;
  const pageMapComponentPath = `./lc/${kebabName}/map`;
  return { tableName: fullTableName, baseName, packageSlug: slug, kebabName, kebabSingular, lcKebabSingular, moduleDir, srcRelPath, dtoSrcRelPath, pascalSingular, pascalName, routePath, pageDir, pageComponentPath, pageMapComponentPath };
}

// ── file helpers ─────────────────────────────────────────────────────────────
async function rmForce(p) {
  try { await rm(p, { force: true }); } catch { /* ignore */ }
}
async function rmdirSafe(p) {
  try { await rmdir(p); } catch { /* not empty or missing */ }
}

async function editFile(filePath, replacer) {
  if (!fs.existsSync(filePath)) return;
  const before = await readFile(filePath, 'utf-8');
  const after = replacer(before);
  if (after !== before) await writeFile(filePath, after, 'utf-8');
}

// Walk a directory and apply a transform to every .ts / .tsx file
async function walkAndEdit(dir, replacer) {
  let entries;
  try { entries = await readdir(dir); } catch { return; }
  for (const entry of entries) {
    const full = path.join(dir, entry);
    let s;
    try { s = await stat(full); } catch { continue; }
    if (s.isDirectory()) {
      await walkAndEdit(full, replacer);
    } else if (entry.endsWith('.ts') || entry.endsWith('.tsx')) {
      await editFile(full, replacer);
    }
  }
}

// ── cleanup steps ─────────────────────────────────────────────────────────────
async function deleteGeneratedFiles(n) {
  const serverSrc = SERVER_SRC;
  const webSrc    = path.join(PROJECT_ROOT, 'release/jimo/apps/web/src');

  const files = [
    path.join(serverSrc, `db/schema/lc-${n.kebabName}.ts`),
    path.join(serverSrc, `modules/${n.moduleDir}/${n.lcKebabSingular}.service.ts`),
    path.join(serverSrc, `modules/${n.moduleDir}/${n.lcKebabSingular}.controller.ts`),
    path.join(serverSrc, `modules/${n.moduleDir}/${n.lcKebabSingular}.module.ts`),
    path.join(serverSrc, `modules/${n.moduleDir}/dto/create-${n.lcKebabSingular}.dto.ts`),
    path.join(serverSrc, `modules/${n.moduleDir}/dto/query-${n.lcKebabSingular}.dto.ts`),
    path.join(serverSrc, `modules/${n.moduleDir}/dto/update-${n.lcKebabSingular}.dto.ts`),
    path.join(serverSrc, `modules/${n.moduleDir}/agent/${n.lcKebabSingular}.agent.service.ts`),
    path.join(serverSrc, `modules/${n.moduleDir}/agent/${n.lcKebabSingular}.agent.module.ts`),
    path.join(serverSrc, `modules/${n.moduleDir}/${n.lcKebabSingular}.service.contract.spec.ts`),
    path.join(serverSrc, `modules/${n.moduleDir}/${n.lcKebabSingular}.http.contract.spec.ts`),
    path.join(webSrc, `services/lc/${n.kebabSingular}.ts`),
    path.join(webSrc, `pages/lc/${n.kebabName}/index.tsx`),
    path.join(webSrc, `pages/lc/${n.kebabName}/detail.tsx`),
    path.join(webSrc, `pages/lc/${n.kebabName}/map.tsx`),
  ];

  for (const f of files) await rmForce(f);

  const moduleDir = path.join(serverSrc, `modules/${n.moduleDir}`);
  try { await rm(path.join(moduleDir, 'dto'),   { recursive: true, force: true }); } catch { /* */ }
  try { await rm(path.join(moduleDir, 'agent'), { recursive: true, force: true }); } catch { /* */ }
  await rmdirSafe(moduleDir);
  await rmdirSafe(path.join(serverSrc, `modules/lc/${n.packageSlug}`));
  try { await rm(path.join(webSrc, `pages/lc/${n.kebabName}`), { recursive: true, force: true }); } catch { /* */ }
}

async function removeSchemaExport(n) {
  await editFile(SCHEMA_INDEX, content =>
    content.replace(new RegExp(`export \\* from '\\.\\/${n.kebabName}\\.js';\\n?`, 'g'), '')
           .replace(new RegExp(`export \\* from '\\.\\/${n.kebabName}';\\n?`, 'g'), '')
           .replace(new RegExp(`export \\* from '\\.\/lc-${n.kebabName}\\.js';\\n?`, 'g'), '')
           .replace(new RegExp(`export \\* from '\\.\/lc-${n.kebabName}';\\n?`, 'g'), '')
  );
}

async function removeDanglingImports(n) {
  const patterns = [
    new RegExp(`^import\\s+\\{[^}]*\\}\\s+from\\s+'\\.\\.?\\/(?:[\\w-]+\\/)*${n.kebabName}';\n?`, 'gm'),
    new RegExp(`^import\\s+\\{[^}]*\\}\\s+from\\s+'[^']*db\\/schema\\/${n.kebabName}';\n?`, 'gm'),
  ];
  await walkAndEdit(SERVER_SRC, content => {
    let out = content;
    for (const re of patterns) out = out.replace(re, '');
    return out;
  });
}

async function removeModuleRegistration(n) {
  if (!fs.existsSync(GENERATED_MODULE)) return;
  const escapedModuleDir = n.moduleDir.replace(/\//g, '\\/');
  await editFile(GENERATED_MODULE, content => {
    let out = content;
    // Remove main module import + array entry
    out = out.replace(
      new RegExp(`import \\{ ${n.pascalSingular}Module \\} from '\\./modules/${escapedModuleDir}/${n.lcKebabSingular}\\.module';\n?`, 'g'),
      ''
    );
    out = out.replace(new RegExp(`\n[ ]+${n.pascalSingular}Module,`, 'g'), '');
    // Remove agent module import + array entry
    out = out.replace(
      new RegExp(`import \\{ ${n.pascalSingular}AgentModule \\} from '\\./modules/${escapedModuleDir}/agent/${n.lcKebabSingular}\\.agent\\.module';\n?`, 'g'),
      ''
    );
    out = out.replace(new RegExp(`\n[ ]+${n.pascalSingular}AgentModule,`, 'g'), '');
    return out;
  });
}

function stripRouteBlock(content, routePath) {
  const escaped = routePath.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  return content.replace(
    new RegExp(`  \\{[^{}]*path:\\s*'${escaped}(?:/[^']*)?'[^{}]*\\},\\n?`, 'g'),
    '',
  );
}

async function removeUmiRoutes(n) {
  if (!fs.existsSync(GENERATED_ROUTES)) return;
  await editFile(GENERATED_ROUTES, content => {
    content = stripRouteBlock(content, n.routePath);
    content = stripRouteBlock(content, `${n.routePath}-map`);
    return content;
  });
}

// ── main processing ──────────────────────────────────────────────────────────
async function processJob(sql, job) {
  const { id, table_name, payload } = job;
  const cascade = payload?.cascade ?? false;
  // Resolve packageSlug: from payload (new jobs) or from history record (old jobs)
  let packageSlug = payload?.packageSlug || '';
  if (!packageSlug && payload?.historyId) {
    try {
      const rows = await sql`SELECT package_slug FROM sys_auto_code_histories WHERE id = ${payload.historyId} LIMIT 1`;
      packageSlug = rows[0]?.package_slug || '';
    } catch { /* ignore */ }
  }
  const n = deriveNames(table_name, packageSlug);
  const dbTableName = table_name.startsWith('lc_') ? table_name : `lc_${table_name}`;

  console.log(`[cleanup-worker] Processing job ${id} — table: ${table_name}`);

  // 1. Delete files
  await deleteGeneratedFiles(n);
  console.log(`[cleanup-worker]  ✓ deleted generated files`);

  // 2. Remove schema export from index.ts
  await removeSchemaExport(n);
  console.log(`[cleanup-worker]  ✓ removed schema export`);

  // 3. Remove dangling imports in other files
  await removeDanglingImports(n);
  console.log(`[cleanup-worker]  ✓ removed dangling imports`);

  // 4. Remove module from app.module.ts
  await removeModuleRegistration(n);
  console.log(`[cleanup-worker]  ✓ removed module registration`);

  // 5. Remove Umi routes
  await removeUmiRoutes(n);
  console.log(`[cleanup-worker]  ✓ removed umi routes`);

  // 6. Drop DB table (auto-detect FK dependents, always CASCADE if any exist)
  const tableExists = await sql`
    SELECT 1 FROM information_schema.tables
    WHERE table_schema = 'public' AND table_name = ${dbTableName}
    LIMIT 1
  `;
  if (tableExists.length > 0) {
    const fkDeps = await sql`
      SELECT tc.table_name AS referencing_table, kcu.column_name
      FROM information_schema.table_constraints tc
      JOIN information_schema.key_column_usage kcu
        ON tc.constraint_name = kcu.constraint_name AND tc.table_schema = kcu.table_schema
      JOIN information_schema.constraint_column_usage ccu
        ON ccu.constraint_name = tc.constraint_name AND ccu.table_schema = tc.table_schema
      WHERE tc.constraint_type = 'FOREIGN KEY'
        AND ccu.table_name = ${dbTableName}
        AND ccu.table_schema = 'public'
    `;
    const shouldCascade = cascade || fkDeps.length > 0;
    if (fkDeps.length > 0) {
      const deps = fkDeps.map(r => `${r.referencing_table}.${r.column_name}`).join(', ');
      console.log(`[cleanup-worker]  ⚠ FK dependents detected: ${deps} → using CASCADE`);
    }
    await sql.unsafe(`DROP TABLE IF EXISTS "${dbTableName}"${shouldCascade ? ' CASCADE' : ''}`);
    console.log(`[cleanup-worker]  ✓ dropped table ${dbTableName}${shouldCascade ? ' (CASCADE)' : ''}`);
  }

  // 7. Soft-delete menus
  const componentPath = `./${n.kebabName}/index`;
  const menuRows = await sql`
    SELECT id FROM sys_menus
    WHERE component = ${componentPath} AND deleted_at IS NULL
  `;
  if (menuRows.length > 0) {
    const pageMenuIds = menuRows.map(r => r.id);
    const btnChildren = await sql`
      SELECT id FROM sys_menus
      WHERE parent_id = ANY(${pageMenuIds}) AND menu_type = 3 AND deleted_at IS NULL
    `;
    const allMenuIds = [...pageMenuIds, ...btnChildren.map(r => r.id)];
    if (allMenuIds.length > 0) {
      await sql`DELETE FROM sys_authority_btns WHERE menu_id = ANY(${allMenuIds})`;
      await sql`DELETE FROM sys_role_menus WHERE menu_id = ANY(${allMenuIds})`;
      await sql`DELETE FROM sys_menus WHERE id = ANY(${allMenuIds})`;
    }

    // Also remove map menu if it exists
    const mapPath = `/lc/${n.kebabName}-map`;
    const mapMenus = await sql`
      SELECT id FROM sys_menus WHERE path = ${mapPath} AND deleted_at IS NULL
    `;
    if (mapMenus.length > 0) {
      const mapIds = mapMenus.map(r => r.id);
      await sql`DELETE FROM sys_role_menus WHERE menu_id = ANY(${mapIds})`;
      await sql`DELETE FROM sys_menus WHERE id = ANY(${mapIds})`;
    }
    console.log(`[cleanup-worker]  ✓ removed menus`);
  }

  // 8. Soft-delete sys_apis
  const apiGroup = `lc/${n.kebabName}`;
  await sql`
    UPDATE sys_apis SET deleted_at = NOW()
    WHERE api_group = ${apiGroup} AND deleted_at IS NULL
  `;
  console.log(`[cleanup-worker]  ✓ cleaned sys_apis`);

  // 9. Delete history record
  await sql`
    DELETE FROM sys_auto_code_histories WHERE table_name = ${table_name}
  `;
  console.log(`[cleanup-worker]  ✓ deleted history records`);
}

// ── job file helpers (mirrors NestJS writeJobStatus) ─────────────────────────
const DELETE_STEPS = [
  { key: 'files',        label: '正在删除文件...' },
  { key: 'route',        label: '正在移除路由...' },
  { key: 'schema-export',label: '正在移除 Schema 导出...' },
  { key: 'module-reg',   label: '正在移除模块注册...' },
  { key: 'menus',        label: '正在删除菜单...' },
  { key: 'drop-table',   label: '正在删除数据库表...' },
  { key: 'history',      label: '正在清理历史记录...' },
];

async function writeJobFile(jobsDir, jobId, status, currentLabel, extraSteps, error, result) {
  try {
    await fs.promises.mkdir(jobsDir, { recursive: true });
    const steps = (extraSteps || DELETE_STEPS).map(s => ({
      key: s.key,
      label: s.label,
      status: s.stepStatus || 'pending',
    }));
    const payload = {
      jobId,
      status,
      steps,
      progress: status === 'completed' ? 100 : status === 'failed' ? 0 : 50,
      currentStepLabel: currentLabel,
      completedAt: status === 'completed' ? new Date().toISOString() : undefined,
      error: error || undefined,
      result: result || undefined,
    };
    await fs.promises.writeFile(
      path.join(jobsDir, `${jobId}.json`),
      JSON.stringify(payload, null, 2),
      'utf-8',
    );
  } catch { /* best-effort */ }
}

// ── entrypoints job handler ───────────────────────────────────────────────────

const ENTRYPOINTS_STEPS = [
  { key: 'schema-index', label: '正在更新 Schema 索引...' },
  { key: 'app-module',   label: '正在注册模块...' },
  { key: 'umi-routes',   label: '正在更新路由...' },
];

function extractMenuName(description, fallback) {
  if (!description) return fallback;
  const paren = description.indexOf('（');
  if (paren > 0) return description.slice(0, paren).trim();
  const parenAscii = description.indexOf('(');
  if (parenAscii > 0) return description.slice(0, parenAscii).trim();
  return description;
}

async function processEntrypointsJob(sql, job, jobsDir) {
  const p = job.payload || {};
  const nestJobId = p.jobId;
  // p.packageSlug may be null (old job payload before fix) — extract from createdFiles as fallback
  // createdFiles[0] is typically the schema file at db/schema/lc-name.ts
  // createdFiles[1] is a module file at modules/lc/<slug>/lc-<singular>/...
  let packageSlug = p.packageSlug || '';
  if (!packageSlug && Array.isArray(p.createdFiles)) {
    // Find a module file path and extract the slug from it: modules/lc/<slug>/...
    const modFile = p.createdFiles.find(f => f.includes('/modules/lc/'));
    if (modFile) {
      const match = modFile.match(/\/modules\/lc\/([^/]+)\//);
      if (match) packageSlug = match[1];
    }
  }
  const n = deriveNames(p.tableName, packageSlug);

  const stepsState = ENTRYPOINTS_STEPS.map(s => ({ ...s, stepStatus: 'pending' }));
  const writeProgress = async (stepIdx, label) => {
    stepsState.forEach((s, i) => {
      s.stepStatus = i < stepIdx ? 'completed' : i === stepIdx ? 'running' : 'pending';
    });
    if (nestJobId) await writeJobFile(jobsDir, nestJobId, 'processing', label, stepsState, null);
  };

  // 1. updateSchemaIndex
  await writeProgress(0, ENTRYPOINTS_STEPS[0].label);
  await editFile(SCHEMA_INDEX, content => {
    const exportLine = `export * from './lc-${n.kebabName}.js';`;
    if (content.includes(exportLine)) return content;
    return content.trimEnd() + '\n' + exportLine + '\n';
  });
  console.log(`[cleanup-worker] entrypoints: schema-index updated for '${p.tableName}'`);

  // 2. updateGeneratedModule
  await writeProgress(1, ENTRYPOINTS_STEPS[1].label);
  // Bootstrap generated.module.ts if it doesn't exist yet
  if (!fs.existsSync(GENERATED_MODULE)) {
    await writeFile(GENERATED_MODULE,
      `import { Module } from '@nestjs/common';\n\n@Module({\n  imports: [\n  ],\n})\nexport class GeneratedModule {}\n`,
      'utf-8',
    );
  }
  await editFile(GENERATED_MODULE, content => {
    const importLine = `import { ${n.pascalSingular}Module } from './modules/${n.moduleDir}/${n.lcKebabSingular}.module';`;
    if (!content.includes(importLine)) {
      content = content.replace(`import { Module }`, `${importLine}\nimport { Module }`);
      content = content.replace(`imports: [\n  `, `imports: [\n    ${n.pascalSingular}Module,\n  `);
    }
    if (p.agentEnabled) {
      const agentImportLine = `import { ${n.pascalSingular}AgentModule } from './modules/${n.moduleDir}/agent/${n.lcKebabSingular}.agent.module';`;
      if (!content.includes(agentImportLine)) {
        content = content.replace(`import { Module }`, `${agentImportLine}\nimport { Module }`);
        content = content.replace(
          `    ${n.pascalSingular}Module,`,
          `    ${n.pascalSingular}Module,\n    ${n.pascalSingular}AgentModule,`,
        );
      }
    }
    return content;
  });
  console.log(`[cleanup-worker] entrypoints: generated.module.ts updated for '${p.tableName}'`);

  // 3. updateUmiRoutes + updateUmiRoutesMap
  await writeProgress(2, ENTRYPOINTS_STEPS[2].label);
  if (p.generateWeb !== false) {
    const menuName = extractMenuName(p.description, n.pascalName);
    // Bootstrap generated-routes.ts if missing
    if (!fs.existsSync(GENERATED_ROUTES)) {
      await writeFile(GENERATED_ROUTES,
        `import type { IRoute } from '@umijs/max';\n\nexport const generatedRoutes: IRoute[] = [\n];\n`,
        'utf-8',
      );
    }
    await editFile(GENERATED_ROUTES, content => {
      // Strip existing entries for this table (idempotent)
      content = stripRouteBlock(content, n.routePath);
      let entries;
      if (p.pageType === 'document') {
        entries =
          `  { path: '${n.routePath}', name: '${menuName}', icon: 'TableOutlined', component: '${n.pageComponentPath}' },\n` +
          `  { path: '${n.routePath}/create', component: './${n.pageDir}/detail', layout: false },\n` +
          `  { path: '${n.routePath}/:id', component: './${n.pageDir}/detail', layout: false },\n`;
      } else {
        entries =
          `  { path: '${n.routePath}', name: '${menuName}', icon: 'TableOutlined', component: '${n.pageComponentPath}' },\n`;
      }
      return content.replace(`];\n`, `${entries}];\n`);
    });

    if (p.hasPointFields) {
      const mapPath = `${n.routePath}-map`;
      await editFile(GENERATED_ROUTES, content => {
        content = stripRouteBlock(content, mapPath);
        const entry = `  { path: '${mapPath}', name: '${menuName}地图', icon: 'EnvironmentOutlined', component: '${n.pageMapComponentPath}' },\n`;
        return content.replace(`];\n`, `${entry}];\n`);
      });
    }
  }
  console.log(`[cleanup-worker] entrypoints: routes updated for '${p.tableName}'`);
}

// ── poll loop ─────────────────────────────────────────────────────────────────
async function main() {
  // Load .env
  const envPath = path.join(PROJECT_ROOT, 'release/jimo/.env');
  if (fs.existsSync(envPath)) {
    const lines = fs.readFileSync(envPath, 'utf-8').split('\n');
    for (const line of lines) {
      const m = line.match(/^([^#=]+)=(.*)$/);
      if (m) process.env[m[1].trim()] = m[2].trim().replace(/^["']|["']$/g, '');
    }
  }

  const dbUrl = process.env.DATABASE_URL;
  if (!dbUrl) { console.error('[cleanup-worker] DATABASE_URL not set'); process.exit(1); }

  const sql = postgres(dbUrl, { max: 2 });

  console.log(`[cleanup-worker] Started. PROJECT_ROOT=${PROJECT_ROOT}`);
  console.log(`[cleanup-worker] Polling sys_cleanup_jobs every 2s...`);

  const POLL_INTERVAL = 2000;
  const jobsDir = path.join(PROJECT_ROOT, '.tmp/generate-jobs');

  const poll = async () => {
    let job;
    try {
      // Claim one pending job atomically
      const rows = await sql`
        UPDATE sys_cleanup_jobs
        SET status = 'running', started_at = NOW()
        WHERE id = (
          SELECT id FROM sys_cleanup_jobs
          WHERE status = 'pending'
          ORDER BY created_at ASC
          LIMIT 1
          FOR UPDATE SKIP LOCKED
        )
        RETURNING *
      `;
      job = rows[0];
    } catch (e) {
      console.error('[cleanup-worker] Poll error:', e.message);
      setTimeout(poll, POLL_INTERVAL);
      return;
    }

    if (!job) {
      setTimeout(poll, POLL_INTERVAL);
      return;
    }

    // jobId is stored in payload by NestJS service
    const nestJobId = job.payload?.jobId;

    const jobType = job.job_type ?? 'cleanup';

    try {
      if (jobType === 'entrypoints') {
        await processEntrypointsJob(sql, job, jobsDir);
      } else {
        if (nestJobId) {
          await writeJobFile(jobsDir, nestJobId, 'processing', '正在执行清理...', null, null);
        }
        await processJob(sql, job);
      }

      await sql`
        UPDATE sys_cleanup_jobs
        SET status = 'done', finished_at = NOW(),
            result = ${{ completedAt: new Date().toISOString() }}::jsonb
        WHERE id = ${job.id}
      `;

      if (nestJobId) {
        const completedSteps = jobType === 'entrypoints'
          ? ENTRYPOINTS_STEPS.map(s => ({ ...s, stepStatus: 'completed' }))
          : DELETE_STEPS.map(s => ({ ...s, stepStatus: 'completed' }));
        const doneLabel = jobType === 'entrypoints' ? '入口文件更新完成 ✓' : '清理完成 ✓';
        const jobResult = jobType === 'entrypoints' && job.payload?.createdFiles
          ? { createdFiles: job.payload.createdFiles }
          : undefined;
        await writeJobFile(jobsDir, nestJobId, 'completed', doneLabel, completedSteps, null, jobResult);
        // Auto-delete job file after 5 min
        setTimeout(() => {
          fs.promises.unlink(path.join(jobsDir, `${nestJobId}.json`)).catch(() => {});
        }, 5 * 60 * 1000);
      }

      console.log(`[cleanup-worker] ✅ Job ${job.id} (${jobType}) done (nestJobId=${nestJobId})`);
    } catch (e) {
      console.error(`[cleanup-worker] ❌ Job ${job.id} (${jobType}) failed:`, e.message);
      await sql`
        UPDATE sys_cleanup_jobs
        SET status = 'failed', finished_at = NOW(), error = ${e.message}
        WHERE id = ${job.id}
      `;
      if (nestJobId) {
        const failLabel = jobType === 'entrypoints' ? `入口文件更新失败: ${e.message}` : `清理失败: ${e.message}`;
        await writeJobFile(jobsDir, nestJobId, 'failed', failLabel, null, e.message);
      }
    }

    // Continue polling immediately after finishing a job
    setTimeout(poll, 200);
  };

  poll();

  // Keep process alive
  process.on('SIGINT', async () => {
    console.log('[cleanup-worker] Shutting down...');
    await sql.end();
    process.exit(0);
  });
}

main().catch(e => { console.error(e); process.exit(1); });
