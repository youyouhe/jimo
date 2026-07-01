import { eq, and, isNull, count, ilike, sql, inArray } from 'drizzle-orm';
import type { DrizzleDb } from '../../../db/connection';
import { sysMenus } from '../../../db/schema/menus';
import { sysAutoCodeHistories } from '../../../db/schema/auto-code-histories';
import { sysAutoCodePackages } from '../../../db/schema/auto-code-packages';

function buildMenuTree(items: any[], parentId: string | null): any[] {
  const map = new Map<string | null, any[]>();
  for (const item of items) {
    const key = item.parentId ?? null;
    if (!map.has(key)) map.set(key, []);
    map.get(key)!.push(item);
  }
  const build = (pid: string | null, visited = new Set<string | null>()): any[] => {
    if (visited.has(pid)) return [];
    visited.add(pid);
    return (map.get(pid) ?? []).map((m: any) => ({ ...m, children: build(m.id, new Set(visited)) }));
  };
  return build(parentId);
}

export function buildMenuAgentTools(db: DrizzleDb): Record<string, any> {
  return {
    list_menus: {
      description: '【查询】列出所有菜单（树形层级结构，含 children 字段显示父子关系）。用于了解菜单架构、查找目标菜单的 id。',
      parameters: { type: 'object', properties: {} },
      execute: async () => {
        const all = await db
          .select()
          .from(sysMenus)
          .where(isNull(sysMenus.deletedAt))
          .orderBy(sysMenus.sort, sysMenus.createdAt);
        return buildMenuTree(all, null);
      },
    },

    query_menu: {
      description: '【精确查询】按 UUID 获取单个菜单详情。',
      parameters: {
        type: 'object',
        properties: { id: { type: 'string', description: 'Menu UUID' } },
        required: ['id'],
      },
      execute: async (args: any) => {
        const rows = await db
          .select()
          .from(sysMenus)
          .where(and(eq(sysMenus.id, args.id), isNull(sysMenus.deletedAt)))
          .limit(1);
        if (rows.length === 0) throw new Error(`菜单 ${args.id} 未找到`);
        return rows[0]!;
      },
    },

    create_menu: {
      description:
        '【写入】创建新菜单项。必须提供 name。可选 path、component、icon、parentId（父菜单 UUID）、sort、menuType（1=目录, 2=菜单, 3=按钮）、permission、isVisible。用户要求"新增/创建菜单"时必须调用此工具。' +
        '⚠️ 创建菜单不会自动分配角色权限，需要后续操作。',
      parameters: {
        type: 'object',
        properties: {
          name: { type: 'string', description: '菜单名称' },
          path: { type: 'string', description: '路由路径，如 /system/new-page' },
          component: { type: 'string', description: '前端组件路径，如 ./new-page/index' },
          icon: { type: 'string', description: 'Ant Design 图标名，如 SettingOutlined' },
          parentId: { type: 'string', description: '父菜单 UUID（可选，空则为顶级菜单）' },
          sort: { type: 'number', description: '排序值，默认 0' },
          menuType: { type: 'number', description: '菜单类型: 1=目录, 2=菜单, 3=按钮（默认 2）' },
          permission: { type: 'string', description: '权限标识（可选），如 system:user:list' },
          isVisible: { type: 'number', description: '是否可见: 1=可见(默认), 0=隐藏' },
        },
        required: ['name'],
      },
      execute: async (args: any) => {
        const rows = await db
          .insert(sysMenus)
          .values({
            name: args.name,
            path: args.path ?? null,
            component: args.component ?? null,
            icon: args.icon ?? null,
            parentId: args.parentId ?? null,
            sort: args.sort ?? 0,
            menuType: args.menuType ?? 2,
            permission: args.permission ?? null,
            isVisible: args.isVisible ?? 1,
          })
          .returning({ id: sysMenus.id, name: sysMenus.name, path: sysMenus.path });
        return { created: rows[0]! };
      },
    },

    update_menu: {
      description: '【写入】更新菜单信息。可修改 name、path、component、icon、parentId、sort、menuType、permission、isVisible。需先获取目标菜单的 id。',
      parameters: {
        type: 'object',
        properties: {
          id: { type: 'string', description: 'Menu UUID (必填)' },
          name: { type: 'string', description: '新名称' },
          path: { type: 'string', description: '新路径' },
          component: { type: 'string', description: '新组件路径' },
          icon: { type: 'string', description: '新图标' },
          parentId: { type: 'string', description: '新父菜单 UUID' },
          sort: { type: 'number', description: '新排序值' },
          menuType: { type: 'number', description: '菜单类型: 1=目录, 2=菜单, 3=按钮' },
          permission: { type: 'string', description: '新权限标识' },
          isVisible: { type: 'number', description: '是否可见: 1=可见, 0=隐藏' },
        },
        required: ['id'],
      },
      execute: async (args: any) => {
        const exist = await db
          .select({ id: sysMenus.id })
          .from(sysMenus)
          .where(and(eq(sysMenus.id, args.id), isNull(sysMenus.deletedAt)))
          .limit(1);
        if (exist.length === 0) throw new Error(`菜单 ${args.id} 未找到`);
        const data: Record<string, unknown> = { updatedAt: new Date() };
        if (args.name !== undefined) data.name = args.name;
        if (args.path !== undefined) data.path = args.path;
        if (args.component !== undefined) data.component = args.component;
        if (args.icon !== undefined) data.icon = args.icon;
        if (args.parentId !== undefined) data.parentId = args.parentId ?? null;
        if (args.sort !== undefined) data.sort = args.sort;
        if (args.menuType !== undefined) data.menuType = args.menuType;
        if (args.permission !== undefined) data.permission = args.permission;
        if (args.isVisible !== undefined) data.isVisible = args.isVisible;
        await db
          .update(sysMenus)
          .set(data)
          .where(and(eq(sysMenus.id, args.id), isNull(sysMenus.deletedAt)));
        return { updated: args.id };
      },
    },

    delete_menu: {
      description:
        '【写入】软删除菜单（设置 deleted_at）。⚠️ 不可逆，不会自动级联删除子菜单。删除前必须向用户确认。' +
        'id 必须来自 list_menus 或 query_menu 返回结果中的 id 字段，不得自行编造。',
      parameters: {
        type: 'object',
        properties: { id: { type: 'string', description: 'Menu UUID — 必须从 list_menus 或 query_menu 的返回结果中获取' } },
        required: ['id'],
      },
      execute: async (args: any) => {
        const exist = await db
          .select({ id: sysMenus.id, name: sysMenus.name })
          .from(sysMenus)
          .where(and(eq(sysMenus.id, args.id), isNull(sysMenus.deletedAt)))
          .limit(1);
        if (exist.length === 0) throw new Error(`菜单 ${args.id} 未找到`);
        await db
          .update(sysMenus)
          .set({ deletedAt: sql`NOW()` })
          .where(and(eq(sysMenus.id, args.id), isNull(sysMenus.deletedAt)));
        return { deleted: args.id, name: exist[0]!.name };
      },
    },

    detect_orphan_menus: {
      description:
        '【诊断】检测孤立菜单——① 代码生成器创建的菜单但对应lc_表已被删除；② Package目录菜单但对应Package已被删除。' +
        '返回 orphanMenus（孤立菜单）和 aliveMenus（活跃菜单）两个列表。' +
        '⚠️ 清理前必须向用户展示完整列表并获取确认。',
      parameters: { type: 'object', properties: {} },
      execute: async () => {
        // 1. Find all autocode-generated menus (path/component contain 'lc/')
        const allMenus = await db
          .select()
          .from(sysMenus)
          .where(and(
            sql`(${sysMenus.path} LIKE '/lc/%' OR ${sysMenus.component} LIKE './lc/%')`,
            isNull(sysMenus.deletedAt),
          ))
          .orderBy(sysMenus.name);

        // 2. Get all known table names from autocode history
        const histories = await db
          .select({ tableName: sysAutoCodeHistories.tableName })
          .from(sysAutoCodeHistories);
        const knownTables = new Set(histories.map((h) => h.tableName));

        // 3. Get all physical lc_ tables
        const physResult = await db.execute(
          sql`SELECT table_name FROM information_schema.tables WHERE table_schema = 'public' AND table_name LIKE 'lc_%'`,
        );
        const physTables = new Set(Array.from(physResult as any).map((r: any) => r.table_name));

        // 4. For each menu, extract table name and check status
        const orphanMenus: any[] = [];
        const aliveMenus: any[] = [];
        const seen = new Set<string>();

        for (const menu of allMenus) {
          if (seen.has(menu.id)) continue;
          seen.add(menu.id);

          // Extract table name from path: /lc/contracts → lc_contracts
          const match = menu.path?.match(/\/lc\/(.+)/) || menu.component?.match(/\.\/lc\/(.+?)\//);
          const slug = match ? match[1] : null;
          const tableName = slug ? `lc_${slug}` : null;

          const hasHistory = tableName ? knownTables.has(tableName) : false;
          const hasPhysTable = tableName ? physTables.has(tableName) : false;
          const isOrphan = !hasHistory && !hasPhysTable;

          const record = {
            id: menu.id,
            name: menu.name,
            path: menu.path,
            tableName,
            hasHistory,
            hasPhysTable,
          };

          if (isOrphan) {
            orphanMenus.push({ ...record, kind: 'lc_table' });
          } else {
            aliveMenus.push({ ...record, kind: 'lc_table' });
          }
        }

        // 5. Also detect orphaned /pkg/* directory menus (Package deleted but menu remains)
        const pkgMenus = await db
          .select()
          .from(sysMenus)
          .where(and(
            sql`${sysMenus.path} LIKE '/pkg/%'`,
            eq(sysMenus.menuType, 1),
            isNull(sysMenus.deletedAt),
          ))
          .orderBy(sysMenus.name);

        if (pkgMenus.length > 0) {
          const activePkgMenuIds = new Set<string>();
          const pkgs = await db
            .select({ menuId: sysAutoCodePackages.menuId })
            .from(sysAutoCodePackages)
            .where(and(isNull(sysAutoCodePackages.deletedAt), sql`${sysAutoCodePackages.menuId} IS NOT NULL`));
          for (const p of pkgs) {
            if (p.menuId) activePkgMenuIds.add(p.menuId);
          }

          for (const menu of pkgMenus) {
            const isOrphan = !activePkgMenuIds.has(menu.id);
            const record = {
              id: menu.id, name: menu.name, path: menu.path,
              kind: 'pkg_directory',
              isOrphan,
            };
            if (isOrphan) {
              orphanMenus.push(record);
            } else {
              aliveMenus.push(record);
            }
          }
        }

        return {
          totalAutocodeMenus: allMenus.length,
          totalPkgMenus: pkgMenus.length,
          orphanCount: orphanMenus.length,
          aliveCount: aliveMenus.length,
          orphanMenus,
          aliveMenus,
          hint: 'orphanMenus 中 kind=lc_table 的是业务表已删除的菜单，kind=pkg_directory 的是 Package 已删除但菜单目录残留。请先展示清单给用户确认后再逐条 delete_menu。',
        };
      },
    },
  };
}
