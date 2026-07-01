import { eq, and, isNull, like, or, count, ilike, sql, inArray } from 'drizzle-orm';
import type { DrizzleDb } from '../../../db/connection';
import { sysUsers } from '../../../db/schema/users';
import { sysUserRoles } from '../../../db/schema/user-roles';
import { sysRoles } from '../../../db/schema/roles';
import { sysDepartments } from '../../../db/schema/sys-departments';
import { sysEmployees } from '../../../db/schema/sys-employees';
import * as bcrypt from 'bcryptjs';

async function resolveUserId(db: DrizzleDb, username?: string): Promise<string | null> {
  if (!username) return null;
  const rows = await db
    .select({ id: sysUsers.id })
    .from(sysUsers)
    .where(and(eq(sysUsers.username, username), isNull(sysUsers.deletedAt)))
    .limit(1);
  return rows[0]?.id ?? null;
}

interface DeptRow { id: string; name: string; code: string; parentId: string | null; children?: DeptRow[]; [key: string]: any; }
function buildDeptTree(items: DeptRow[], parentId: string | null): DeptRow[] {
  const map = new Map<string | null, DeptRow[]>();
  for (const item of items) {
    const key = item.parentId ?? null;
    if (!map.has(key)) map.set(key, []);
    map.get(key)!.push(item);
  }
  const build = (pid: string | null, visited = new Set<string | null>()): DeptRow[] => {
    if (visited.has(pid)) return [];
    visited.add(pid);
    return (map.get(pid) ?? []).map((d) => ({ ...d, children: build(d.id, new Set(visited)) }));
  };
  return build(parentId);
}

export function buildUserAgentTools(db: DrizzleDb): Record<string, any> {
  return {
    search_users: {
      description:
        '【查询】按条件筛选用户列表（分页）。支持按用户名、昵称、手机号、邮箱、状态筛选。返回列表含 id，可直接传给 query_user/update_user/delete_user。',
      parameters: {
        type: 'object',
        properties: {
          page: { type: 'number', description: '页码 (1-based), 默认 1' },
          pageSize: { type: 'number', description: '每页条数, 默认 10, 最大 100' },
          username: { type: 'string', description: '用户名模糊搜索' },
          nickname: { type: 'string', description: '昵称模糊搜索' },
          phone: { type: 'string', description: '手机号模糊搜索' },
          email: { type: 'string', description: '邮箱模糊搜索' },
          status: { type: 'number', description: '状态: 1=启用, 2=禁用' },
        },
      },
      execute: async (args: any) => {
        const page = Math.max(args.page ?? 1, 1);
        const pageSize = Math.min(Math.max(args.pageSize ?? 10, 1), 100);
        const offset = (page - 1) * pageSize;
        const conditions = [isNull(sysUsers.deletedAt)];
        if (args.username) conditions.push(ilike(sysUsers.username, `%${args.username}%`));
        if (args.nickname) conditions.push(ilike(sysUsers.nickname, `%${args.nickname}%`));
        if (args.phone) conditions.push(ilike(sysUsers.phone, `%${args.phone}%`));
        if (args.email) conditions.push(ilike(sysUsers.email, `%${args.email}%`));
        if (args.status !== undefined) conditions.push(eq(sysUsers.status, args.status));
        const whereClause = and(...conditions);
        const [rows, totalRows] = await Promise.all([
          db
            .select({
              id: sysUsers.id,
              username: sysUsers.username,
              nickname: sysUsers.nickname,
              email: sysUsers.email,
              phone: sysUsers.phone,
              status: sysUsers.status,
              createdAt: sysUsers.createdAt,
              updatedAt: sysUsers.updatedAt,
            })
            .from(sysUsers)
            .where(whereClause)
            .limit(pageSize)
            .offset(offset)
            .orderBy(sysUsers.createdAt),
          db.select({ count: count() }).from(sysUsers).where(whereClause),
        ]);
        const total = totalRows[0]?.count ?? 0;
        // Build an explicit id→username map so the LLM can copy exact UUIDs
        // for subsequent delete/update calls without hallucinating.
        const idMap = rows.map((r) => ({ id: r.id, username: r.username }));
        return { list: rows, total, page, pageSize, idMap };
      },
    },

    query_user: {
      description: '【精确查询】按 ID 或用户名获取单个用户详情（含角色列表、部门名、关联员工名）。优先用 username，其次用 id。',
      parameters: {
        type: 'object',
        properties: {
          id: { type: 'string', description: 'User UUID（可选，优先使用 username）' },
          username: { type: 'string', description: '用户名（推荐使用，人类可读，如 li_zong）' },
        },
        required: [],
      },
      execute: async (args: any) => {
        const id = args.id || await resolveUserId(db, args.username);
        if (!id) throw new Error('请提供 id 或 username');
        const rows = await db
          .select()
          .from(sysUsers)
          .where(and(eq(sysUsers.id, id), isNull(sysUsers.deletedAt)))
          .limit(1);
        if (rows.length === 0) throw new Error(`用户 ${args.username || id} 未找到`);
        const user = rows[0]!;
        const { passwordHash: _omit, ...safe } = user;
        // Resolve roles
        const roleRows = await db
          .select({ code: sysRoles.code, name: sysRoles.name })
          .from(sysUserRoles)
          .innerJoin(sysRoles, eq(sysRoles.id, sysUserRoles.roleId))
          .where(and(eq(sysUserRoles.userId, id), isNull(sysRoles.deletedAt)));
        const roles = roleRows.map((r) => r.code);
        // Resolve dept name
        let deptName: string | null = null;
        if (safe.deptId) {
          const d = await db
            .select({ name: sysDepartments.name })
            .from(sysDepartments)
            .where(and(eq(sysDepartments.id, safe.deptId), isNull(sysDepartments.deletedAt)))
            .limit(1);
          deptName = d[0]?.name ?? null;
        }
        // Resolve employee name
        let employeeName: string | null = null;
        if (safe.employeeId) {
          const e = await db
            .select({ name: sysEmployees.name })
            .from(sysEmployees)
            .where(and(eq(sysEmployees.id, safe.employeeId), isNull(sysEmployees.deletedAt)))
            .limit(1);
          employeeName = e[0]?.name ?? null;
        }
        return { ...safe, roles, deptName, employeeName };
      },
    },

    create_user: {
      description:
        '【写入】创建新用户并写入数据库。必须提供 username、password、nickname。可选 roleIds（角色 code 列表）、deptId、employeeId、email、phone、status。用户要求"新增/创建账号"时必须调用此工具。',
      parameters: {
        type: 'object',
        properties: {
          username: { type: 'string', description: '用户名（唯一）' },
          password: { type: 'string', description: '密码（至少6位）' },
          nickname: { type: 'string', description: '昵称/显示名' },
          email: { type: 'string', description: '邮箱（可选）' },
          phone: { type: 'string', description: '手机号（可选）' },
          roleIds: { type: 'array', items: { type: 'string' }, description: '角色 code 列表，如 ["admin","editor"]。默认 ["viewer"]' },
          deptId: { type: 'string', description: '部门 UUID（可选）' },
          employeeId: { type: 'string', description: '员工 UUID（可选）' },
          status: { type: 'number', description: '状态: 1=启用, 2=禁用; 默认 1' },
        },
        required: ['username', 'password', 'nickname'],
      },
      execute: async (args: any) => {
        // Check uniqueness
        const exist = await db
          .select({ id: sysUsers.id })
          .from(sysUsers)
          .where(and(eq(sysUsers.username, args.username), isNull(sysUsers.deletedAt)))
          .limit(1);
        if (exist.length) throw new Error(`用户名 "${args.username}" 已存在`);
        if (args.password.length < 6) throw new Error('密码至少6位');
        const passwordHash = await bcrypt.hash(args.password, 12);
        const rows = await db
          .insert(sysUsers)
          .values({
            username: args.username,
            passwordHash,
            nickname: args.nickname,
            email: args.email ?? null,
            phone: args.phone ?? null,
            status: args.status !== undefined ? (args.status as 1 | 2) : 1,
            deptId: args.deptId ?? null,
            employeeId: args.employeeId ?? null,
          })
          .returning({ id: sysUsers.id, username: sysUsers.username, nickname: sysUsers.nickname });
        const newUser = rows[0]!;
        // Assign roles
        let roleIds = args.roleIds ?? [];
        if (roleIds.length === 0) {
          const viewer = await db
            .select({ id: sysRoles.id })
            .from(sysRoles)
            .where(and(eq(sysRoles.code, 'viewer'), isNull(sysRoles.deletedAt)))
            .limit(1);
          if (viewer[0]) roleIds = [viewer[0].id];
        } else {
          // Convert role codes to IDs
          const roleRows = await db
            .select({ id: sysRoles.id, code: sysRoles.code })
            .from(sysRoles)
            .where(and(inArray(sysRoles.code, roleIds), isNull(sysRoles.deletedAt)));
          roleIds = roleRows.map((r) => r.id);
        }
        if (roleIds.length > 0) {
          await db.insert(sysUserRoles).values(roleIds.map((rid: string) => ({ userId: newUser.id, roleId: rid })));
        }
        return { created: newUser };
      },
    },

    update_user: {
      description:
        '【写入】更新用户信息。可修改 nickname、email、phone、status、deptId、employeeId、roleIds（角色全量替换）。需先获取目标用户的 id。不修改密码（密码走专门的修改密码流程）。',
      parameters: {
        type: 'object',
        properties: {
          id: { type: 'string', description: 'User UUID (必填)' },
          nickname: { type: 'string', description: '新昵称' },
          email: { type: 'string', description: '新邮箱' },
          phone: { type: 'string', description: '新手机号' },
          status: { type: 'number', description: '状态: 1=启用, 2=禁用' },
          deptId: { type: 'string', description: '部门 UUID' },
          employeeId: { type: 'string', description: '员工 UUID' },
          roleIds: { type: 'array', items: { type: 'string' }, description: '角色 code 全量替换列表' },
        },
        required: ['id'],
      },
      execute: async (args: any) => {
        const exist = await db
          .select({ id: sysUsers.id })
          .from(sysUsers)
          .where(and(eq(sysUsers.id, args.id), isNull(sysUsers.deletedAt)))
          .limit(1);
        if (exist.length === 0) throw new Error(`用户 ${args.id} 未找到`);
        const data: Record<string, unknown> = { updatedAt: new Date() };
        if (args.nickname !== undefined) data.nickname = args.nickname;
        if (args.email !== undefined) data.email = args.email;
        if (args.phone !== undefined) data.phone = args.phone;
        if (args.status !== undefined) data.status = args.status;
        if (args.deptId !== undefined) data.deptId = args.deptId ?? null;
        if (args.employeeId !== undefined) data.employeeId = args.employeeId ?? null;
        if (Object.keys(data).length > 1) {
          await db
            .update(sysUsers)
            .set(data)
            .where(and(eq(sysUsers.id, args.id), isNull(sysUsers.deletedAt)));
        }
        // Full-replace roles
        if (args.roleIds !== undefined) {
          // Convert codes to IDs
          const roleRows = await db
            .select({ id: sysRoles.id })
            .from(sysRoles)
            .where(and(inArray(sysRoles.code, args.roleIds), isNull(sysRoles.deletedAt)));
          const roleIdList = roleRows.map((r) => r.id);
          await db.delete(sysUserRoles).where(eq(sysUserRoles.userId, args.id));
          if (roleIdList.length > 0) {
            await db.insert(sysUserRoles).values(roleIdList.map((rid: string) => ({ userId: args.id, roleId: rid })));
          }
        }
        return { updated: args.id };
      },
    },

    delete_user: {
      description:
        '【写入】软删除用户（设置 deleted_at）。⚠️ 不可逆，删除前必须向用户确认目标用户的身份。' +
        'id 必须来自 search_users 或 query_user 返回结果中的 id 字段，不得自行编造。',
      parameters: {
        type: 'object',
        properties: { id: { type: 'string', description: 'User UUID — 必须从 search_users 或 query_user 的返回结果中获取，禁止编造' } },
        required: ['id'],
      },
      execute: async (args: any) => {
        const exist = await db
          .select({ id: sysUsers.id, username: sysUsers.username })
          .from(sysUsers)
          .where(and(eq(sysUsers.id, args.id), isNull(sysUsers.deletedAt)))
          .limit(1);
        if (exist.length === 0) throw new Error(`用户 ${args.id} 未找到`);
        // Prevent deleting the last super_admin
        const targetRoles = await db
          .select({ code: sysRoles.code })
          .from(sysUserRoles)
          .innerJoin(sysRoles, eq(sysRoles.id, sysUserRoles.roleId))
          .where(and(eq(sysUserRoles.userId, args.id), isNull(sysRoles.deletedAt)));
        if (targetRoles.some((r) => r.code === 'super_admin')) {
          const superAdminCount = await db
            .select({ count: count() })
            .from(sysUserRoles)
            .innerJoin(sysRoles, eq(sysRoles.id, sysUserRoles.roleId))
            .innerJoin(sysUsers, eq(sysUsers.id, sysUserRoles.userId))
            .where(and(eq(sysRoles.code, 'super_admin'), isNull(sysUsers.deletedAt)));
          if ((superAdminCount[0]?.count ?? 0) <= 1) {
            throw new Error('不能删除最后一个超级管理员');
          }
        }
        await db
          .update(sysUsers)
          .set({ deletedAt: sql`NOW()` })
          .where(and(eq(sysUsers.id, args.id), isNull(sysUsers.deletedAt)));
        return { deleted: args.id, username: exist[0]!.username };
      },
    },

    list_roles: {
      description: '【查询】列出系统中所有可分配的角色（code + name）。创建/修改用户分配角色前先调用此工具。',
      parameters: { type: 'object', properties: {} },
      execute: async () => {
        const rows = await db
          .select({ code: sysRoles.code, name: sysRoles.name, id: sysRoles.id })
          .from(sysRoles)
          .where(isNull(sysRoles.deletedAt))
          .orderBy(sysRoles.code);
        return rows;
      },
    },

    list_departments: {
      description: '【查询】列出所有部门（树形层级结构，含 children 字段显示父子关系）。用于了解组织架构、选择用户的所属部门。',
      parameters: { type: 'object', properties: {} },
      execute: async () => {
        const all = await db
          .select()
          .from(sysDepartments)
          .where(isNull(sysDepartments.deletedAt))
          .orderBy(sysDepartments.name);
        return buildDeptTree(all, null);
      },
    },

    list_employees: {
      description: '【查询】列出系统中所有在职员工（id + name + employeeNo）。用于选择用户的关联员工。',
      parameters: { type: 'object', properties: {} },
      execute: async () => {
        const rows = await db
          .select({ id: sysEmployees.id, name: sysEmployees.name, employeeNo: sysEmployees.employeeNo })
          .from(sysEmployees)
          .where(and(eq(sysEmployees.status, 1), isNull(sysEmployees.deletedAt)))
          .orderBy(sysEmployees.name)
          .limit(200);
        return rows;
      },
    },
  };
}
