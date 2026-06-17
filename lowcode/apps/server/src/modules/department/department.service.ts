import {
  Injectable,
  Inject,
  NotFoundException,
  ConflictException,
} from '@nestjs/common';
import { eq, and, isNull, like, sql, count, inArray, gte, lte, desc } from 'drizzle-orm';
import { DATABASE_CONNECTION, DrizzleDb } from '../../db/connection';
import { departments, Departments } from '../../db/schema/departments';
import { CreateDepartmentDto } from './dto/create-department.dto';
import { UpdateDepartmentDto } from './dto/update-department.dto';
import { QueryDepartmentDto } from './dto/query-department.dto';
import { ApiErrorCode, PaginatedData } from '@lowcode/shared';
import { SQL } from 'drizzle-orm';

@Injectable()
export class DepartmentService {
  constructor(
    @Inject(DATABASE_CONNECTION) private readonly db: DrizzleDb,
  ) {}

  async findAll(query: QueryDepartmentDto): Promise<PaginatedData<Departments>> {
    const { page, pageSize, name, manager_name } = query;
    const offset = (page - 1) * pageSize;

    const conditions: SQL[] = [isNull(departments.deletedAt)];

    if (name) {
      conditions.push(like(departments.name, `%${name}%`));
    }
    if (manager_name) {
      conditions.push(like(departments.manager_name, `%${manager_name}%`));
    }

    const whereClause = and(...conditions);

    const [rows, totalRows] = await Promise.all([
      this.db
        .select()
        .from(departments)
        .where(whereClause)
        .orderBy(desc(departments.createdAt))
        .limit(pageSize)
        .offset(offset),
      this.db
        .select({ count: count() })
        .from(departments)
        .where(whereClause),
    ]);

    const total = totalRows[0]?.count ?? 0;

    return { list: rows, total, page, pageSize };
  }

  async findOne(id: string): Promise<Departments> {
    const rows = await this.db
      .select()
      .from(departments)
      .where(and(eq(departments.id, id), isNull(departments.deletedAt)))
      .limit(1);

    if (rows.length === 0) {
      throw new NotFoundException({
        code: ApiErrorCode.RESOURCE_NOT_FOUND,
        message: `Department with id ${id} not found`,
      });
    }

    return rows[0]!;
  }

  async create(dto: CreateDepartmentDto): Promise<Departments> {
    // Check unique: name
    const existingByName = await this.db
      .select()
      .from(departments)
      .where(and(eq(departments.name, dto.name), isNull(departments.deletedAt)))
      .limit(1);

    if (existingByName.length > 0) {
      throw new ConflictException({
        code: ApiErrorCode.PARAM_ERROR,
        message: `Name '${dto.name}' is already taken`,
      });
    }

    const rows = await this.db
      .insert(departments)
      .values({
        name: dto.name,
        manager_name: dto.manager_name,
        phone: dto.phone,
        description: dto.description,
      })
      .returning();
    return rows[0]!;

  }

  async update(id: string, dto: UpdateDepartmentDto): Promise<Departments> {
    const existing = await this.findOne(id);

    if (dto.name && dto.name !== existing.name) {
      const nameConflict = await this.db
        .select()
        .from(departments)
        .where(and(eq(departments.name, dto.name), isNull(departments.deletedAt)))
        .limit(1);

      if (nameConflict.length > 0) {
        throw new ConflictException({
          code: ApiErrorCode.PARAM_ERROR,
          message: `Name '${dto.name}' is already taken`,
        });
      }
    }

    type DepartmentUpdateFields = {
      name?: string;
      manager_name?: string;
      phone?: string;
      description?: string;
      updatedAt?: Date;
    };

    const updateData: DepartmentUpdateFields = {
      updatedAt: new Date(),
    };

    if (dto.name !== undefined) updateData.name = dto.name;
    if (dto.manager_name !== undefined) updateData.manager_name = dto.manager_name;
    if (dto.phone !== undefined) updateData.phone = dto.phone;
    if (dto.description !== undefined) updateData.description = dto.description;

    const rows = await this.db
      .update(departments)
      .set(updateData)
      .where(and(eq(departments.id, id), isNull(departments.deletedAt)))
      .returning();


    return rows[0]!;
  }

  async remove(id: string): Promise<void> {
    await this.findOne(id);


    await this.db
      .update(departments)
      .set({ deletedAt: sql`NOW()` })
      .where(and(eq(departments.id, id), isNull(departments.deletedAt)));
  }

  async batchRemove(ids: string[]): Promise<{ count: number }> {

    const rows = await this.db
      .update(departments)
      .set({ deletedAt: sql`NOW()` })
      .where(and(inArray(departments.id, ids), isNull(departments.deletedAt)))
      .returning({ id: departments.id });

    return { count: rows.length };
  }

}
