import { Injectable, Inject, NotFoundException, ConflictException } from '@nestjs/common';
import { eq, and, isNull, like, or, count, ilike, sql } from 'drizzle-orm';
import { DATABASE_CONNECTION, DrizzleDb } from '../../db/connection';
import { sysEmployees, SysEmployee } from '../../db/schema/sys-employees';
import { sysDepartments } from '../../db/schema/sys-departments';
import { CreateEmployeeDto } from './dto/create-employee.dto';
import { UpdateEmployeeDto } from './dto/update-employee.dto';
import { QueryEmployeeDto } from './dto/query-employee.dto';

export interface EmployeeRow extends SysEmployee {
  departmentName: string | null;
}

@Injectable()
export class EmployeeService {
  constructor(@Inject(DATABASE_CONNECTION) private readonly db: DrizzleDb) {}

  async findAll(query: QueryEmployeeDto): Promise<{ list: EmployeeRow[]; total: number; page: number; pageSize: number }> {
    const { keyword, departmentId, status } = query;
    const page = query.page ?? 1;
    const pageSize = query.pageSize ?? 20;
    const offset = (page - 1) * pageSize;

    const conditions = [isNull(sysEmployees.deletedAt)];

    if (keyword) {
      conditions.push(
        or(
          ilike(sysEmployees.name, `%${keyword}%`),
          ilike(sysEmployees.employeeNo, `%${keyword}%`),
        )!,
      );
    }
    if (departmentId) {
      conditions.push(eq(sysEmployees.departmentId, departmentId));
    }
    if (status !== undefined) {
      conditions.push(eq(sysEmployees.status, status));
    }

    const whereClause = and(...conditions);

    const [rows, totalRows] = await Promise.all([
      this.db
        .select({
          id: sysEmployees.id,
          employeeNo: sysEmployees.employeeNo,
          name: sysEmployees.name,
          departmentId: sysEmployees.departmentId,
          position: sysEmployees.position,
          phone: sysEmployees.phone,
          email: sysEmployees.email,
          status: sysEmployees.status,
          entryDate: sysEmployees.entryDate,
          leaveDate: sysEmployees.leaveDate,
          createdAt: sysEmployees.createdAt,
          updatedAt: sysEmployees.updatedAt,
          deletedAt: sysEmployees.deletedAt,
          departmentName: sysDepartments.name,
        })
        .from(sysEmployees)
        .leftJoin(sysDepartments, eq(sysEmployees.departmentId, sysDepartments.id))
        .where(whereClause)
        .orderBy(sysEmployees.employeeNo)
        .limit(pageSize)
        .offset(offset),
      this.db
        .select({ count: count() })
        .from(sysEmployees)
        .where(whereClause),
    ]);

    const total = totalRows[0]?.count ?? 0;

    return { list: rows as unknown as EmployeeRow[], total, page, pageSize };
  }

  async findOne(id: string): Promise<EmployeeRow> {
    const rows = await this.db
      .select({
        id: sysEmployees.id,
        employeeNo: sysEmployees.employeeNo,
        name: sysEmployees.name,
        departmentId: sysEmployees.departmentId,
        position: sysEmployees.position,
        phone: sysEmployees.phone,
        email: sysEmployees.email,
        status: sysEmployees.status,
        entryDate: sysEmployees.entryDate,
        leaveDate: sysEmployees.leaveDate,
        createdAt: sysEmployees.createdAt,
        updatedAt: sysEmployees.updatedAt,
        deletedAt: sysEmployees.deletedAt,
        departmentName: sysDepartments.name,
      })
      .from(sysEmployees)
      .leftJoin(sysDepartments, eq(sysEmployees.departmentId, sysDepartments.id))
      .where(and(eq(sysEmployees.id, id), isNull(sysEmployees.deletedAt)))
      .limit(1);

    if (rows.length === 0) {
      throw new NotFoundException('Employee not found');
    }

    return rows[0] as unknown as EmployeeRow;
  }

  async create(dto: CreateEmployeeDto): Promise<SysEmployee> {
    const existing = await this.db
      .select({ id: sysEmployees.id })
      .from(sysEmployees)
      .where(and(eq(sysEmployees.employeeNo, dto.employeeNo), isNull(sysEmployees.deletedAt)))
      .limit(1);

    if (existing.length > 0) {
      throw new ConflictException(`Employee with no '${dto.employeeNo}' already exists`);
    }

    const rows = await this.db
      .insert(sysEmployees)
      .values({
        employeeNo: dto.employeeNo,
        name: dto.name,
        departmentId: dto.departmentId ?? null,
        position: dto.position ?? null,
        phone: dto.phone ?? null,
        email: dto.email ?? null,
        status: (dto.status ?? 1) as 1 | 2 | 3,
        entryDate: dto.entryDate ? new Date(dto.entryDate) : null,
        leaveDate: dto.leaveDate ? new Date(dto.leaveDate) : null,
      })
      .returning();

    return rows[0]!;
  }

  async update(id: string, dto: UpdateEmployeeDto): Promise<SysEmployee> {
    await this.findOne(id);

    if (dto.employeeNo) {
      const conflict = await this.db
        .select({ id: sysEmployees.id })
        .from(sysEmployees)
        .where(and(eq(sysEmployees.employeeNo, dto.employeeNo), isNull(sysEmployees.deletedAt)))
        .limit(1);

      if (conflict.length > 0 && conflict[0]!.id !== id) {
        throw new ConflictException(`Employee with no '${dto.employeeNo}' already exists`);
      }
    }

    const updateData: Record<string, unknown> = { updatedAt: new Date() };
    if (dto.employeeNo !== undefined) updateData.employeeNo = dto.employeeNo;
    if (dto.name !== undefined) updateData.name = dto.name;
    if (dto.departmentId !== undefined) updateData.departmentId = dto.departmentId ?? null;
    if (dto.position !== undefined) updateData.position = dto.position ?? null;
    if (dto.phone !== undefined) updateData.phone = dto.phone ?? null;
    if (dto.email !== undefined) updateData.email = dto.email ?? null;
    if (dto.status !== undefined) updateData.status = dto.status as 1 | 2 | 3;
    if (dto.entryDate !== undefined) updateData.entryDate = dto.entryDate ? new Date(dto.entryDate) : null;
    if (dto.leaveDate !== undefined) updateData.leaveDate = dto.leaveDate ? new Date(dto.leaveDate) : null;

    const rows = await this.db
      .update(sysEmployees)
      .set(updateData)
      .where(and(eq(sysEmployees.id, id), isNull(sysEmployees.deletedAt)))
      .returning();

    return rows[0]!;
  }

  async remove(id: string): Promise<void> {
    await this.findOne(id);
    await this.db
      .update(sysEmployees)
      .set({ deletedAt: sql`NOW()` })
      .where(and(eq(sysEmployees.id, id), isNull(sysEmployees.deletedAt)));
  }

  /** Lightweight list for dropdowns (id + name only, active employees). */
  async listOptions(keyword?: string): Promise<{ id: string; name: string; employeeNo: string }[]> {
    const conds = [isNull(sysEmployees.deletedAt), eq(sysEmployees.status, 1)];
    const rows = await this.db
      .select({ id: sysEmployees.id, name: sysEmployees.name, employeeNo: sysEmployees.employeeNo })
      .from(sysEmployees)
      .where(and(...conds))
      .orderBy(sysEmployees.employeeNo)
      .limit(500);
    return rows;
  }
}
