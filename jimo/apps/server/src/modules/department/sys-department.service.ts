import { Injectable, Inject, NotFoundException, ConflictException } from '@nestjs/common';
import { eq, and, isNull, like, or, count, ilike, sql, inArray } from 'drizzle-orm';
import { DATABASE_CONNECTION, DrizzleDb } from '../../db/connection';
import { sysDepartments, SysDepartment } from '../../db/schema/sys-departments';
import { CreateDepartmentDto } from './dto/create-department.dto';
import { UpdateDepartmentDto } from './dto/update-department.dto';
import { QueryDepartmentDto } from './dto/query-department.dto';

export interface SysDeptRow extends SysDepartment {
  parentName?: string | null;
  leadName?: string | null;
  parent_id_display?: string | null;
  lead_display?: string | null;
  children?: SysDeptRow[];
}

@Injectable()
export class SysDepartmentService {
  constructor(@Inject(DATABASE_CONNECTION) private readonly db: DrizzleDb) {}

  async findAll(query: QueryDepartmentDto): Promise<{ list: SysDeptRow[]; total: number; page: number; pageSize: number }> {
    const { page = 1, pageSize = 20, name, code } = query;
    const offset = (page - 1) * pageSize;

    const conditions = [isNull(sysDepartments.deletedAt)];
    if (name) conditions.push(ilike(sysDepartments.name, `%${name}%`));
    if (code) conditions.push(ilike(sysDepartments.code, `%${code}%`));

    const whereClause = and(...conditions);

    const [rows, totalRows] = await Promise.all([
      this.db.select().from(sysDepartments).where(whereClause).limit(pageSize).offset(offset),
      this.db.select({ count: count() }).from(sysDepartments).where(whereClause),
    ]);

    const total = totalRows[0]?.count ?? 0;

    // Resolve parent and lead display names
    const parentIds = [...new Set(rows.map((r) => r.parentId).filter(Boolean))] as string[];
    const leadIds = [...new Set(rows.map((r) => r.leadId).filter(Boolean))] as string[];
    const parentMap = new Map<string, string>();
    const leadMap = new Map<string, string>();

    if (parentIds.length) {
      const pRows = await this.db
        .select({ id: sysDepartments.id, name: sysDepartments.name })
        .from(sysDepartments)
        .where(and(inArray(sysDepartments.id, parentIds), isNull(sysDepartments.deletedAt)));
      for (const p of pRows) parentMap.set(p.id, p.name);
    }

    // leadId is a plain uuid pointing at sys_users — batch-resolve nicknames
    if (leadIds.length) {
      const { sysUsers } = await import('../../db/schema/users');
      const uRows = await this.db
        .select({ id: sysUsers.id, nickname: sysUsers.nickname })
        .from(sysUsers)
        .where(and(inArray(sysUsers.id, leadIds), isNull(sysUsers.deletedAt)));
      for (const u of uRows) leadMap.set(u.id, u.nickname);
    }

    const list: SysDeptRow[] = rows.map((r) => ({
      ...r,
      parent_id_display: (r.parentId && parentMap.get(r.parentId)) ?? null,
      lead_display: (r.leadId && leadMap.get(r.leadId)) ?? null,
    }));

    return { list, total, page, pageSize };
  }

  async findOne(id: string): Promise<SysDeptRow> {
    const rows = await this.db
      .select()
      .from(sysDepartments)
      .where(and(eq(sysDepartments.id, id), isNull(sysDepartments.deletedAt)))
      .limit(1);
    if (rows.length === 0) throw new NotFoundException(`Department ${id} not found`);
    return rows[0]!;
  }

  async create(dto: CreateDepartmentDto): Promise<SysDepartment> {
    if (dto.code) {
      const exist = await this.db
        .select({ id: sysDepartments.id })
        .from(sysDepartments)
        .where(and(eq(sysDepartments.code, dto.code), isNull(sysDepartments.deletedAt)))
        .limit(1);
      if (exist.length) throw new ConflictException(`Code '${dto.code}' already exists`);
    }
    const rows = await this.db
      .insert(sysDepartments)
      .values({
        name: dto.name,
        code: dto.code ?? '',
        description: dto.description ?? '',
        parentId: dto.parentId ?? null,
        leadId: dto.leadId ?? null,
      })
      .returning();
    return rows[0]!;
  }

  async update(id: string, dto: UpdateDepartmentDto): Promise<SysDepartment> {
    await this.findOne(id);
    const data: Record<string, unknown> = { updatedAt: new Date() };
    if (dto.name !== undefined) data.name = dto.name;
    if (dto.code !== undefined) data.code = dto.code;
    if (dto.description !== undefined) data.description = dto.description;
    if (dto.parentId !== undefined) data.parentId = dto.parentId ?? null;
    if (dto.leadId !== undefined) data.leadId = dto.leadId ?? null;
    const rows = await this.db
      .update(sysDepartments)
      .set(data)
      .where(and(eq(sysDepartments.id, id), isNull(sysDepartments.deletedAt)))
      .returning();
    return rows[0]!;
  }

  async remove(id: string): Promise<void> {
    await this.findOne(id);
    await this.db
      .update(sysDepartments)
      .set({ deletedAt: sql`NOW()` })
      .where(and(eq(sysDepartments.id, id), isNull(sysDepartments.deletedAt)));
  }

  async listOptions(): Promise<{ id: string; name: string }[]> {
    return this.db
      .select({ id: sysDepartments.id, name: sysDepartments.name })
      .from(sysDepartments)
      .where(isNull(sysDepartments.deletedAt))
      .orderBy(sysDepartments.name)
      .limit(500);
  }

  async listTree(): Promise<SysDeptRow[]> {
    const rows = await this.db
      .select()
      .from(sysDepartments)
      .where(isNull(sysDepartments.deletedAt))
      .orderBy(sysDepartments.name);
    return this.buildTree(rows, null);
  }

  private buildTree(items: SysDepartment[], parentId: string | null): SysDeptRow[] {
    const childrenMap = new Map<string | null, SysDepartment[]>();
    for (const item of items) {
      const key = item.parentId ?? null;
      if (!childrenMap.has(key)) childrenMap.set(key, []);
      childrenMap.get(key)!.push(item);
    }
    const build = (pid: string | null, visited = new Set<string | null>()): SysDeptRow[] => {
      if (visited.has(pid)) return [];
      const nextVisited = new Set(visited).add(pid);
      const children = childrenMap.get(pid) ?? [];
      return children.map((dept) => ({
        ...dept,
        parent_id_display: null,
        lead_display: null,
        children: build(dept.id, nextVisited) as any,
      } as SysDeptRow & { children: SysDeptRow[] }));
    };
    return build(parentId);
  }
}
