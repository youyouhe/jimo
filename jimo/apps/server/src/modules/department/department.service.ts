import {
  Injectable,
  Inject,
  NotFoundException,
  ConflictException,
} from '@nestjs/common';
import { eq, and, isNull, like, sql, count, inArray, gte, lte, desc } from 'drizzle-orm';
import { DATABASE_CONNECTION, DrizzleDb } from '../../db/connection';
import { OwnershipHelper } from '../../common/ownership/ownership.helper';
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
    private readonly ownershipHelper: OwnershipHelper,
  ) {}

  async findAll(query: QueryDepartmentDto, userId?: string, isAdmin: boolean = false): Promise<PaginatedData<Departments>> {
    const { page, pageSize, code, name, sort_orderMin, sort_orderMax, is_enabled } = query;
    const offset = (page - 1) * pageSize;

    const conditions: SQL[] = [isNull(departments.deletedAt)];
    const _ownership = this.ownershipHelper.visibleCondition(departments.ownerId, departments.sharedWith, userId, isAdmin, 'private');
    if (_ownership) conditions.push(_ownership);

    if (code) {
      conditions.push(like(departments.code, `%${code}%`));
    }
    if (name) {
      conditions.push(like(departments.name, `%${name}%`));
    }
    if (sort_orderMin) {
      conditions.push(gte(departments.sort_order, sort_orderMin));
    }
    if (sort_orderMax) {
      conditions.push(lte(departments.sort_order, sort_orderMax));
    }
    if (is_enabled !== undefined && is_enabled !== null && is_enabled !== '') {
      conditions.push(eq(departments.is_enabled, is_enabled === 'true'));
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

    const list = rows;
    return { list, total, page, pageSize };
  }

  async findOne(id: string, userId?: string, isAdmin: boolean = false): Promise<Departments> {
    const conditions = [eq(departments.id, id), isNull(departments.deletedAt)];
    const _ownership = this.ownershipHelper.visibleCondition(departments.ownerId, departments.sharedWith, userId, isAdmin, 'private');
    if (_ownership) conditions.push(_ownership);
    const rows = await this.db
      .select()
      .from(departments)
      .where(and(...conditions))
      .limit(1);

    if (rows.length === 0) {
      throw new NotFoundException({
        code: ApiErrorCode.RESOURCE_NOT_FOUND,
        message: `Department with id ${id} not found`,
      });
    }

    return rows[0]!;
  }


  async create(dto: CreateDepartmentDto, userId?: string): Promise<Departments> {
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
        ownerId: userId,
        code: dto.code,
        name: dto.name,
        sort_order: dto.sort_order,
        is_enabled: dto.is_enabled,
      })
      .returning();
    return rows[0]!;

  }

  async update(id: string, dto: UpdateDepartmentDto, userId?: string, isAdmin: boolean = false): Promise<Departments> {
    const existing = await this.findOne(id, userId, isAdmin);

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
      code?: string;
      name?: string;
      sort_order?: number;
      is_enabled?: boolean;
      updatedAt?: Date;
    };

    const updateData: DepartmentUpdateFields = {
      updatedAt: new Date(),
    };

    if (dto.code !== undefined) updateData.code = dto.code;
    if (dto.name !== undefined) updateData.name = dto.name;
    if (dto.sort_order !== undefined) updateData.sort_order = dto.sort_order;
    if (dto.is_enabled !== undefined) updateData.is_enabled = dto.is_enabled;

    const rows = await this.db
      .update(departments)
      .set(updateData)
      .where(
        isAdmin
          ? and(eq(departments.id, id), isNull(departments.deletedAt))
          : and(eq(departments.id, id), isNull(departments.deletedAt), eq(departments.ownerId, userId!)),
      )
      .returning();


    return rows[0]!;
  }

  async remove(id: string, userId?: string, isAdmin: boolean = false): Promise<void> {
    await this.findOne(id, userId, isAdmin);


    await this.db
      .update(departments)
      .set({ deletedAt: sql`NOW()` })
      .where(
        isAdmin
          ? and(eq(departments.id, id), isNull(departments.deletedAt))
          : and(eq(departments.id, id), isNull(departments.deletedAt), eq(departments.ownerId, userId!)),
      );
  }

  async batchRemove(ids: string[], userId?: string, isAdmin: boolean = false): Promise<{ count: number }> {

    const rows = await this.db
      .update(departments)
      .set({ deletedAt: sql`NOW()` })
      .where(
        isAdmin
          ? and(inArray(departments.id, ids), isNull(departments.deletedAt))
          : and(inArray(departments.id, ids), isNull(departments.deletedAt), eq(departments.ownerId, userId!)),
      )
      .returning({ id: departments.id });

    return { count: rows.length };
  }

}
