import { Inject, Injectable, Logger, NotFoundException } from '@nestjs/common';
import { randomUUID } from 'node:crypto';
import { promises as fs, existsSync } from 'node:fs';
import * as path from 'node:path';
import { eq, and, isNull, desc, sql, count, inArray } from 'drizzle-orm';
import { DATABASE_CONNECTION, DrizzleDb } from '../../db/connection';
import { CASBIN_SERVICE_TOKEN, ICasbinService } from '../role/role.service';
import {
  sysAutoCodeHistories,
  type SysAutoCodeHistory,
} from '../../db/schema/auto-code-histories';
import { sysMenus } from '../../db/schema/menus';
import { sysRoleMenus } from '../../db/schema/role-menus';
import { sysAuthorityBtns } from '../../db/schema/authority-btns';
import { sysApis } from '../../db/schema/apis';
import { AutoCodeDto, AutoCodeField } from './dto/autocode.dto';
import { deriveNames, type DerivedNames } from './autocode-field-utils';
import { EntrypointService } from './entrypoint.service';
import { resolveProjectRoot } from './autocode.utils';
import { isReservedTableName } from './reserved-names';

@Injectable()
export class HistoryService {
  private readonly logger = new Logger(HistoryService.name);

  // Step definitions
  static readonly DELETE_STEPS = [
    { key: 'files', label: '正在删除文件...' },
    { key: 'route', label: '正在移除路由...' },
    { key: 'schema-export', label: '正在移除 Schema 导出...' },
    { key: 'module-reg', label: '正在移除模块注册...' },
    { key: 'menus', label: '正在删除菜单...' },
    { key: 'drop-table', label: '正在删除数据库表...' },
    { key: 'history', label: '正在清理历史记录...' },
  ] as const;

  constructor(
    @Inject(DATABASE_CONNECTION) private readonly db: DrizzleDb,
    @Inject(CASBIN_SERVICE_TOKEN) private readonly casbin: ICasbinService,
    private readonly entrypointService: EntrypointService,
  ) {}

  // =========================================================================
  // History CRUD
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
    const projectRoot = resolveProjectRoot();
    const restoredFiles: string[] = [];

    for (const [relativePath, content] of Object.entries(templates)) {
      const absolutePath = path.join(projectRoot, relativePath);
      const dir = path.dirname(absolutePath);
      await fs.mkdir(dir, { recursive: true });
      await fs.writeFile(absolutePath, content, 'utf-8');
      restoredFiles.push(relativePath);
    }

    try {
      const latest = await this.getLatestVersion(history.tableName!);
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
        visibilityStrategy: history.visibilityStrategy ?? 'private',
        hasApprovalFlow: history.hasApprovalFlow ?? false,
        hasAgent: history.hasAgent ?? false,
      });
    } catch (historyErr: unknown) {
      this.logger.error('[HistoryService] Failed to save rollback history:', historyErr);
    }

    return { restoredFiles };
  }

  async deleteHistory(id: string): Promise<{ deletedFiles: string[]; droppedTable: boolean; removedMenus: number }> {
    const history = await this.findOneHistory(id);
    const tableName = history.tableName!;
    this.ensureNotReservedTable(tableName);
    const n = deriveNames(tableName);
    const projectRoot = resolveProjectRoot();

    const deletedFiles: string[] = [];
    let droppedTable = false;
    let removedMenus = 0;

    const expectedPaths = [
      `release/jimo/apps/server/src/db/schema/${n.kebabName}.ts`,
      `release/jimo/apps/server/src/modules/${n.kebabSingular}/${n.kebabSingular}.service.ts`,
      `release/jimo/apps/server/src/modules/${n.kebabSingular}/${n.kebabSingular}.controller.ts`,
      `release/jimo/apps/server/src/modules/${n.kebabSingular}/${n.kebabSingular}.module.ts`,
      `release/jimo/apps/server/src/modules/${n.kebabSingular}/dto/create-${n.kebabSingular}.dto.ts`,
      `release/jimo/apps/server/src/modules/${n.kebabSingular}/dto/query-${n.kebabSingular}.dto.ts`,
      `release/jimo/apps/server/src/modules/${n.kebabSingular}/dto/update-${n.kebabSingular}.dto.ts`,
      `release/jimo/apps/server/src/modules/${n.kebabSingular}/agent/${n.kebabSingular}.agent.service.ts`,
      `release/jimo/apps/server/src/modules/${n.kebabSingular}/agent/${n.kebabSingular}.agent.module.ts`,
      `release/jimo/apps/web/src/services/${n.serviceRelDir}.ts`,
      `release/jimo/apps/web/src/pages/${n.pageDir}/index.tsx`,
      `release/jimo/apps/web/src/pages/${n.pageDir}/detail.tsx`,
      `release/jimo/apps/web/src/pages/${n.pageDir}/map.tsx`,
    ];
    for (const p of expectedPaths) {
      const fullPath = path.join(projectRoot, p);
      if (existsSync(fullPath)) {
        await fs.rm(fullPath, { force: true });
        deletedFiles.push(p);
      }
    }
    const moduleDir = path.join(projectRoot, `release/jimo/apps/server/src/modules/${n.kebabSingular}`);
    if (existsSync(moduleDir)) {
      try { await fs.rm(path.join(moduleDir, 'dto'), { recursive: true, force: true }); } catch { /* */ }
      try { await fs.rm(path.join(moduleDir, 'agent'), { recursive: true, force: true }); } catch { /* */ }
      try { await fs.rmdir(moduleDir); } catch { /* not empty */ }
    }
    const pageDir = path.join(projectRoot, `release/jimo/apps/web/src/pages/${n.pageDir}`);
    if (existsSync(pageDir)) {
      try { await fs.rm(pageDir, { recursive: true, force: true }); } catch { /* */ }
    }

    await this.entrypointService.removeRouteFromUmirc(n);
    await this.entrypointService.removeSchemaExport(n);
    await this.entrypointService.removeDanglingSchemaImports(n);
    await this.entrypointService.removeModuleRegistration(n);

    const dbTableName = `lc_${tableName}`;
    const componentPath = `${n.pageComponentPath}`;
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
  // Async delete with progress tracking
  // =========================================================================

  async startDeleteHistory(id: string, cascade = false): Promise<string> {
    const history = await this.findOneHistory(id);
    const jobId = randomUUID();

    const steps = HistoryService.DELETE_STEPS.map((s) => ({
      key: s.key,
      label: s.label,
      status: 'pending' as const,
    }));
    await this.writeJobStatus(jobId, {
      jobId,
      status: 'processing',
      steps,
      progress: 0,
      currentStepLabel: '已加入清理队列，等待 cleanup-worker 处理...',
    });

    await this.db.execute(sql`
      INSERT INTO sys_cleanup_jobs (id, table_name, status, payload)
      VALUES (
        gen_random_uuid(),
        ${history.tableName},
        'pending',
        ${JSON.stringify({ historyId: id, cascade, jobId })}::jsonb
      )
    `);

    this.logger.log(`[HistoryService] Enqueued cleanup job for table="${history.tableName}" jobId=${jobId}`);
    return jobId;
  }

  // =========================================================================
  // Version management
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

  async getLatestVersion(tableName: string): Promise<(SysAutoCodeHistory & { menuName?: string }) | null> {
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
      const componentPath = `${n.pageComponentPath}`;
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

  async getHistoryVersions(tableName: string): Promise<SysAutoCodeHistory[]> {
    return this.db
      .select()
      .from(sysAutoCodeHistories)
      .where(eq(sysAutoCodeHistories.tableName, tableName))
      .orderBy(desc(sysAutoCodeHistories.version), desc(sysAutoCodeHistories.createdAt));
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

  // =========================================================================
  // Soft cleanup helper
  // =========================================================================

  async cleanupTableSoft(
    tableName: string,
    projectRoot: string,
  ): Promise<{ deletedFiles: string[]; removedMenus: number }> {
    this.ensureNotReservedTable(tableName);
    const n = deriveNames(tableName);
    const deletedFiles: string[] = [];
    let removedMenus = 0;

    const expectedPaths = [
      `release/jimo/apps/server/src/db/schema/${n.kebabName}.ts`,
      `release/jimo/apps/server/src/modules/${n.kebabSingular}/${n.kebabSingular}.service.ts`,
      `release/jimo/apps/server/src/modules/${n.kebabSingular}/${n.kebabSingular}.controller.ts`,
      `release/jimo/apps/server/src/modules/${n.kebabSingular}/${n.kebabSingular}.module.ts`,
      `release/jimo/apps/server/src/modules/${n.kebabSingular}/dto/create-${n.kebabSingular}.dto.ts`,
      `release/jimo/apps/server/src/modules/${n.kebabSingular}/dto/query-${n.kebabSingular}.dto.ts`,
      `release/jimo/apps/server/src/modules/${n.kebabSingular}/dto/update-${n.kebabSingular}.dto.ts`,
      `release/jimo/apps/server/src/modules/${n.kebabSingular}/agent/${n.kebabSingular}.agent.service.ts`,
      `release/jimo/apps/server/src/modules/${n.kebabSingular}/agent/${n.kebabSingular}.agent.module.ts`,
      `release/jimo/apps/web/src/services/${n.serviceRelDir}.ts`,
      `release/jimo/apps/web/src/pages/${n.pageDir}/index.tsx`,
      `release/jimo/apps/web/src/pages/${n.pageDir}/detail.tsx`,
      `release/jimo/apps/web/src/pages/${n.pageDir}/map.tsx`,
    ];
    for (const p of expectedPaths) {
      const fullPath = path.join(projectRoot, p);
      if (existsSync(fullPath)) {
        await fs.rm(fullPath, { force: true });
        deletedFiles.push(p);
      }
    }
    const moduleDir = path.join(projectRoot, `release/jimo/apps/server/src/modules/${n.kebabSingular}`);
    if (existsSync(moduleDir)) {
      try { await fs.rmdir(path.join(moduleDir, 'dto')); } catch { /* not empty */ }
      try { await fs.rmdir(moduleDir); } catch { /* not empty */ }
    }
    const pageDir = path.join(projectRoot, `release/jimo/apps/web/src/pages/${n.pageDir}`);
    if (existsSync(pageDir)) {
      try { await fs.rmdir(pageDir); } catch { /* not empty */ }
    }

    await this.entrypointService.removeRouteFromUmirc(n);
    await this.entrypointService.removeSchemaExport(n);
    await this.entrypointService.removeDanglingSchemaImports(n);
    await this.entrypointService.removeModuleRegistration(n);

    const componentPath = `${n.pageComponentPath}`;
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
  // Private helpers
  // =========================================================================

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

    const componentPath = `${n.pageComponentPath}`;
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

    const projectRoot = resolveProjectRoot();
    const files: string[] = [];
    const expectedPaths = [
      `release/jimo/apps/server/src/db/schema/${n.kebabName}.ts`,
      `release/jimo/apps/server/src/modules/${n.kebabSingular}/${n.kebabSingular}.service.ts`,
      `release/jimo/apps/server/src/modules/${n.kebabSingular}/${n.kebabSingular}.controller.ts`,
      `release/jimo/apps/server/src/modules/${n.kebabSingular}/${n.kebabSingular}.module.ts`,
      `release/jimo/apps/server/src/modules/${n.kebabSingular}/dto/create-${n.kebabSingular}.dto.ts`,
      `release/jimo/apps/server/src/modules/${n.kebabSingular}/dto/query-${n.kebabSingular}.dto.ts`,
      `release/jimo/apps/server/src/modules/${n.kebabSingular}/dto/update-${n.kebabSingular}.dto.ts`,
      `release/jimo/apps/server/src/modules/${n.kebabSingular}/agent/${n.kebabSingular}.agent.service.ts`,
      `release/jimo/apps/server/src/modules/${n.kebabSingular}/agent/${n.kebabSingular}.agent.module.ts`,
      `release/jimo/apps/web/src/services/${n.serviceRelDir}.ts`,
      `release/jimo/apps/web/src/pages/${n.pageDir}/index.tsx`,
      `release/jimo/apps/web/src/pages/${n.pageDir}/detail.tsx`,
      `release/jimo/apps/web/src/pages/${n.pageDir}/map.tsx`,
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

  private async parseFieldsFromSchema(tableName: string): Promise<AutoCodeField[]> {
    try {
      const n = deriveNames(tableName);
      const projectRoot = resolveProjectRoot();
      const schemaPath = path.join(projectRoot, 'release/jimo/apps/server/src/db/schema', `${n.kebabName}.ts`);

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

  ensureNotReservedTable(tableName: string): void {
    if (isReservedTableName(tableName)) {
      throw new Error(
        `拒绝删除:表 '${tableName}' 是系统保留名,不会处理其系统文件(保护平台自带资产)。`,
      );
    }
  }

  // ── Job file persistence ──

  private get jobsDir(): string {
    return path.join(resolveProjectRoot(), '.tmp', 'generate-jobs');
  }

  async writeJobStatus(jobId: string, status: any): Promise<void> {
    const dir = this.jobsDir;
    await fs.mkdir(dir, { recursive: true });
    await fs.writeFile(
      path.join(dir, `${jobId}.json`),
      JSON.stringify(status, null, 2),
      'utf-8',
    );
  }

  async readJobStatus(jobId: string): Promise<any | null> {
    try {
      const filePath = path.join(this.jobsDir, `${jobId}.json`);
      const data = await fs.readFile(filePath, 'utf-8');
      return JSON.parse(data);
    } catch {
      return null;
    }
  }

  async deleteJobFile(jobId: string): Promise<void> {
    try {
      const filePath = path.join(this.jobsDir, `${jobId}.json`);
      await fs.unlink(filePath);
    } catch { /* Ignore */ }
  }
}
