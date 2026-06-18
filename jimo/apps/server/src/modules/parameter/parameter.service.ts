import {
  Injectable,
  Inject,
  NotFoundException,
  ConflictException,
} from '@nestjs/common';
import { eq, and, isNull, like, sql, count, inArray } from 'drizzle-orm';
import { DATABASE_CONNECTION, DrizzleDb } from '../../db/connection';
import { sysParams, SysParam } from '../../db/schema/parameters';
import { CreateParamDto } from './dto/create-param.dto';
import { UpdateParamDto } from './dto/update-param.dto';
import { QueryParamDto } from './dto/query-param.dto';
import { ApiErrorCode, PaginatedData } from '@jimo/shared';
import { SQL } from 'drizzle-orm';

@Injectable()
export class ParameterService {
  constructor(
    @Inject(DATABASE_CONNECTION) private readonly db: DrizzleDb,
  ) {}

  async findAll(query: QueryParamDto): Promise<PaginatedData<SysParam>> {
    const { page, pageSize, name, key } = query;
    const offset = (page - 1) * pageSize;

    const conditions: SQL[] = [isNull(sysParams.deletedAt)];

    if (name) {
      conditions.push(like(sysParams.name, `%${name}%`));
    }
    if (key) {
      conditions.push(like(sysParams.key, `%${key}%`));
    }

    const whereClause = and(...conditions);

    const [rows, totalRows] = await Promise.all([
      this.db
        .select()
        .from(sysParams)
        .where(whereClause)
        .limit(pageSize)
        .offset(offset),
      this.db
        .select({ count: count() })
        .from(sysParams)
        .where(whereClause),
    ]);

    const total = totalRows[0]?.count ?? 0;

    return { list: rows, total, page, pageSize };
  }

  async findOne(id: string): Promise<SysParam> {
    const rows = await this.db
      .select()
      .from(sysParams)
      .where(and(eq(sysParams.id, id), isNull(sysParams.deletedAt)))
      .limit(1);

    if (rows.length === 0) {
      throw new NotFoundException({
        code: ApiErrorCode.RESOURCE_NOT_FOUND,
        message: `Parameter with id ${id} not found`,
      });
    }

    return rows[0]!;
  }

  async findByKey(key: string): Promise<SysParam> {
    const rows = await this.db
      .select()
      .from(sysParams)
      .where(and(eq(sysParams.key, key), isNull(sysParams.deletedAt)))
      .limit(1);

    if (rows.length === 0) {
      throw new NotFoundException({
        code: ApiErrorCode.RESOURCE_NOT_FOUND,
        message: `Parameter with key '${key}' not found`,
      });
    }

    return rows[0]!;
  }

  async create(dto: CreateParamDto): Promise<SysParam> {
    const existing = await this.db
      .select()
      .from(sysParams)
      .where(and(eq(sysParams.key, dto.key), isNull(sysParams.deletedAt)))
      .limit(1);

    if (existing.length > 0) {
      throw new ConflictException({
        code: ApiErrorCode.PARAM_ERROR,
        message: `Parameter key '${dto.key}' is already taken`,
      });
    }

    const rows = await this.db
      .insert(sysParams)
      .values({
        name: dto.name,
        key: dto.key,
        value: dto.value,
        desc: dto.desc ?? '',
      })
      .returning();

    return rows[0]!;
  }

  async update(id: string, dto: UpdateParamDto): Promise<SysParam> {
    const existing = await this.findOne(id);

    if (dto.key && dto.key !== existing.key) {
      const keyConflict = await this.db
        .select()
        .from(sysParams)
        .where(and(eq(sysParams.key, dto.key), isNull(sysParams.deletedAt)))
        .limit(1);

      if (keyConflict.length > 0) {
        throw new ConflictException({
          code: ApiErrorCode.PARAM_ERROR,
          message: `Parameter key '${dto.key}' is already taken`,
        });
      }
    }

    type ParamUpdateFields = {
      name?: string;
      key?: string;
      value?: string;
      desc?: string;
      updatedAt?: Date;
    };

    const updateData: ParamUpdateFields = {
      updatedAt: new Date(),
    };

    if (dto.name !== undefined) updateData.name = dto.name;
    if (dto.key !== undefined) updateData.key = dto.key;
    if (dto.value !== undefined) updateData.value = dto.value;
    if (dto.desc !== undefined) updateData.desc = dto.desc;

    const rows = await this.db
      .update(sysParams)
      .set(updateData)
      .where(and(eq(sysParams.id, id), isNull(sysParams.deletedAt)))
      .returning();

    return rows[0]!;
  }

  async remove(id: string): Promise<void> {
    await this.findOne(id);

    await this.db
      .update(sysParams)
      .set({ deletedAt: sql`NOW()` })
      .where(and(eq(sysParams.id, id), isNull(sysParams.deletedAt)));
  }

  async batchRemove(ids: string[]): Promise<{ count: number }> {
    const rows = await this.db
      .update(sysParams)
      .set({ deletedAt: sql`NOW()` })
      .where(and(inArray(sysParams.id, ids), isNull(sysParams.deletedAt)))
      .returning({ id: sysParams.id });

    return { count: rows.length };
  }
}
