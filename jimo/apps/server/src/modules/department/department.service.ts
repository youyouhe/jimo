import {
  Injectable,
  Inject,
  NotFoundException,
  ConflictException,
} from '@nestjs/common';
import { eq, and, isNull, like, sql, count, inArray, desc, getTableColumns, SQL } from 'drizzle-orm';
import { alias } from 'drizzle-orm/pg-core';
import { DATABASE_CONNECTION, DrizzleDb } from '../../db/connection';
import { sysDepartments, SysDepartment } from '../../db/schema/sys-departments';
import { sysUsers } from '../../db/schema/users';
import { CreateDepartmentDto } from './dto/create-department.dto';
import { UpdateDepartmentDto } from './dto/update-department.dto';
import { QueryDepartmentDto } from './dto/query-department.dto';
import { ApiErrorCode, PaginatedData } from '@jimo/shared';
import { BpmOrgSyncService } from '../bpm-sync/bpm-org-sync.service';

@Injectable()
export class DepartmentService {
  constructor(
    @Inject(DATABASE_CONNECTION) private readonly db: DrizzleDb,
    private readonly bpmSync: BpmOrgSyncService,
  ) {}

  private withDisplay() {
    const parent_alias = alias(sysDepartments, 'parent_alias');
    const lead_alias = alias(sysUsers, 'lead_alias');
    return this.db
      .select({
        ...getTableColumns(sysDepartments),
        parent_id_display: parent_alias.name,
        lead_display: lead_alias.nickname,
      })
      .from(sysDepartments)
      .leftJoin(parent_alias, eq(sysDepartments.parentId, parent_alias.id))
      .leftJoin(lead_alias, eq(sysDepartments.leadId, lead_alias.id));
  }

  async findAll(query: QueryDepartmentDto): Promise<PaginatedData<SysDepartment>> {
    const { page, pageSize, name, code } = query;
    const offset = (page - 1) * pageSize;

    const conditions: SQL[] = [isNull(sysDepartments.deletedAt)];
    if (name) conditions.push(like(sysDepartments.name, `%${name}%`));
    if (code) conditions.push(like(sysDepartments.code, `%${code}%`));
    const whereClause = and(...conditions);

    const [rows, totalRows] = await Promise.all([
      this.withDisplay()
        .where(whereClause)
        .orderBy(desc(sysDepartments.createdAt))
        .limit(pageSize)
        .offset(offset),
      this.db.select({ count: count() }).from(sysDepartments).where(whereClause),
    ]);

    const total = totalRows[0]?.count ?? 0;
    return { list: rows, total, page, pageSize };
  }

  async findOne(id: string): Promise<SysDepartment> {
    const rows = await this.withDisplay()
      .where(and(eq(sysDepartments.id, id), isNull(sysDepartments.deletedAt)))
      .limit(1);

    if (rows.length === 0) {
      throw new NotFoundException({
        code: ApiErrorCode.RESOURCE_NOT_FOUND,
        message: `Department with id ${id} not found`,
      });
    }
    return rows[0]!;
  }

  async create(dto: CreateDepartmentDto): Promise<SysDepartment> {
    const existingByCode = await this.db
      .select()
      .from(sysDepartments)
      .where(and(eq(sysDepartments.code, dto.code), isNull(sysDepartments.deletedAt)))
      .limit(1);

    if (existingByCode.length > 0) {
      throw new ConflictException({
        code: ApiErrorCode.PARAM_ERROR,
        message: `Code '${dto.code}' is already taken`,
      });
    }

    const rows = await this.db
      .insert(sysDepartments)
      .values({
        name: dto.name,
        code: dto.code,
        description: dto.description,
        parentId: dto.parentId,
        leadId: dto.leadId,
      })
      .returning();
    const created = rows[0]!;
    await this.bpmSync.syncDept(created.id);
    return created;
  }

  async update(id: string, dto: UpdateDepartmentDto): Promise<SysDepartment> {
    const existing = await this.findOne(id);

    if (dto.code && dto.code !== existing.code) {
      const codeConflict = await this.db
        .select()
        .from(sysDepartments)
        .where(and(eq(sysDepartments.code, dto.code), isNull(sysDepartments.deletedAt)))
        .limit(1);
      if (codeConflict.length > 0) {
        throw new ConflictException({
          code: ApiErrorCode.PARAM_ERROR,
          message: `Code '${dto.code}' is already taken`,
        });
      }
    }

    const updateData: {
      name?: string;
      code?: string;
      description?: string;
      parentId?: string | null;
      leadId?: string | null;
      updatedAt?: Date;
    } = { updatedAt: new Date() };

    if (dto.name !== undefined) updateData.name = dto.name;
    if (dto.code !== undefined) updateData.code = dto.code;
    if (dto.description !== undefined) updateData.description = dto.description;
    if (dto.parentId !== undefined) updateData.parentId = dto.parentId ?? null;
    if (dto.leadId !== undefined) updateData.leadId = dto.leadId ?? null;

    const rows = await this.db
      .update(sysDepartments)
      .set(updateData)
      .where(and(eq(sysDepartments.id, id), isNull(sysDepartments.deletedAt)))
      .returning();

    await this.bpmSync.syncDept(id);
    return rows[0]!;
  }

  async remove(id: string): Promise<void> {
    const existing = await this.findOne(id);
    await this.db
      .update(sysDepartments)
      .set({ deletedAt: sql`NOW()` })
      .where(and(eq(sysDepartments.id, id), isNull(sysDepartments.deletedAt)));
    await this.bpmSync.deleteDept(existing.code);
  }

  async batchRemove(ids: string[]): Promise<{ count: number }> {
    // Capture codes before soft-delete so BPM can be cleaned up too.
    const targets = await this.db
      .select({ id: sysDepartments.id, code: sysDepartments.code })
      .from(sysDepartments)
      .where(and(inArray(sysDepartments.id, ids), isNull(sysDepartments.deletedAt)));

    const rows = await this.db
      .update(sysDepartments)
      .set({ deletedAt: sql`NOW()` })
      .where(and(inArray(sysDepartments.id, ids), isNull(sysDepartments.deletedAt)))
      .returning({ id: sysDepartments.id });

    for (const t of targets) {
      await this.bpmSync.deleteDept(t.code);
    }
    return { count: rows.length };
  }
}
