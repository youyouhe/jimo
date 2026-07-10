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
    const n = deriveNames(dto.tableName, (dto as any)._packageSlug ?? '');
    const indexPath = path.join(projectRoot, 'apps/server/src/db/schema/index.ts');
    const exportLine = `export * from './lc-${n.kebabName}.js';`;

    let content = await fs.readFile(indexPath, 'utf-8');
    if (content.includes(exportLine)) return;

    content = content.trimEnd() + '\n' + exportLine + '\n';
    await fs.writeFile(indexPath, content, 'utf-8');
  }

  async updateAppModule(dto: AutoCodeDto, projectRoot: string): Promise<void> {
    const n = deriveNames(dto.tableName, (dto as any)._packageSlug ?? '');
    const generatedPath = path.join(projectRoot, 'apps/server/src/generated.module.ts');

    // Ensure the file exists (idempotent bootstrap)
    if (!existsSync(generatedPath)) {
      await fs.writeFile(generatedPath,
        `import { Module } from '@nestjs/common';\n\n@Module({\n  imports: [\n  ],\n})\nexport class GeneratedModule {}\n`,
        'utf-8',
      );
    }

    let content = await fs.readFile(generatedPath, 'utf-8');

    // Inject main module
    const importLine = `import { ${n.pascalSingular}Module } from './modules/${n.moduleDir}/${n.lcKebabSingular}.module';`;
    if (!content.includes(importLine)) {
      content = content.replace(`import { Module }`, `${importLine}\nimport { Module }`);
      content = content.replace(`imports: [\n  `, `imports: [\n    ${n.pascalSingular}Module,\n  `);
    }

    // Inject agent module when enabled
    if (dto.agentConfig?.enabled) {
      const agentImportLine = `import { ${n.pascalSingular}AgentModule } from './modules/${n.moduleDir}/agent/${n.lcKebabSingular}.agent.module';`;
      if (!content.includes(agentImportLine)) {
        content = content.replace(`import { Module }`, `${agentImportLine}\nimport { Module }`);
        content = content.replace(
          `    ${n.pascalSingular}Module,`,
          `    ${n.pascalSingular}Module,\n    ${n.pascalSingular}AgentModule,`,
        );
      }
    }

    await fs.writeFile(generatedPath, content, 'utf-8');
  }

  async updateUmiRoutes(dto: AutoCodeDto, projectRoot: string): Promise<void> {
    const n = deriveNames(dto.tableName, (dto as any)._packageSlug ?? '');
    const generatedRoutesPath = path.join(projectRoot, 'apps/web/src/generated-routes.ts');

    if (!existsSync(generatedRoutesPath)) {
      await fs.writeFile(generatedRoutesPath,
        `import type { IRoute } from '@umijs/max';\n\nexport const generatedRoutes: IRoute[] = [\n];\n`,
        'utf-8',
      );
    }

    let content = await fs.readFile(generatedRoutesPath, 'utf-8');

    // Strip any existing entries for this table before re-adding (idempotent on re-generate)
    content = this._stripGeneratedRouteBlock(content, n.routePath);

    const menuName = extractMenuName(dto.description, n.pascalName);
    let entries: string;
    if (dto.pageType === 'document') {
      entries =
        `  { path: '${n.routePath}', name: '${menuName}', icon: 'TableOutlined', component: '${n.pageComponentPath}' },\n` +
        `  { path: '${n.routePath}/create', component: './${n.pageDir}/detail', layout: false },\n` +
        `  { path: '${n.routePath}/:id', component: './${n.pageDir}/detail', layout: false },\n`;
    } else {
      entries =
        `  { path: '${n.routePath}', name: '${menuName}', icon: 'TableOutlined', component: '${n.pageComponentPath}' },\n`;
    }

    content = content.replace(`];\n`, `${entries}];\n`);
    await fs.writeFile(generatedRoutesPath, content, 'utf-8');
  }

  async updateUmiRoutesMap(dto: AutoCodeDto, projectRoot: string): Promise<void> {
    const n = deriveNames(dto.tableName, (dto as any)._packageSlug ?? '');
    const generatedRoutesPath = path.join(projectRoot, 'apps/web/src/generated-routes.ts');

    if (!existsSync(generatedRoutesPath)) return;

    let content = await fs.readFile(generatedRoutesPath, 'utf-8');
    const mapPath = `${n.routePath}-map`;

    // Remove existing map route if present
    content = this._stripGeneratedRouteBlock(content, mapPath);

    const entry =
      `  { path: '${mapPath}', name: '${extractMenuName(dto.description, n.pascalName)}地图', icon: 'EnvironmentOutlined', component: '${n.pageMapComponentPath}' },\n`;
    content = content.replace(`];\n`, `${entry}];\n`);
    await fs.writeFile(generatedRoutesPath, content, 'utf-8');
  }

  /** Remove all route entries whose path starts with the given routePath prefix. */
  private _stripGeneratedRouteBlock(content: string, routePath: string): string {
    const escaped = routePath.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    // Match full object literals: { path: '/lc/foo', ... },
    return content.replace(
      new RegExp(`  \\{[^{}]*path:\\s*'${escaped}(?:/[^']*)?'[^{}]*\\},\\n?`, 'g'),
      '',
    );
  }

  // =========================================================================
  // Delete helpers
  // =========================================================================

  async removeRouteFromUmirc(n: DerivedNames): Promise<void> {
    const projectRoot = resolveProjectRoot();
    const generatedRoutesPath = path.join(projectRoot, 'apps/web/src/generated-routes.ts');
    if (!existsSync(generatedRoutesPath)) return;

    let content = await fs.readFile(generatedRoutesPath, 'utf-8');
    content = this._stripGeneratedRouteBlock(content, n.routePath);
    content = this._stripGeneratedRouteBlock(content, `${n.routePath}-map`);
    await fs.writeFile(generatedRoutesPath, content, 'utf-8');
  }

  async removeSchemaExport(n: DerivedNames): Promise<void> {
    const projectRoot = resolveProjectRoot();
    const indexPath = path.join(projectRoot, 'apps/server/src/db/schema/index.ts');
    if (!existsSync(indexPath)) return;

    let content = await fs.readFile(indexPath, 'utf-8');

    const exportPattern = new RegExp(
      `export \\* from '\\.\\\/lc-${n.kebabName}\\.js';\\n?`,
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
    const serverSrc = path.join(projectRoot, 'apps/server/src');
    if (!existsSync(serverSrc)) return;

    const patterns = [
      new RegExp(`^import\\s+\\{[^}]*\\}\\s+from\\s+'\\.\\.?\\/(?:[\\w-]+\\/)*lc-${n.kebabName}';\n?`, 'gm'),
      new RegExp(`^import\\s+\\{[^}]*\\}\\s+from\\s+'[^']*db\\/schema\\/lc-${n.kebabName}';\n?`, 'gm'),
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
    const generatedPath = path.join(projectRoot, 'apps/server/src/generated.module.ts');
    if (!existsSync(generatedPath)) return;

    let content = await fs.readFile(generatedPath, 'utf-8');

    // Remove main module import + array entry
    content = content.replace(
      new RegExp(`import \\{ ${n.pascalSingular}Module \\} from '\\./modules/${n.moduleDir.replace(/\//g, '\\/')}/${n.lcKebabSingular}\\.module';\\n?`),
      '',
    );
    content = content.replace(new RegExp(`\\n[ ]+${n.pascalSingular}Module,`), '');

    // Remove agent module import + array entry
    content = content.replace(
      new RegExp(`import \\{ ${n.pascalSingular}AgentModule \\} from '\\./modules/${n.moduleDir.replace(/\//g, '\\/')}\/agent\\/${n.lcKebabSingular}\\.agent\\.module';\\n?`),
      '',
    );
    content = content.replace(new RegExp(`\\n[ ]+${n.pascalSingular}AgentModule,`), '');

    await fs.writeFile(generatedPath, content, 'utf-8');
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

    const n = deriveNames(dto.tableName, (dto as any)._packageSlug ?? '');
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
      lcKebabSingular: n.lcKebabSingular,
      moduleDir: n.moduleDir,
      packageSlug: n.packageSlug,
      packageId: dto.packageId,
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
