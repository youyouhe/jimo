import {
  Injectable,
  Inject,
  NotFoundException,
  ConflictException,
} from '@nestjs/common';
import { eq, and, isNull, like, sql, count, inArray, gte, lte, desc, getTableColumns } from 'drizzle-orm';
import { alias } from 'drizzle-orm/pg-core';
import { DATABASE_CONNECTION, DrizzleDb } from '../../db/connection';
import { departments, Departments } from '../../db/schema/departments';
import { CreateDepartmentDto } from './dto/create-department.dto';
import { UpdateDepartmentDto } from './dto/update-department.dto';
import { QueryDepartmentDto } from './dto/query-department.dto';
import { ApiErrorCode, PaginatedData } from '@jimo/shared';
import { SQL } from 'drizzle-orm';

@Injectable()
export class DepartmentService {
  constructor(
    @Inject(DATABASE_CONNECTION) private readonly db: DrizzleDb,
  ) {}

  async findAll(query: QueryDepartmentDto): Promise<PaginatedData<Departments>> {
    const { page, pageSize, name, code } = query;
    const offset = (page - 1) * pageSize;

    const conditions: SQL[] = [isNull(departments.deletedAt)];

    if (name) {
      conditions.push(like(departments.name, `%${name}%`));
    }
    if (code) {
      conditions.push(like(departments.code, `%${code}%`));
    }

    const whereClause = and(...conditions);
    const parent_alias = alias(departments, 'parent_alias');

    const [rows, totalRows] = await Promise.all([
      this.db
        .select({
          ...getTableColumns(departments),
      parent_id_display: parent_alias.name,
        })
        .from(departments)
        .leftJoin(parent_alias, eq(departments.parent_id, parent_alias.id))
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
    const parent_alias = alias(departments, 'parent_alias');
    const rows = await this.db
      .select({
        ...getTableColumns(departments),
      parent_id_display: parent_alias.name,
      })
      .from(departments)
        .leftJoin(parent_alias, eq(departments.parent_id, parent_alias.id))
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
    // Check unique: code
    const existingByCode = await this.db
      .select()
      .from(departments)
      .where(and(eq(departments.code, dto.code), isNull(departments.deletedAt)))
      .limit(1);

    if (existingByCode.length > 0) {
      throw new ConflictException({
        code: ApiErrorCode.PARAM_ERROR,
        message: `Code '${dto.code}' is already taken`,
      });
    }

    const rows = await this.db
      .insert(departments)
      .values({
        name: dto.name,
        code: dto.code,
        description: dto.description,
        parent_id: dto.parent_id,
      })
      .returning();
    return rows[0]!;

  }

  async update(id: string, dto: UpdateDepartmentDto): Promise<Departments> {
    const existing = await this.findOne(id);

    if (dto.code && dto.code !== existing.code) {
      const codeConflict = await this.db
        .select()
        .from(departments)
        .where(and(eq(departments.code, dto.code), isNull(departments.deletedAt)))
        .limit(1);

      if (codeConflict.length > 0) {
        throw new ConflictException({
          code: ApiErrorCode.PARAM_ERROR,
          message: `Code '${dto.code}' is already taken`,
        });
      }
    }

    type DepartmentUpdateFields = {
      name?: string;
      code?: string;
      description?: string;
      parent_id?: string;
      updatedAt?: Date;
    };

    const updateData: DepartmentUpdateFields = {
      updatedAt: new Date(),
    };

    if (dto.name !== undefined) updateData.name = dto.name;
    if (dto.code !== undefined) updateData.code = dto.code;
    if (dto.description !== undefined) updateData.description = dto.description;
    if (dto.parent_id !== undefined) updateData.parent_id = dto.parent_id ?? undefined;

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
