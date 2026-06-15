import { Injectable, Inject, NotFoundException, Logger } from '@nestjs/common';
import { eq, and, like, count, inArray, sql } from 'drizzle-orm';
import { DATABASE_CONNECTION, DrizzleDb } from '../../db/connection';
import { sysError, SysError } from '../../db/schema/error';
import { ReportErrorDto } from './dto/report-error.dto';
import { UpdateErrorDto } from './dto/update-error.dto';
import { QueryErrorDto } from './dto/query-error.dto';
import { PaginatedData } from '@lowcode/shared';
import { SQL } from 'drizzle-orm';

@Injectable()
export class ErrorService {
  private readonly logger = new Logger(ErrorService.name);

  constructor(
    @Inject(DATABASE_CONNECTION) private readonly db: DrizzleDb,
  ) {}

  async findAll(query: QueryErrorDto): Promise<PaginatedData<SysError>> {
    const { page, pageSize, level, source, status } = query;
    const offset = (page - 1) * pageSize;

    const conditions: SQL[] = [];

    if (level) {
      conditions.push(eq(sysError.level, level));
    }
    if (source) {
      conditions.push(like(sysError.source, `%${source}%`));
    }
    if (status !== undefined && status !== null) {
      conditions.push(eq(sysError.status, status));
    }

    const whereClause = conditions.length > 0 ? and(...conditions) : undefined;

    const [rows, totalRows] = await Promise.all([
      this.db
        .select()
        .from(sysError)
        .where(whereClause)
        .orderBy(sql`${sysError.createdAt} DESC`)
        .limit(pageSize)
        .offset(offset),
      this.db
        .select({ count: count() })
        .from(sysError)
        .where(whereClause),
    ]);

    const total = totalRows[0]?.count ?? 0;

    return { list: rows, total, page, pageSize };
  }

  async findOne(id: string): Promise<SysError> {
    const rows = await this.db
      .select()
      .from(sysError)
      .where(eq(sysError.id, id))
      .limit(1);

    if (rows.length === 0) {
      throw new NotFoundException(`Error log with id ${id} not found`);
    }

    return rows[0]!;
  }

  async report(dto: ReportErrorDto): Promise<SysError> {
    const rows = await this.db
      .insert(sysError)
      .values({
        level: dto.level,
        source: dto.source,
        message: dto.message,
        stack: dto.stack ?? '',
      })
      .returning();

    this.logger.log(`Error reported: [${dto.level}] ${dto.source}: ${dto.message}`);
    return rows[0]!;
  }

  async update(id: string, dto: UpdateErrorDto): Promise<SysError> {
    const existing = await this.findOne(id);

    type ErrorUpdateFields = {
      solution?: string;
      status?: number;
      updatedAt?: Date;
    };

    const updateData: ErrorUpdateFields = {
      updatedAt: new Date(),
    };

    if (dto.solution !== undefined) updateData.solution = dto.solution;
    if (dto.status !== undefined) updateData.status = dto.status;

    const rows = await this.db
      .update(sysError)
      .set(updateData)
      .where(eq(sysError.id, id))
      .returning();

    return rows[0]!;
  }

  async remove(id: string): Promise<void> {
    await this.findOne(id);

    await this.db
      .delete(sysError)
      .where(eq(sysError.id, id));
  }

  async batchRemove(ids: string[]): Promise<{ count: number }> {
    const result = await this.db
      .delete(sysError)
      .where(inArray(sysError.id, ids))
      .returning({ id: sysError.id });

    return { count: result.length };
  }
}
