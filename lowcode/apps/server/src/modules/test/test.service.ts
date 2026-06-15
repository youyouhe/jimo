import {
  Injectable,
  Inject,
  NotFoundException,
  ConflictException,
} from '@nestjs/common';
import { eq, and, isNull, like, sql, count, inArray, gte, lte, desc } from 'drizzle-orm';
import { DATABASE_CONNECTION, DrizzleDb } from '../../db/connection';
import { test, Test } from '../../db/schema/test';
import { CreateTestDto } from './dto/create-test.dto';
import { UpdateTestDto } from './dto/update-test.dto';
import { QueryTestDto } from './dto/query-test.dto';
import { ApiErrorCode, PaginatedData } from '@lowcode/shared';
import { SQL } from 'drizzle-orm';

@Injectable()
export class TestService {
  constructor(
    @Inject(DATABASE_CONNECTION) private readonly db: DrizzleDb,
  ) {}

  async findAll(query: QueryTestDto): Promise<PaginatedData<Test>> {
    const { page, pageSize, name, description } = query;
    const offset = (page - 1) * pageSize;

    const conditions: SQL[] = [isNull(test.deletedAt)];

    if (name) {
      conditions.push(like(test.name, `%${name}%`));
    }
    if (description) {
      conditions.push(like(test.description, `%${description}%`));
    }

    const whereClause = and(...conditions);

    const [rows, totalRows] = await Promise.all([
      this.db
        .select()
        .from(test)
        .where(whereClause)
        .orderBy(desc(test.createdAt))
        .limit(pageSize)
        .offset(offset),
      this.db
        .select({ count: count() })
        .from(test)
        .where(whereClause),
    ]);

    const total = totalRows[0]?.count ?? 0;

    return { list: rows, total, page, pageSize };
  }

  async findOne(id: string): Promise<Test> {
    const rows = await this.db
      .select()
      .from(test)
      .where(and(eq(test.id, id), isNull(test.deletedAt)))
      .limit(1);

    if (rows.length === 0) {
      throw new NotFoundException({
        code: ApiErrorCode.RESOURCE_NOT_FOUND,
        message: `Test with id ${id} not found`,
      });
    }

    return rows[0]!;
  }

  async create(dto: CreateTestDto): Promise<Test> {

    const rows = await this.db
      .insert(test)
      .values({
        name: dto.name,
        description: dto.description,
      })
      .returning();
    return rows[0]!;

  }

  async update(id: string, dto: UpdateTestDto): Promise<Test> {
    const existing = await this.findOne(id);


    type TestUpdateFields = {
      name?: string;
      description?: string;
      updatedAt?: Date;
    };

    const updateData: TestUpdateFields = {
      updatedAt: new Date(),
    };

    if (dto.name !== undefined) updateData.name = dto.name;
    if (dto.description !== undefined) updateData.description = dto.description;

    const rows = await this.db
      .update(test)
      .set(updateData)
      .where(and(eq(test.id, id), isNull(test.deletedAt)))
      .returning();


    return rows[0]!;
  }

  async remove(id: string): Promise<void> {
    await this.findOne(id);


    await this.db
      .update(test)
      .set({ deletedAt: sql`NOW()` })
      .where(and(eq(test.id, id), isNull(test.deletedAt)));
  }

  async batchRemove(ids: string[]): Promise<{ count: number }> {

    const rows = await this.db
      .update(test)
      .set({ deletedAt: sql`NOW()` })
      .where(and(inArray(test.id, ids), isNull(test.deletedAt)))
      .returning({ id: test.id });

    return { count: rows.length };
  }

}
