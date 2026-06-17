import {
  Injectable,
  Inject,
  NotFoundException,
  ConflictException,
} from '@nestjs/common';
import { eq, and, isNull, like, sql, count, inArray, gte, lte, desc } from 'drizzle-orm';
import { DATABASE_CONNECTION, DrizzleDb } from '../../db/connection';
import { clubs, Clubs } from '../../db/schema/clubs';
import { CreateClubDto } from './dto/create-club.dto';
import { UpdateClubDto } from './dto/update-club.dto';
import { QueryClubDto } from './dto/query-club.dto';
import { ApiErrorCode, PaginatedData } from '@lowcode/shared';
import { SQL } from 'drizzle-orm';

@Injectable()
export class ClubService {
  constructor(
    @Inject(DATABASE_CONNECTION) private readonly db: DrizzleDb,
  ) {}

  async findAll(query: QueryClubDto): Promise<PaginatedData<Clubs>> {
    const { page, pageSize, name } = query;
    const offset = (page - 1) * pageSize;

    const conditions: SQL[] = [isNull(clubs.deletedAt)];

    if (name) {
      conditions.push(like(clubs.name, `%${name}%`));
    }

    const whereClause = and(...conditions);

    const [rows, totalRows] = await Promise.all([
      this.db
        .select()
        .from(clubs)
        .where(whereClause)
        .orderBy(desc(clubs.createdAt))
        .limit(pageSize)
        .offset(offset),
      this.db
        .select({ count: count() })
        .from(clubs)
        .where(whereClause),
    ]);

    const total = totalRows[0]?.count ?? 0;

    return { list: rows, total, page, pageSize };
  }

  async findOne(id: string): Promise<Clubs> {
    const rows = await this.db
      .select()
      .from(clubs)
      .where(and(eq(clubs.id, id), isNull(clubs.deletedAt)))
      .limit(1);

    if (rows.length === 0) {
      throw new NotFoundException({
        code: ApiErrorCode.RESOURCE_NOT_FOUND,
        message: `Club with id ${id} not found`,
      });
    }

    return rows[0]!;
  }

  async create(dto: CreateClubDto): Promise<Clubs> {
    // Check unique: name
    const existingByName = await this.db
      .select()
      .from(clubs)
      .where(and(eq(clubs.name, dto.name), isNull(clubs.deletedAt)))
      .limit(1);

    if (existingByName.length > 0) {
      throw new ConflictException({
        code: ApiErrorCode.PARAM_ERROR,
        message: `Name '${dto.name}' is already taken`,
      });
    }

    const rows = await this.db
      .insert(clubs)
      .values({
        name: dto.name,
        description: dto.description,
        founded_date: dto.founded_date ? new Date(dto.founded_date) : null,
      })
      .returning();
    return rows[0]!;

  }

  async update(id: string, dto: UpdateClubDto): Promise<Clubs> {
    const existing = await this.findOne(id);

    if (dto.name && dto.name !== existing.name) {
      const nameConflict = await this.db
        .select()
        .from(clubs)
        .where(and(eq(clubs.name, dto.name), isNull(clubs.deletedAt)))
        .limit(1);

      if (nameConflict.length > 0) {
        throw new ConflictException({
          code: ApiErrorCode.PARAM_ERROR,
          message: `Name '${dto.name}' is already taken`,
        });
      }
    }

    type ClubUpdateFields = {
      name?: string;
      description?: string;
      founded_date?: Date;
      updatedAt?: Date;
    };

    const updateData: ClubUpdateFields = {
      updatedAt: new Date(),
    };

    if (dto.name !== undefined) updateData.name = dto.name;
    if (dto.description !== undefined) updateData.description = dto.description;
    if (dto.founded_date !== undefined) updateData.founded_date = dto.founded_date ? new Date(dto.founded_date) : undefined;

    const rows = await this.db
      .update(clubs)
      .set(updateData)
      .where(and(eq(clubs.id, id), isNull(clubs.deletedAt)))
      .returning();


    return rows[0]!;
  }

  async remove(id: string): Promise<void> {
    await this.findOne(id);


    await this.db
      .update(clubs)
      .set({ deletedAt: sql`NOW()` })
      .where(and(eq(clubs.id, id), isNull(clubs.deletedAt)));
  }

  async batchRemove(ids: string[]): Promise<{ count: number }> {

    const rows = await this.db
      .update(clubs)
      .set({ deletedAt: sql`NOW()` })
      .where(and(inArray(clubs.id, ids), isNull(clubs.deletedAt)))
      .returning({ id: clubs.id });

    return { count: rows.length };
  }

}
