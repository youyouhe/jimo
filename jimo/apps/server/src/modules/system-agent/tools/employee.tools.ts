import { eq, and, isNull, count, ilike, sql, inArray } from 'drizzle-orm';
import type { DrizzleDb } from '../../../db/connection';
import { sysEmployees } from '../../../db/schema/sys-employees';
import { sysDepartments } from '../../../db/schema/sys-departments';

async function resolveEmployeeId(db: DrizzleDb, employeeNo?: string): Promise<string | null> {
  if (!employeeNo) return null;
  const rows = await db
    .select({ id: sysEmployees.id })
    .from(sysEmployees)
    .where(and(eq(sysEmployees.employeeNo, employeeNo), isNull(sysEmployees.deletedAt)))
    .limit(1);
  return rows[0]?.id ?? null;
}

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

export function buildEmployeeAgentTools(db: DrizzleDb): Record<string, any> {
  return {
    search_employees: {
      description: '【查询】按条件筛选员工列表（分页）。支持按工号、姓名、部门、状态筛选。',
      parameters: {
        type: 'object',
        properties: {
          page: { type: 'number', description: '页码 (1-based), 默认 1' },
          pageSize: { type: 'number', description: '每页条数, 默认 10, 最大 100' },
          employeeNo: { type: 'string', description: '工号模糊搜索' },
          name: { type: 'string', description: '姓名模糊搜索' },
          departmentId: { type: 'string', description: '部门 UUID 精确筛选' },
          status: { type: 'number', description: '状态: 1=在职, 2=离职, 3=休假' },
        },
      },
      execute: async (args: any) => {
        const page = Math.max(args.page ?? 1, 1);
        const pageSize = Math.min(Math.max(args.pageSize ?? 10, 1), 100);
        const offset = (page - 1) * pageSize;
        const conditions = [isNull(sysEmployees.deletedAt)];
        if (args.employeeNo) conditions.push(ilike(sysEmployees.employeeNo, `%${args.employeeNo}%`));
        if (args.name) conditions.push(ilike(sysEmployees.name, `%${args.name}%`));
        if (args.departmentId) conditions.push(eq(sysEmployees.departmentId, args.departmentId));
        if (args.status !== undefined) conditions.push(eq(sysEmployees.status, args.status));
        const whereClause = and(...conditions);
        const [rows, totalRows] = await Promise.all([
          db
            .select()
            .from(sysEmployees)
            .where(whereClause)
            .limit(pageSize)
            .offset(offset)
            .orderBy(sysEmployees.employeeNo),
          db.select({ count: count() }).from(sysEmployees).where(whereClause),
        ]);
        const total = totalRows[0]?.count ?? 0;
        // Resolve department names
        const deptIds = [...new Set(rows.map((r) => r.departmentId).filter(Boolean))] as string[];
        const deptMap = new Map<string, string>();
        if (deptIds.length) {
          const dRows = await db
            .select({ id: sysDepartments.id, name: sysDepartments.name })
            .from(sysDepartments)
            .where(and(inArray(sysDepartments.id, deptIds), isNull(sysDepartments.deletedAt)));
          for (const d of dRows) deptMap.set(d.id, d.name);
        }
        const list = rows.map((r) => ({
          ...r,
          departmentName: (r.departmentId && deptMap.get(r.departmentId)) ?? null,
        }));
        const idMap = list.map((r) => ({ id: r.id, name: r.name, employeeNo: r.employeeNo }));
        return { list, total, page, pageSize, idMap };
      },
    },

    query_employee: {
      description: '【精确查询】按 UUID 或工号获取单个员工详情。推荐使用 employeeNo（如 SALE-001），id 为备选。',
      parameters: {
        type: 'object',
        properties: {
          id: { type: 'string', description: 'Employee UUID（备选）' },
          employeeNo: { type: 'string', description: '工号，如 SALE-001（推荐）' },
        },
        required: [],
      },
      execute: async (args: any) => {
        const id = args.id || await resolveEmployeeId(db, args.employeeNo);
        if (!id) throw new Error('请提供 id 或 employeeNo');
        const rows = await db
          .select()
          .from(sysEmployees)
          .where(and(eq(sysEmployees.id, id), isNull(sysEmployees.deletedAt)))
          .limit(1);
        if (rows.length === 0) throw new Error(`员工 ${args.employeeNo || id} 未找到`);
        const emp = rows[0]!;
        let departmentName: string | null = null;
        if (emp.departmentId) {
          const d = await db
            .select({ name: sysDepartments.name })
            .from(sysDepartments)
            .where(and(eq(sysDepartments.id, emp.departmentId), isNull(sysDepartments.deletedAt)))
            .limit(1);
          departmentName = d[0]?.name ?? null;
        }
        return { ...emp, departmentName };
      },
    },

    create_employee: {
      description:
        '【写入】创建新员工并写入数据库。必须提供 employeeNo（工号）和 name（姓名）。可选 departmentId、position、phone、email、status、entryDate。用户要求"新增/创建员工"时必须调用此工具。',
      parameters: {
        type: 'object',
        properties: {
          employeeNo: { type: 'string', description: '工号（唯一）' },
          name: { type: 'string', description: '姓名' },
          departmentId: { type: 'string', description: '部门 UUID（可选）' },
          position: { type: 'string', description: '职位（可选）' },
          phone: { type: 'string', description: '手机号（可选）' },
          email: { type: 'string', description: '邮箱（可选）' },
          status: { type: 'number', description: '状态: 1=在职(默认), 2=离职, 3=休假' },
          entryDate: { type: 'string', description: '入职日期，格式 YYYY-MM-DD（可选）' },
        },
        required: ['employeeNo', 'name'],
      },
      execute: async (args: any) => {
        // Check employeeNo uniqueness
        const exist = await db
          .select({ id: sysEmployees.id })
          .from(sysEmployees)
          .where(and(eq(sysEmployees.employeeNo, args.employeeNo), isNull(sysEmployees.deletedAt)))
          .limit(1);
        if (exist.length) throw new Error(`工号 "${args.employeeNo}" 已存在`);
        const rows = await db
          .insert(sysEmployees)
          .values({
            employeeNo: args.employeeNo,
            name: args.name,
            departmentId: args.departmentId ?? null,
            position: args.position ?? null,
            phone: args.phone ?? null,
            email: args.email ?? null,
            status: args.status !== undefined ? (args.status as 1 | 2 | 3) : 1,
            entryDate: args.entryDate ? new Date(args.entryDate) : null,
          })
          .returning({ id: sysEmployees.id, employeeNo: sysEmployees.employeeNo, name: sysEmployees.name });
        return { created: rows[0]! };
      },
    },

    update_employee: {
      description: '【写入】更新员工信息。可修改工号、姓名、部门、职位、手机、邮箱、状态、入职/离职日期。需先获取目标员工的 id。',
      parameters: {
        type: 'object',
        properties: {
          id: { type: 'string', description: 'Employee UUID (必填)' },
          employeeNo: { type: 'string', description: '新工号' },
          name: { type: 'string', description: '新姓名' },
          departmentId: { type: 'string', description: '部门 UUID' },
          position: { type: 'string', description: '新职位' },
          phone: { type: 'string', description: '新手机号' },
          email: { type: 'string', description: '新邮箱' },
          status: { type: 'number', description: '状态: 1=在职, 2=离职, 3=休假' },
          entryDate: { type: 'string', description: '入职日期 YYYY-MM-DD' },
          leaveDate: { type: 'string', description: '离职日期 YYYY-MM-DD（设状态为2时建议同时设置）' },
        },
        required: ['id'],
      },
      execute: async (args: any) => {
        const exist = await db
          .select({ id: sysEmployees.id })
          .from(sysEmployees)
          .where(and(eq(sysEmployees.id, args.id), isNull(sysEmployees.deletedAt)))
          .limit(1);
        if (exist.length === 0) throw new Error(`员工 ${args.id} 未找到`);
        const data: Record<string, unknown> = { updatedAt: new Date() };
        if (args.employeeNo !== undefined) data.employeeNo = args.employeeNo;
        if (args.name !== undefined) data.name = args.name;
        if (args.departmentId !== undefined) data.departmentId = args.departmentId ?? null;
        if (args.position !== undefined) data.position = args.position;
        if (args.phone !== undefined) data.phone = args.phone;
        if (args.email !== undefined) data.email = args.email;
        if (args.status !== undefined) data.status = args.status;
        if (args.entryDate !== undefined) data.entryDate = args.entryDate ? new Date(args.entryDate) : null;
        if (args.leaveDate !== undefined) data.leaveDate = args.leaveDate ? new Date(args.leaveDate) : null;
        await db
          .update(sysEmployees)
          .set(data)
          .where(and(eq(sysEmployees.id, args.id), isNull(sysEmployees.deletedAt)));
        return { updated: args.id };
      },
    },

    delete_employee: {
      description: '【写入】软删除员工（设置 deleted_at）。⚠️ 不可逆。推荐使用 employeeNo（如 SALE-001），id 为备选。',
      parameters: {
        type: 'object',
        properties: {
          id: { type: 'string', description: 'Employee UUID（备选，推荐使用 employeeNo）' },
          employeeNo: { type: 'string', description: '工号，如 SALE-001（推荐，人类可读，不易出错）' },
        },
        required: [],
      },
      execute: async (args: any) => {
        const id = args.id || await resolveEmployeeId(db, args.employeeNo);
        if (!id) throw new Error('请提供 id 或 employeeNo');
        const exist = await db
          .select({ id: sysEmployees.id, name: sysEmployees.name, employeeNo: sysEmployees.employeeNo })
          .from(sysEmployees)
          .where(and(eq(sysEmployees.id, id), isNull(sysEmployees.deletedAt)))
          .limit(1);
        if (exist.length === 0) throw new Error(`员工 ${args.employeeNo || args.id} 未找到`);
        await db
          .update(sysEmployees)
          .set({ deletedAt: sql`NOW()` })
          .where(and(eq(sysEmployees.id, id), isNull(sysEmployees.deletedAt)));
        return { deleted: id, name: exist[0]!.name, employeeNo: exist[0]!.employeeNo };
      },
    },

    list_departments_options: {
      description: '【查询】列出所有部门（树形层级结构，含 children 字段显示父子关系）。用于了解组织架构、选择员工所属部门。',
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
  };
}
