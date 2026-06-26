import {
  Injectable,
  Inject,
  NotFoundException,
  ConflictException,
} from '@nestjs/common';
import { eq, and, isNull, like, sql, count, inArray, gte, lte, desc, getTableColumns } from 'drizzle-orm';
import { alias } from 'drizzle-orm/pg-core';
import { DATABASE_CONNECTION, DrizzleDb } from '../../db/connection';
import { OwnershipHelper } from '../../common/ownership/ownership.helper';
import { regions, Regions } from '../../db/schema/regions';
import { CreateRegionDto } from './dto/create-region.dto';
import { UpdateRegionDto } from './dto/update-region.dto';
import { QueryRegionDto } from './dto/query-region.dto';
import { ApiErrorCode, PaginatedData } from '@jimo/shared';
import { SQL } from 'drizzle-orm';

@Injectable()
export class RegionService {
  constructor(
    @Inject(DATABASE_CONNECTION) private readonly db: DrizzleDb,
    private readonly ownershipHelper: OwnershipHelper,
  ) {}

  async findAll(query: QueryRegionDto, userId?: string, isAdmin: boolean = false): Promise<PaginatedData<Regions>> {
    const { page, pageSize, name, code, level } = query;
    const offset = (page - 1) * pageSize;

    const conditions: SQL[] = [isNull(regions.deletedAt)];
    const _ownership = this.ownershipHelper.visibleCondition(regions.ownerId, regions.sharedWith, userId, isAdmin, 'public');
    if (_ownership) conditions.push(_ownership);

    if (name) {
      conditions.push(like(regions.name, `%${name}%`));
    }
    if (code) {
      conditions.push(like(regions.code, `%${code}%`));
    }
    if (level) {
      conditions.push(like(regions.level, `%${level}%`));
    }

    const whereClause = and(...conditions);
    const parent_alias = alias(regions, 'parent_alias');

    const [rows, totalRows] = await Promise.all([
      this.db
        .select({
          ...getTableColumns(regions),
      parent_id_display: parent_alias.name,
        })
        .from(regions)
        .leftJoin(parent_alias, eq(regions.parent_id, parent_alias.id))
        .where(whereClause)
        .orderBy(desc(regions.createdAt))
        .limit(pageSize)
        .offset(offset),
      this.db
        .select({ count: count() })
        .from(regions)
        .where(whereClause),
    ]);

    const total = totalRows[0]?.count ?? 0;

    return { list: rows, total, page, pageSize };
  }

  async findOne(id: string, userId?: string, isAdmin: boolean = false): Promise<Regions> {
    const conditions = [eq(regions.id, id), isNull(regions.deletedAt)];
    const _ownership = this.ownershipHelper.visibleCondition(regions.ownerId, regions.sharedWith, userId, isAdmin, 'public');
    if (_ownership) conditions.push(_ownership);
    const parent_alias = alias(regions, 'parent_alias');
    const rows = await this.db
      .select({
        ...getTableColumns(regions),
      parent_id_display: parent_alias.name,
      })
      .from(regions)
        .leftJoin(parent_alias, eq(regions.parent_id, parent_alias.id))
      .where(and(...conditions))
      .limit(1);

    if (rows.length === 0) {
      throw new NotFoundException({
        code: ApiErrorCode.RESOURCE_NOT_FOUND,
        message: `Region with id ${id} not found`,
      });
    }

    return rows[0]!;
  }

  async create(dto: CreateRegionDto, userId?: string): Promise<Regions> {
    // Check unique: name
    const existingByName = await this.db
      .select()
      .from(regions)
      .where(and(eq(regions.name, dto.name), isNull(regions.deletedAt)))
      .limit(1);

    if (existingByName.length > 0) {
      throw new ConflictException({
        code: ApiErrorCode.PARAM_ERROR,
        message: `Name '${dto.name}' is already taken`,
      });
    }
    // Check unique: code (only if value provided)
    if (dto.code) {
      const existingByCode = await this.db
        .select()
        .from(regions)
        .where(and(eq(regions.code, dto.code!), isNull(regions.deletedAt)))
        .limit(1);

      if (existingByCode.length > 0) {
        throw new ConflictException({
          code: ApiErrorCode.PARAM_ERROR,
          message: `Code '${dto.code}' is already taken`,
        });
      }
    }

    const rows = await this.db
      .insert(regions)
      .values({
        ownerId: userId,
        name: dto.name,
        code: dto.code,
        parent_id: dto.parent_id,
        level: dto.level,
        remark: dto.remark,
      })
      .returning();
    return rows[0]!;

  }

  async update(id: string, dto: UpdateRegionDto, userId?: string, isAdmin: boolean = false): Promise<Regions> {
    const existing = await this.findOne(id, userId, isAdmin);

    if (dto.name && dto.name !== existing.name) {
      const nameConflict = await this.db
        .select()
        .from(regions)
        .where(and(eq(regions.name, dto.name), isNull(regions.deletedAt)))
        .limit(1);

      if (nameConflict.length > 0) {
        throw new ConflictException({
          code: ApiErrorCode.PARAM_ERROR,
          message: `Name '${dto.name}' is already taken`,
        });
      }
    }
    if (dto.code && dto.code !== existing.code) {
      const codeConflict = await this.db
        .select()
        .from(regions)
        .where(and(eq(regions.code, dto.code), isNull(regions.deletedAt)))
        .limit(1);

      if (codeConflict.length > 0) {
        throw new ConflictException({
          code: ApiErrorCode.PARAM_ERROR,
          message: `Code '${dto.code}' is already taken`,
        });
      }
    }

    type RegionUpdateFields = {
      name?: string;
      code?: string;
      parent_id?: string;
      level?: string;
      remark?: string;
      updatedAt?: Date;
    };

    const updateData: RegionUpdateFields = {
      updatedAt: new Date(),
    };

    if (dto.name !== undefined) updateData.name = dto.name;
    if (dto.code !== undefined) updateData.code = dto.code;
    if (dto.parent_id !== undefined) updateData.parent_id = dto.parent_id ?? undefined;
    if (dto.level !== undefined) updateData.level = dto.level;
    if (dto.remark !== undefined) updateData.remark = dto.remark;

    const rows = await this.db
      .update(regions)
      .set(updateData)
      .where(
        isAdmin
          ? and(eq(regions.id, id), isNull(regions.deletedAt))
          : and(eq(regions.id, id), isNull(regions.deletedAt), eq(regions.ownerId, userId!)),
      )
      .returning();


    return rows[0]!;
  }

  async remove(id: string, userId?: string, isAdmin: boolean = false): Promise<void> {
    await this.findOne(id, userId, isAdmin);


    await this.db
      .update(regions)
      .set({ deletedAt: sql`NOW()` })
      .where(
        isAdmin
          ? and(eq(regions.id, id), isNull(regions.deletedAt))
          : and(eq(regions.id, id), isNull(regions.deletedAt), eq(regions.ownerId, userId!)),
      );
  }

  async batchRemove(ids: string[], userId?: string, isAdmin: boolean = false): Promise<{ count: number }> {

    const rows = await this.db
      .update(regions)
      .set({ deletedAt: sql`NOW()` })
      .where(
        isAdmin
          ? and(inArray(regions.id, ids), isNull(regions.deletedAt))
          : and(inArray(regions.id, ids), isNull(regions.deletedAt), eq(regions.ownerId, userId!)),
      )
      .returning({ id: regions.id });

    return { count: rows.length };
  }

}
