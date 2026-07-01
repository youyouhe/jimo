import { eq, and, isNull, count, ilike, sql } from 'drizzle-orm';
import type { DrizzleDb } from '../../../db/connection';
import { sysDepartments } from '../../../db/schema/sys-departments';
import { sysUsers } from '../../../db/schema/users';

function buildDeptTree(items: any[], parentId: string | null): any[] {
  const map = new Map<string | null, any[]>();
  for (const item of items) {
    const key = item.parentId ?? null;
    if (!map.has(key)) map.set(key, []);
    map.get(key)!.push(item);
  }
  const build = (pid: string | null, visited = new Set<string | null>()): any[] => {
    if (visited.has(pid)) return [];
    visited.add(pid);
    return (map.get(pid) ?? []).map((d: any) => ({ ...d, children: build(d.id, new Set(visited)) }));
  };
  return build(parentId);
}

export function buildDepartmentAgentTools(db: DrizzleDb): Record<string, any> {
  return {
    search_departments: {
      description: '【查询】按条件筛选部门列表（分页）。支持按名称、编码筛选。',
      parameters: {
        type: 'object',
        properties: {
          page: { type: 'number', description: '页码 (1-based), 默认 1' },
          pageSize: { type: 'number', description: '每页条数, 默认 10, 最大 100' },
          name: { type: 'string', description: '部门名称模糊搜索' },
          code: { type: 'string', description: '部门编码模糊搜索' },
        },
      },
      execute: async (args: any) => {
        const page = Math.max(args.page ?? 1, 1);
        const pageSize = Math.min(Math.max(args.pageSize ?? 10, 1), 100);
        const offset = (page - 1) * pageSize;
        const conditions = [isNull(sysDepartments.deletedAt)];
        if (args.name) conditions.push(ilike(sysDepartments.name, `%${args.name}%`));
        if (args.code) conditions.push(ilike(sysDepartments.code, `%${args.code}%`));
        const whereClause = and(...conditions);
        const [rows, totalRows] = await Promise.all([
          db
            .select()
            .from(sysDepartments)
            .where(whereClause)
            .limit(pageSize)
            .offset(offset)
            .orderBy(sysDepartments.name),
          db.select({ count: count() }).from(sysDepartments).where(whereClause),
        ]);
        const total = totalRows[0]?.count ?? 0;
        const idMap = rows.map((r) => ({ id: r.id, name: r.name }));
        return { list: rows, total, page, pageSize, idMap };
      },
    },

    query_department: {
      description: '【精确查询】按 UUID 获取单个部门详情。',
      parameters: {
        type: 'object',
        properties: { id: { type: 'string', description: 'Department UUID' } },
        required: ['id'],
      },
      execute: async (args: any) => {
        const rows = await db
          .select()
          .from(sysDepartments)
          .where(and(eq(sysDepartments.id, args.id), isNull(sysDepartments.deletedAt)))
          .limit(1);
        if (rows.length === 0) throw new Error(`部门 ${args.id} 未找到`);
        return rows[0]!;
      },
    },

    create_department: {
      description:
        '【写入】创建新部门。必须提供 name 和 code。可选 description、parentId（上级部门 UUID）、leadId（负责人用户 UUID）。用户要求"新增/创建部门"时必须调用此工具。',
      parameters: {
        type: 'object',
        properties: {
          name: { type: 'string', description: '部门名称' },
          code: { type: 'string', description: '部门编码（唯一）' },
          description: { type: 'string', description: '描述（可选）' },
          parentId: { type: 'string', description: '上级部门 UUID（可选）' },
          leadId: { type: 'string', description: '负责人用户 UUID（可选）' },
        },
        required: ['name', 'code'],
      },
      execute: async (args: any) => {
        // Check code uniqueness
        const exist = await db
          .select({ id: sysDepartments.id })
          .from(sysDepartments)
          .where(and(eq(sysDepartments.code, args.code), isNull(sysDepartments.deletedAt)))
          .limit(1);
        if (exist.length) throw new Error(`部门编码 "${args.code}" 已存在`);
        const rows = await db
          .insert(sysDepartments)
          .values({
            name: args.name,
            code: args.code,
            description: args.description ?? '',
            parentId: args.parentId ?? null,
            leadId: args.leadId ?? null,
          })
          .returning({ id: sysDepartments.id, name: sysDepartments.name, code: sysDepartments.code });
        return { created: rows[0]! };
      },
    },

    update_department: {
      description: '【写入】更新部门信息。可修改 name、code、description、parentId、leadId。需先获取目标部门的 id。',
      parameters: {
        type: 'object',
        properties: {
          id: { type: 'string', description: 'Department UUID (必填)' },
          name: { type: 'string', description: '新名称' },
          code: { type: 'string', description: '新编码' },
          description: { type: 'string', description: '新描述' },
          parentId: { type: 'string', description: '新上级部门 UUID' },
          leadId: { type: 'string', description: '新负责人用户 UUID' },
        },
        required: ['id'],
      },
      execute: async (args: any) => {
        const exist = await db
          .select({ id: sysDepartments.id })
          .from(sysDepartments)
          .where(and(eq(sysDepartments.id, args.id), isNull(sysDepartments.deletedAt)))
          .limit(1);
        if (exist.length === 0) throw new Error(`部门 ${args.id} 未找到`);
        const data: Record<string, unknown> = { updatedAt: new Date() };
        if (args.name !== undefined) data.name = args.name;
        if (args.code !== undefined) data.code = args.code;
        if (args.description !== undefined) data.description = args.description;
        if (args.parentId !== undefined) data.parentId = args.parentId ?? null;
        if (args.leadId !== undefined) data.leadId = args.leadId ?? null;
        await db
          .update(sysDepartments)
          .set(data)
          .where(and(eq(sysDepartments.id, args.id), isNull(sysDepartments.deletedAt)));
        return { updated: args.id };
      },
    },

    delete_department: {
      description:
        '【写入】软删除部门（设置 deleted_at）。⚠️ 不可逆，不会自动级联删除子部门或用户关联。删除前必须向用户确认。' +
        'id 必须来自 search_departments 或 query_department 返回结果中的 id 字段，不得自行编造。',
      parameters: {
        type: 'object',
        properties: { id: { type: 'string', description: 'Department UUID' } },
        required: ['id'],
      },
      execute: async (args: any) => {
        const exist = await db
          .select({ id: sysDepartments.id, name: sysDepartments.name })
          .from(sysDepartments)
          .where(and(eq(sysDepartments.id, args.id), isNull(sysDepartments.deletedAt)))
          .limit(1);
        if (exist.length === 0) throw new Error(`部门 ${args.id} 未找到`);
        await db
          .update(sysDepartments)
          .set({ deletedAt: sql`NOW()` })
          .where(and(eq(sysDepartments.id, args.id), isNull(sysDepartments.deletedAt)));
        return { deleted: args.id, name: exist[0]!.name };
      },
    },

    list_departments_options: {
      description: '【查询】列出所有部门（树形层级结构，含 children 字段显示父子关系）。用于了解组织架构、选择上级部门或分配部门。',
      parameters: { type: 'object', properties: {} },
      execute: async () => {
        const all = await db
          .select()
          .from(sysDepartments)
          .where(isNull(sysDepartments.deletedAt))
          .orderBy(sysDepartments.name);
        return buildDeptTree(all as any, null);
      },
    },

    list_users_options: {
      description: '【查询】列出所有用户（id + nickname/username），用于选择部门负责人。',
      parameters: { type: 'object', properties: {} },
      execute: async () => {
        const rows = await db
          .select({ id: sysUsers.id, nickname: sysUsers.nickname, username: sysUsers.username })
          .from(sysUsers)
          .where(isNull(sysUsers.deletedAt))
          .orderBy(sysUsers.nickname)
          .limit(200);
        return rows.map((r) => ({ id: r.id, label: r.nickname || r.username }));
      },
    },
  };
}
