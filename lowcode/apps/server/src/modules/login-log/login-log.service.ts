import { Injectable, Inject, NotFoundException, Logger } from '@nestjs/common';
import { eq, and, like, count, inArray, sql, gte, lte } from 'drizzle-orm';
import { DATABASE_CONNECTION, DrizzleDb } from '../../db/connection';
import { sysLoginLogs, SysLoginLog } from '../../db/schema/login-logs';
import { QueryLoginLogDto } from './dto/query-login-log.dto';
import { PaginatedData } from '@lowcode/shared';
import { SQL } from 'drizzle-orm';

@Injectable()
export class LoginLogService {
  private readonly logger = new Logger(LoginLogService.name);

  constructor(
    @Inject(DATABASE_CONNECTION) private readonly db: DrizzleDb,
  ) {}

  async findAll(query: QueryLoginLogDto): Promise<PaginatedData<SysLoginLog>> {
    const { page, pageSize, username, status, startDate, endDate } = query;
    const offset = (page - 1) * pageSize;

    const conditions: SQL[] = [];

    if (username) {
      conditions.push(like(sysLoginLogs.username, `%${username}%`));
    }
    if (status !== undefined && status !== null) {
      conditions.push(eq(sysLoginLogs.status, status));
    }
    if (startDate) {
      conditions.push(gte(sysLoginLogs.createdAt, new Date(startDate)));
    }
    if (endDate) {
      conditions.push(lte(sysLoginLogs.createdAt, new Date(endDate + 'T23:59:59.999Z')));
    }

    const whereClause = conditions.length > 0 ? and(...conditions) : undefined;

    const [rows, totalRows] = await Promise.all([
      this.db
        .select()
        .from(sysLoginLogs)
        .where(whereClause)
        .orderBy(sql`${sysLoginLogs.createdAt} DESC`)
        .limit(pageSize)
        .offset(offset),
      this.db
        .select({ count: count() })
        .from(sysLoginLogs)
        .where(whereClause),
    ]);

    const total = totalRows[0]?.count ?? 0;

    return { list: rows, total, page, pageSize };
  }

  async remove(id: string): Promise<void> {
    const rows = await this.db
      .select()
      .from(sysLoginLogs)
      .where(eq(sysLoginLogs.id, id))
      .limit(1);

    if (rows.length === 0) {
      throw new NotFoundException(`Login log with id ${id} not found`);
    }

    await this.db
      .delete(sysLoginLogs)
      .where(eq(sysLoginLogs.id, id));
  }

  async batchRemove(ids: string[]): Promise<{ count: number }> {
    const result = await this.db
      .delete(sysLoginLogs)
      .where(inArray(sysLoginLogs.id, ids))
      .returning({ id: sysLoginLogs.id });

    return { count: result.length };
  }
}
