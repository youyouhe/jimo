import { eq, and, isNull, sql, inArray } from 'drizzle-orm';
import type { DrizzleDb } from '../../../db/connection';
import { sysRoles } from '../../../db/schema/roles';
import { sysUserRoles } from '../../../db/schema/user-roles';
import { sysRoleMenus } from '../../../db/schema/role-menus';
import { sysMenus } from '../../../db/schema/menus';
import { sysUsers } from '../../../db/schema/users';

export function buildRoleAgentTools(db: DrizzleDb): Record<string, any> {
  return {
    list_roles: {
      description: '【查询】列出所有系统角色（code + name + description + isDefault）。用于了解现有角色、分配权限时参考。',
      parameters: { type: 'object', properties: {} },
      execute: async () => {
        return db
          .select()
          .from(sysRoles)
          .where(isNull(sysRoles.deletedAt))
          .orderBy(sysRoles.code);
      },
    },

    query_role: {
      description: '【精确查询】按 UUID 获取单个角色详情（含角色下有多少用户）。',
      parameters: {
        type: 'object',
        properties: { id: { type: 'string', description: 'Role UUID' } },
        required: ['id'],
      },
      execute: async (args: any) => {
        const rows = await db
          .select()
          .from(sysRoles)
          .where(and(eq(sysRoles.id, args.id), isNull(sysRoles.deletedAt)))
          .limit(1);
        if (rows.length === 0) throw new Error(`角色 ${args.id} 未找到`);
        const userCount = await db
          .select({ cnt: sql<number>`count(*)::int` })
          .from(sysUserRoles)
          .where(eq(sysUserRoles.roleId, args.id));
        return { ...rows[0]!, userCount: userCount[0]?.cnt ?? 0 };
      },
    },

    create_role: {
      description:
        '【写入】创建新角色。必须提供 name 和 code（code 必须唯一）。可选 description。code 只能是英文小写+下划线，如 editor、dept_admin。' +
        '⚠️ 角色创建后不会自动分配权限，需要手动给角色分配菜单和 API。',
      parameters: {
        type: 'object',
        properties: {
          name: { type: 'string', description: '角色名称（中文），如"编辑者"' },
          code: { type: 'string', description: '角色 code（英文小写+下划线，唯一），如 editor' },
          description: { type: 'string', description: '角色描述（可选）' },
        },
        required: ['name', 'code'],
      },
      execute: async (args: any) => {
        const exist = await db
          .select({ id: sysRoles.id })
          .from(sysRoles)
          .where(and(eq(sysRoles.code, args.code), isNull(sysRoles.deletedAt)))
          .limit(1);
        if (exist.length) throw new Error(`角色 code "${args.code}" 已存在`);
        const rows = await db
          .insert(sysRoles)
          .values({
            name: args.name,
            code: args.code,
            description: args.description ?? null,
          })
          .returning({ id: sysRoles.id, name: sysRoles.name, code: sysRoles.code });
        return { created: rows[0]! };
      },
    },

    update_role: {
      description: '【写入】更新角色信息。可修改 name、code、description。需先获取目标角色的 id。',
      parameters: {
        type: 'object',
        properties: {
          id: { type: 'string', description: 'Role UUID (必填)' },
          name: { type: 'string', description: '新名称' },
          code: { type: 'string', description: '新 code' },
          description: { type: 'string', description: '新描述' },
        },
        required: ['id'],
      },
      execute: async (args: any) => {
        const exist = await db
          .select({ id: sysRoles.id })
          .from(sysRoles)
          .where(and(eq(sysRoles.id, args.id), isNull(sysRoles.deletedAt)))
          .limit(1);
        if (exist.length === 0) throw new Error(`角色 ${args.id} 未找到`);
        const data: Record<string, unknown> = { updatedAt: new Date() };
        if (args.name !== undefined) data.name = args.name;
        if (args.code !== undefined) data.code = args.code;
        if (args.description !== undefined) data.description = args.description;
        await db
          .update(sysRoles)
          .set(data)
          .where(and(eq(sysRoles.id, args.id), isNull(sysRoles.deletedAt)));
        return { updated: args.id };
      },
    },

    delete_role: {
      description:
        '【写入】软删除角色。⚠️ 不可逆，系统保护角色（super_admin、admin、viewer）不可删除。' +
        '删除角色会自动清理该角色与所有用户的关联。删除前必须向用户确认。' +
        'id 必须来自 list_roles 或 query_role 返回结果中的 id 字段，不得自行编造。',
      parameters: {
        type: 'object',
        properties: { id: { type: 'string', description: 'Role UUID — 必须从 list_roles 或 query_role 的返回结果中获取' } },
        required: ['id'],
      },
      execute: async (args: any) => {
        const exist = await db
          .select({ id: sysRoles.id, name: sysRoles.name, code: sysRoles.code })
          .from(sysRoles)
          .where(and(eq(sysRoles.id, args.id), isNull(sysRoles.deletedAt)))
          .limit(1);
        if (exist.length === 0) throw new Error(`角色 ${args.id} 未找到`);
        // Prevent deleting system-protected roles
        const PROTECTED = ['super_admin', 'admin', 'viewer'];
        if (PROTECTED.includes(exist[0]!.code)) {
          throw new Error(`系统保护角色 "${exist[0]!.code}" 不可删除`);
        }
        // Remove role from all users
        await db.delete(sysUserRoles).where(eq(sysUserRoles.roleId, args.id));
        // Soft-delete the role
        await db
          .update(sysRoles)
          .set({ deletedAt: sql`NOW()` })
          .where(and(eq(sysRoles.id, args.id), isNull(sysRoles.deletedAt)));
        return { deleted: args.id, name: exist[0]!.name, code: exist[0]!.code };
      },
    },

    query_role_permissions: {
      description:
        '【查询】查询某个角色的完整权限配置：包含哪些菜单（树形）、每个菜单的权限点（按钮）。传 roleId（UUID）或 roleCode（如 admin）。用于了解"admin 角色有哪些权限"这类问题。',
      parameters: {
        type: 'object',
        properties: {
          roleId: { type: 'string', description: 'Role UUID（与 roleCode 二选一）' },
          roleCode: { type: 'string', description: 'Role code，如 admin、editor（与 roleId 二选一）' },
        },
      },
      execute: async (args: any) => {
        let roleId = args.roleId;
        if (!roleId && args.roleCode) {
          const r = await db
            .select({ id: sysRoles.id })
            .from(sysRoles)
            .where(and(eq(sysRoles.code, args.roleCode), isNull(sysRoles.deletedAt)))
            .limit(1);
          if (r.length === 0) throw new Error(`角色 code "${args.roleCode}" 未找到`);
          roleId = r[0]!.id;
        }
        if (!roleId) throw new Error('请提供 roleId 或 roleCode');

        const role = await db
          .select({ id: sysRoles.id, name: sysRoles.name, code: sysRoles.code })
          .from(sysRoles)
          .where(and(eq(sysRoles.id, roleId), isNull(sysRoles.deletedAt)))
          .limit(1);
        if (role.length === 0) throw new Error(`角色 ${roleId} 未找到`);

        // Get assigned menus with permissions
        const menus = await db
          .select({
            id: sysMenus.id,
            name: sysMenus.name,
            path: sysMenus.path,
            menuType: sysMenus.menuType,
            permission: sysMenus.permission,
            parentId: sysMenus.parentId,
            icon: sysMenus.icon,
          })
          .from(sysRoleMenus)
          .innerJoin(sysMenus, eq(sysRoleMenus.menuId, sysMenus.id))
          .where(
            and(
              eq(sysRoleMenus.roleId, roleId),
              isNull(sysMenus.deletedAt),
            ),
          )
          .orderBy(sysMenus.menuType, sysMenus.sort);

        // Build summary
        const pageMenus = menus.filter((m) => m.menuType === 2);
        const dirMenus = menus.filter((m) => m.menuType === 1);
        const btnMenus = menus.filter((m) => m.menuType === 3);

        return {
          role: role[0]!,
          summary: `${pageMenus.length} 个页面, ${dirMenus.length} 个目录, ${btnMenus.length} 个按钮权限`,
          menus: menus.map((m) => ({
            id: m.id, name: m.name, path: m.path,
            menuType: m.menuType,
            permission: m.permission,
            parentId: m.parentId,
          })),
        };
      },
    },

    list_available_permissions: {
      description:
        '【查询】列出系统中所有可分配的菜单和权限点（树形，含 id）。用于创建新角色时了解有哪些菜单和按钮可以分配。每个节点含 id（分配时使用）、name、menuType、permission、children。',
      parameters: { type: 'object', properties: {} },
      execute: async () => {
        const all = await db
          .select()
          .from(sysMenus)
          .where(and(isNull(sysMenus.deletedAt), sql`${sysMenus.isVisible} = 1 OR ${sysMenus.menuType} = 3`))
          .orderBy(sysMenus.sort, sysMenus.createdAt);
        return buildMenuTree(all, null);
      },
    },

    assign_role_menus: {
      description:
        '【写入】为角色分配菜单权限（全量替换）。menuIds 必须来自 list_available_permissions 或 query_role_permissions 返回结果中的 id。⚠️ 此操作会清除角色原有的所有菜单分配并替换为新列表。',
      parameters: {
        type: 'object',
        properties: {
          roleId: { type: 'string', description: 'Role UUID（与 roleCode 二选一）' },
          roleCode: { type: 'string', description: 'Role code，如 admin（与 roleId 二选一）' },
          menuIds: { type: 'array', items: { type: 'string' }, description: '要分配的菜单 ID 列表（全量替换）' },
        },
        required: ['menuIds'],
      },
      execute: async (args: any) => {
        let roleId = args.roleId;
        if (!roleId && args.roleCode) {
          const r = await db
            .select({ id: sysRoles.id })
            .from(sysRoles)
            .where(and(eq(sysRoles.code, args.roleCode), isNull(sysRoles.deletedAt)))
            .limit(1);
          if (r.length === 0) throw new Error(`角色 code "${args.roleCode}" 未找到`);
          roleId = r[0]!.id;
        }
        if (!roleId) throw new Error('请提供 roleId 或 roleCode');

        const menuIds: string[] = args.menuIds ?? [];
        // Full replace
        await db.delete(sysRoleMenus).where(eq(sysRoleMenus.roleId, roleId));
        if (menuIds.length > 0) {
          await db.insert(sysRoleMenus).values(menuIds.map((mid: string) => ({ roleId, menuId: mid })));
        }
        return { assigned: { roleId, menuCount: menuIds.length } };
      },
    },
  };
}

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
