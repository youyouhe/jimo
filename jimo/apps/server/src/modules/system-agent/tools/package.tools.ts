import { eq, and, isNull, sql, inArray } from 'drizzle-orm';
import type { DrizzleDb } from '../../../db/connection';
import { sysAutoCodePackages } from '../../../db/schema/auto-code-packages';
import { sysAutoCodeHistories } from '../../../db/schema/auto-code-histories';
import { sysMenus } from '../../../db/schema/menus';
import { sysAuthorityBtns } from '../../../db/schema/authority-btns';

export function buildPackageAgentTools(db: DrizzleDb): Record<string, any> {
  return {
    list_packages: {
      description:
        '【查询】列出所有模板包（Package），含 name、slug、description、menuId、关联的业务表数量。用于了解现有包结构、创建菜单归类。',
      parameters: { type: 'object', properties: {} },
      execute: async () => {
        const pkgs = await db
          .select()
          .from(sysAutoCodePackages)
          .where(isNull(sysAutoCodePackages.deletedAt))
          .orderBy(sysAutoCodePackages.name);

        // Count tables per package
        const tableCounts = new Map<string, number>();
        const rawRows = await db.execute<{ package_name: string; cnt: string }>(
          sql`SELECT package_name, COUNT(*)::int AS cnt FROM sys_auto_code_histories
              WHERE package_name IS NOT NULL
              GROUP BY package_name`,
        );
        for (const r of Array.isArray(rawRows) ? rawRows : (rawRows as any).rows ?? []) {
          tableCounts.set(r.package_name, Number(r.cnt));
        }

        return pkgs.map((p) => ({
          id: p.id,
          name: p.name,
          slug: p.slug,
          description: p.description,
          menuId: p.menuId,
          tableCount: tableCounts.get(p.name) ?? 0,
        }));
      },
    },

    query_package: {
      description: '【精确查询】按 UUID 获取单个模板包详情。',
      parameters: {
        type: 'object',
        properties: { id: { type: 'string', description: 'Package UUID' } },
        required: ['id'],
      },
      execute: async (args: any) => {
        const rows = await db
          .select()
          .from(sysAutoCodePackages)
          .where(and(eq(sysAutoCodePackages.id, args.id), isNull(sysAutoCodePackages.deletedAt)))
          .limit(1);
        if (rows.length === 0) throw new Error(`包 ${args.id} 未找到`);
        return rows[0]!;
      },
    },

    create_package: {
      description:
        '【写入】创建新的模板包（Package）。必须提供 name。可选 slug、description。⚠️ 创建包时会自动创建对应的菜单目录（menuType=1）并分配给 super_admin 和 admin 角色。创建后包会出现在左侧边栏。',
      parameters: {
        type: 'object',
        properties: {
          name: { type: 'string', description: '包名称（如"教务管理"）' },
          slug: { type: 'string', description: 'URL 友好标识（可选，自动生成）' },
          description: { type: 'string', description: '包描述（可选）' },
        },
        required: ['name'],
      },
      execute: async (args: any) => {
        const slug = args.slug || args.name.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');
        const menuId = await ensurePackageMenu(db, args.name);

        const rows = await db
          .insert(sysAutoCodePackages)
          .values({
            name: args.name,
            slug,
            description: args.description ?? '',
            menuId,
          })
          .returning({ id: sysAutoCodePackages.id, name: sysAutoCodePackages.name, slug: sysAutoCodePackages.slug });
        return { created: rows[0]!, menuId };
      },
    },

    update_package: {
      description: '【写入】更新模板包信息。可修改 name、slug、description。需先获取目标包的 id。',
      parameters: {
        type: 'object',
        properties: {
          id: { type: 'string', description: 'Package UUID (必填)' },
          name: { type: 'string', description: '新名称' },
          slug: { type: 'string', description: '新 slug' },
          description: { type: 'string', description: '新描述' },
        },
        required: ['id'],
      },
      execute: async (args: any) => {
        const exist = await db
          .select({ id: sysAutoCodePackages.id })
          .from(sysAutoCodePackages)
          .where(and(eq(sysAutoCodePackages.id, args.id), isNull(sysAutoCodePackages.deletedAt)))
          .limit(1);
        if (exist.length === 0) throw new Error(`包 ${args.id} 未找到`);
        const data: Record<string, unknown> = { updatedAt: new Date() };
        if (args.name !== undefined) data.name = args.name;
        if (args.slug !== undefined) data.slug = args.slug;
        if (args.description !== undefined) data.description = args.description;
        await db
          .update(sysAutoCodePackages)
          .set(data)
          .where(and(eq(sysAutoCodePackages.id, args.id), isNull(sysAutoCodePackages.deletedAt)));
        return { updated: args.id };
      },
    },

    delete_package: {
      description:
        '【写入】删除模板包（软删除）。⚠️ 会自动级联清理：菜单目录、子菜单、按钮权限和角色分配（与 PackageService.deletePackage 一致）。删除前必须向用户确认。' +
        'id 必须来自 list_packages 或 query_package 返回结果中的 id 字段，不得自行编造。',
      parameters: {
        type: 'object',
        properties: { id: { type: 'string', description: 'Package UUID — 必须从 list_packages 或 query_package 的返回结果中获取' } },
        required: ['id'],
      },
      execute: async (args: any) => {
        const exist = await db
          .select({ id: sysAutoCodePackages.id, name: sysAutoCodePackages.name, menuId: sysAutoCodePackages.menuId })
          .from(sysAutoCodePackages)
          .where(and(eq(sysAutoCodePackages.id, args.id), isNull(sysAutoCodePackages.deletedAt)))
          .limit(1);
        if (exist.length === 0) throw new Error(`包 ${args.id} 未找到`);

        const pkg = exist[0]!;

        // Cascade delete the menu directory (same logic as PackageService.deletePackage)
        if (pkg.menuId) {
          const children = await db
            .select({ id: sysMenus.id })
            .from(sysMenus)
            .where(eq(sysMenus.parentId, pkg.menuId));

          const childIds = children.map((c) => c.id);
          let btnIds: string[] = [];
          if (childIds.length > 0) {
            const btnRows = await db
              .select({ id: sysMenus.id })
              .from(sysMenus)
              .where(and(inArray(sysMenus.parentId, childIds), eq(sysMenus.menuType, 3), isNull(sysMenus.deletedAt)));
            btnIds = btnRows.map((b) => b.id);
          }

          const allMenuIds = [pkg.menuId, ...childIds, ...btnIds];
          if (allMenuIds.length > 0) {
            await db.delete(sysAuthorityBtns).where(inArray(sysAuthorityBtns.menuId, allMenuIds));
            await db.delete(sysRoleMenus).where(inArray(sysRoleMenus.menuId, allMenuIds));
            if (btnIds.length > 0) await db.delete(sysMenus).where(inArray(sysMenus.id, btnIds));
            if (childIds.length > 0) await db.delete(sysMenus).where(inArray(sysMenus.id, childIds));
            await db.delete(sysMenus).where(eq(sysMenus.id, pkg.menuId));
          }
        }

        await db
          .update(sysAutoCodePackages)
          .set({ deletedAt: sql`NOW()` })
          .where(and(eq(sysAutoCodePackages.id, args.id), isNull(sysAutoCodePackages.deletedAt)));
        return { deleted: args.id, name: pkg.name, menuCleaned: !!pkg.menuId };
      },
    },

    list_package_menus: {
      description:
        '【查询】列出所有包及其包含的业务表（按 Package 分组）。返回 [{id, name, tables:[...]}]，id 为空表示未分类。用于了解当前的菜单分类现状，与菜单管理联动。',
      parameters: { type: 'object', properties: {} },
      execute: async () => {
        const pkgs = await db
          .select({ id: sysAutoCodePackages.id, name: sysAutoCodePackages.name })
          .from(sysAutoCodePackages)
          .where(isNull(sysAutoCodePackages.deletedAt));

        const rawRows = await db.execute<{ table_name: string; package_name: string }>(
          sql`SELECT DISTINCT ON (table_name) table_name, package_name
              FROM sys_auto_code_histories
              ORDER BY table_name, created_at DESC`,
        );
        const histories = Array.isArray(rawRows) ? rawRows : (rawRows as any).rows ?? [];

        const result = pkgs.map((pkg) => ({
          id: pkg.id,
          name: pkg.name,
          tables: histories
            .filter((h: any) => h.package_name === pkg.name)
            .map((h: any) => h.table_name as string),
        }));

        const unassigned = histories
          .filter((h: any) => !h.package_name)
          .map((h: any) => h.table_name as string);
        if (unassigned.length > 0) {
          result.push({ id: '', name: '(未分类)', tables: unassigned });
        }

        return result;
      },
    },
  };
}

// Quick inline menu directory creation (mirrors MenuService.ensureDirectoryMenu logic)
import { randomUUID } from 'node:crypto';
import { sysRoleMenus } from '../../../db/schema/role-menus';
import { sysRoles } from '../../../db/schema/roles';

async function ensurePackageMenu(dbg: DrizzleDb, packageName: string): Promise<string> {
  const existing = await dbg
    .select({ id: sysMenus.id })
    .from(sysMenus)
    .where(and(
      eq(sysMenus.name, packageName),
      eq(sysMenus.menuType, 1),
      isNull(sysMenus.parentId),
      isNull(sysMenus.deletedAt),
    ))
    .limit(1);
  if (existing.length > 0) return existing[0]!.id;

  const shortId = randomUUID().slice(0, 8);
  const dirPath = `/pkg/pkg-${shortId}`;

  const maxSort = await dbg
    .select({ m: sql<number>`COALESCE(MAX(${sysMenus.sort}), -1)` })
    .from(sysMenus)
    .where(isNull(sysMenus.parentId));
  const nextSort = (maxSort[0]?.m ?? -1) + 1;

  const menuRows = await dbg
    .insert(sysMenus)
    .values({
      name: packageName,
      path: dirPath,
      component: null,
      icon: 'AppstoreOutlined',
      parentId: null,
      sort: nextSort,
      isVisible: 1,
      menuType: 1,
    })
    .returning();
  const menuId = menuRows[0]!.id;

  const adminRoles = await dbg
    .select({ id: sysRoles.id })
    .from(sysRoles)
    .where(inArray(sysRoles.code, ['super_admin', 'admin']));
  if (adminRoles.length > 0) {
    await dbg
      .insert(sysRoleMenus)
      .values(adminRoles.map((r) => ({ roleId: r.id, menuId })))
      .onConflictDoNothing();
  }

  return menuId;
}
