import { Inject, Injectable, Logger } from '@nestjs/common';
import { promises as fs, existsSync } from 'node:fs';
import * as path from 'node:path';
import { sql } from 'drizzle-orm';
import { DATABASE_CONNECTION, DrizzleDb } from '../../db/connection';
import { resolveProjectRoot } from './autocode.utils';
import { AutoCodeDto } from './dto/autocode.dto';
import { deriveNames, type DerivedNames } from './autocode-field-utils';
import { stripTableRouteBlocks } from './route-lifecycle';

/** Extracted from the old autocode-field-utils / autocode.service — see those files. */
function extractMenuName(description: string | undefined, fallback: string): string {
  if (!description) return fallback;
  const paren = description.indexOf('（');
  if (paren > 0) return description.slice(0, paren).trim();
  const parenAscii = description.indexOf('(');
  if (parenAscii > 0) return description.slice(0, parenAscii).trim();
  return description;
}

@Injectable()
export class EntrypointService {
  private readonly logger = new Logger(EntrypointService.name);

  constructor(
    @Inject(DATABASE_CONNECTION) private readonly db: DrizzleDb,
  ) {}

  // =========================================================================
  // Entry point updaters (add)
  // =========================================================================

  async updateSchemaIndex(dto: AutoCodeDto, projectRoot: string): Promise<void> {
    const n = deriveNames(dto.tableName);
    const indexPath = path.join(projectRoot, 'release/jimo/apps/server/src/db/schema/index.ts');
    const exportLine = `export * from './${n.kebabName}.js';`;

    let content = await fs.readFile(indexPath, 'utf-8');
    if (content.includes(exportLine)) return;

    content = content.trimEnd() + '\n' + exportLine + '\n';
    await fs.writeFile(indexPath, content, 'utf-8');
  }

  async updateAppModule(dto: AutoCodeDto, projectRoot: string): Promise<void> {
    const n = deriveNames(dto.tableName);
    const modulePath = path.join(projectRoot, 'release/jimo/apps/server/src/app.module.ts');

    let content = await fs.readFile(modulePath, 'utf-8');

    const importLine = `import { ${n.pascalSingular}Module } from './modules/${n.kebabSingular}/${n.kebabSingular}.module';`;
    const moduleLine = `    ${n.pascalSingular}Module,`;

    if (!content.includes(importLine)) {
      const lastImportMatch = content.match(/^import .+;$/gm);
      if (lastImportMatch && lastImportMatch.length > 0) {
        const lastImport = lastImportMatch[lastImportMatch.length - 1]!;
        content = content.replace(lastImport, `${lastImport}\n${importLine}`);
      }

      content = content.replace(
        /(\s+)(OperationRecordModule,)/,
        `$1$2\n${moduleLine}`,
      );
    }

    // Register agent module when enabled
    if (dto.agentConfig?.enabled) {
      const agentImportLine = `import { ${n.pascalSingular}AgentModule } from './modules/${n.kebabSingular}/agent/${n.kebabSingular}.agent.module';`;
      const agentModuleLine = `    ${n.pascalSingular}AgentModule,`;

      if (!content.includes(agentImportLine)) {
        const lastImportMatch2 = content.match(/^import .+;$/gm);
        if (lastImportMatch2 && lastImportMatch2.length > 0) {
          const lastImport2 = lastImportMatch2[lastImportMatch2.length - 1]!;
          content = content.replace(lastImport2, `${lastImport2}\n${agentImportLine}`);
        }

        const mainModuleLineEsc = moduleLine.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
        content = content.replace(
          new RegExp(`(\\s+)(${mainModuleLineEsc})`),
          `$1$2\n${agentModuleLine}`,
        );
      }
    }

    await fs.writeFile(modulePath, content, 'utf-8');
  }

  async updateUmiRoutes(dto: AutoCodeDto, projectRoot: string): Promise<void> {
    const n = deriveNames(dto.tableName);
    const umircPath = path.join(projectRoot, 'release/jimo/apps/web/.umirc.ts');
    let content = await fs.readFile(umircPath, 'utf-8');

    const routePath = n.routePath;
    // Strip every previously-generated route for this table (main + detail +
    // map) before re-adding, so regenerating a document module no longer
    // accumulates duplicate detail routes. See stripTableRouteBlocks().
    content = stripTableRouteBlocks(content, n.pageDir);

    let routeEntry: string;
    if (dto.pageType === 'document') {
      routeEntry = `    {
      path: '${routePath}',
      name: '${extractMenuName(dto.description, n.pascalName)}',
      icon: 'TableOutlined',
      component: '${n.pageComponentPath}',
    },
    {
      path: '${routePath}/create',
      component: './${n.pageDir}/detail',
      layout: false,
    },
    {
      path: '${routePath}/:id',
      component: './${n.pageDir}/detail',
      layout: false,
    },`;
    } else {
      routeEntry = `    {
      path: '${routePath}',
      name: '${extractMenuName(dto.description, n.pascalName)}',
      icon: 'TableOutlined',
      component: '${n.pageComponentPath}',
    },`;
    }

    content = content.replace(
      /    \{ path: '\/\*', redirect: '\/dashboard' \},?/,
      `${routeEntry}\n    { path: '/*', redirect: '/dashboard' },`,
    );

    await fs.writeFile(umircPath, content, 'utf-8');
  }

  async updateUmiRoutesMap(dto: AutoCodeDto, projectRoot: string): Promise<void> {
    const n = deriveNames(dto.tableName);
    const mapRoutePath = `${n.routePath}-map`;
    const umircPath = path.join(projectRoot, 'release/jimo/apps/web/.umirc.ts');
    let content = await fs.readFile(umircPath, 'utf-8');

    const escapedPath = mapRoutePath.replace(/\//g, '\\/');
    const existingBlock = new RegExp(
      `\\s*\\{[^{}]*path:\\s*'${escapedPath}'[^{}]*\\},?`,
      'gs',
    );
    content = content.replace(existingBlock, '');

    const routeEntry = `    {
      path: '${mapRoutePath}',
      name: '${extractMenuName(dto.description, n.pascalName)}地图',
      icon: 'EnvironmentOutlined',
      component: '${n.pageMapComponentPath}',
    },`;
    content = content.replace(
      /    \{ path: '\/\*', redirect: '\/dashboard' \},?/,
      `${routeEntry}\n    { path: '/*', redirect: '/dashboard' },`,
    );
    await fs.writeFile(umircPath, content, 'utf-8');
  }

  // =========================================================================
  // Delete helpers
  // =========================================================================

  async removeRouteFromUmirc(n: DerivedNames): Promise<void> {
    const projectRoot = resolveProjectRoot();
    const umircPath = path.join(projectRoot, 'release/jimo/apps/web/.umirc.ts');
    if (!existsSync(umircPath)) return;

    let content = await fs.readFile(umircPath, 'utf-8');
    // Remove every route block whose component points into this table's page
    // directory (index / detail / map / the standalone "-map" route), for any
    // pageType. Also clears duplicate detail routes left by older
    // regenerations that only stripped the main route.
    content = stripTableRouteBlocks(content, n.pageDir);

    content = content.replace(
      /    \{\n      path: '\/pkg\/[^']+',\n      name: '[^']+',\n      icon: '[^']+',\n      routes: \[\s*\],\n    \},\n?/g,
      '',
    );

    await fs.writeFile(umircPath, content, 'utf-8');
  }

  async removeSchemaExport(n: DerivedNames): Promise<void> {
    const projectRoot = resolveProjectRoot();
    const indexPath = path.join(projectRoot, 'release/jimo/apps/server/src/db/schema/index.ts');
    if (!existsSync(indexPath)) return;

    let content = await fs.readFile(indexPath, 'utf-8');

    const exportPattern = new RegExp(
      `export \\* from '\\.\\/${n.kebabName}\\.js';\\n?`,
    );
    content = content.replace(exportPattern, '');

    await fs.writeFile(indexPath, content, 'utf-8');
  }

  /**
   * After deleting a schema file, scan all remaining .ts files under
   * apps/server/src and remove any import lines that reference the deleted
   * module. Prevents TS compilation failures.
   */
  async removeDanglingSchemaImports(n: DerivedNames): Promise<void> {
    const projectRoot = resolveProjectRoot();
    const serverSrc = path.join(projectRoot, 'release/jimo/apps/server/src');
    if (!existsSync(serverSrc)) return;

    const patterns = [
      new RegExp(`^import\\s+\\{[^}]*\\}\\s+from\\s+'\\.\\.?\\/(?:[\\w-]+\\/)*${n.kebabName}';\n?`, 'gm'),
      new RegExp(`^import\\s+\\{[^}]*\\}\\s+from\\s+'[^']*db\\/schema\\/${n.kebabName}';\n?`, 'gm'),
    ];

    const walk = async (dir: string): Promise<void> => {
      let entries: string[];
      try { entries = await fs.readdir(dir); } catch { return; }
      for (const entry of entries) {
        const full = path.join(dir, entry);
        let stat: any;
        try { stat = await fs.stat(full); } catch { continue; }
        if (stat.isDirectory()) {
          await walk(full);
        } else if (entry.endsWith('.ts') || entry.endsWith('.tsx')) {
          let content: string;
          try { content = await fs.readFile(full, 'utf-8'); } catch { continue; }
          let changed = content;
          for (const re of patterns) { changed = changed.replace(re, ''); }
          if (changed !== content) {
            await fs.writeFile(full, changed, 'utf-8');
          }
        }
      }
    };

    await walk(serverSrc);
  }

  async removeModuleRegistration(n: DerivedNames): Promise<void> {
    const projectRoot = resolveProjectRoot();
    const modulePath = path.join(projectRoot, 'release/jimo/apps/server/src/app.module.ts');
    if (!existsSync(modulePath)) return;

    let content = await fs.readFile(modulePath, 'utf-8');

    const importPattern = new RegExp(
      `import \\{ ${n.pascalSingular}Module \\} from '\\./modules/${n.kebabSingular}/${n.kebabSingular}\\.module';\\n?`,
    );
    content = content.replace(importPattern, '');

    const moduleArrayPattern = new RegExp(
      `\\n[ ]+${n.pascalSingular}Module,`,
    );
    content = content.replace(moduleArrayPattern, '');

    // Also remove agent module registration if present
    const agentImportPattern = new RegExp(
      `import \\{ ${n.pascalSingular}AgentModule \\} from '\\./modules/${n.kebabSingular}/agent/${n.kebabSingular}\\.agent\\.module';\\n?`,
    );
    content = content.replace(agentImportPattern, '');

    const agentModulePattern = new RegExp(
      `\\n[ ]+${n.pascalSingular}AgentModule,`,
    );
    content = content.replace(agentModulePattern, '');

    await fs.writeFile(modulePath, content, 'utf-8');
  }

  // =========================================================================
  // Cleanup worker enqueue
  // =========================================================================

  /**
   * Enqueue entry-point file modifications to the cleanup-worker process.
   */
  async enqueueEntrypointJob(
    jobId: string,
    dto: AutoCodeDto,
    hasPointFields: boolean,
    createdFiles: string[] = [],
  ): Promise<void> {
    // Cancel any stale cleanup jobs for this table name.
    try {
      await this.db.execute(sql`
        UPDATE sys_cleanup_jobs
        SET status = 'failed', finished_at = NOW(), error = 'Superseded by regenerate'
        WHERE table_name = ${dto.tableName}
          AND job_type = 'cleanup'
          AND status IN ('pending', 'running')
      `);
    } catch { /* best-effort */ }

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

    await this.db.execute(sql`
      INSERT INTO sys_cleanup_jobs (id, table_name, status, job_type, payload)
      VALUES (
        gen_random_uuid(),
        ${dto.tableName},
        'pending',
        'entrypoints',
        ${JSON.stringify(payload)}::jsonb
      )
    `);

    this.logger.log(`[EntrypointService] Enqueued entrypoints job for '${dto.tableName}' (jobId=${jobId})`);
  }
}
