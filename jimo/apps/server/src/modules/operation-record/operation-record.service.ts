import {
  Injectable,
  Inject,
  NotFoundException,
  Logger,
} from '@nestjs/common';
import { eq, like, and, gte, lte, count, inArray, desc } from 'drizzle-orm';
import { DATABASE_CONNECTION, DrizzleDb } from '../../db/connection';
import {
  sysOperationRecords,
  SysOperationRecord,
  NewSysOperationRecord,
} from '../../db/schema/operation-records';
import { QueryRecordDto } from './dto/query-record.dto';
import { ApiErrorCode, PaginatedData } from '@jimo/shared';
import { SQL } from 'drizzle-orm';

@Injectable()
export class OperationRecordService {
  private readonly logger = new Logger(OperationRecordService.name);

  constructor(
    @Inject(DATABASE_CONNECTION) private readonly db: DrizzleDb,
  ) {}

  /**
   * Fire-and-forget insert. Returns void immediately without awaiting the DB operation.
   * Errors are logged but not propagated.
   */
  createAsync(record: NewSysOperationRecord): void {
    this.db
      .insert(sysOperationRecords)
      .values(record)
      .execute()
      .then(() => {
        /* success, no-op */
      })
      .catch((err: unknown) => {
        this.logger.error('Failed to write audit record', err);
      });
    // IMPORTANT: no return, no await — returns void immediately
  }

  async findAll(query: QueryRecordDto): Promise<PaginatedData<SysOperationRecord>> {
    const { page, pageSize, method, path, status, startDate, endDate } = query;
    const offset = (page - 1) * pageSize;

    const conditions: SQL[] = [];

    if (method) {
      conditions.push(eq(sysOperationRecords.method, method));
    }
    if (path) {
      conditions.push(like(sysOperationRecords.path, `%${path}%`));
    }
    if (status !== undefined && status !== null) {
      conditions.push(eq(sysOperationRecords.status, status));
    }
    if (startDate) {
      conditions.push(gte(sysOperationRecords.createdAt, new Date(startDate)));
    }
    if (endDate) {
      conditions.push(lte(sysOperationRecords.createdAt, new Date(endDate)));
    }

    const whereClause = conditions.length > 0 ? and(...conditions) : undefined;

    const [rows, totalRows] = await Promise.all([
      this.db
        .select()
        .from(sysOperationRecords)
        .where(whereClause)
        .orderBy(desc(sysOperationRecords.createdAt))
        .limit(pageSize)
        .offset(offset),
      this.db
        .select({ count: count() })
        .from(sysOperationRecords)
        .where(whereClause),
    ]);

    const total = totalRows[0]?.count ?? 0;

    return { list: rows, total, page, pageSize };
  }

  async findOne(id: string): Promise<SysOperationRecord> {
    const rows = await this.db
      .select()
      .from(sysOperationRecords)
      .where(eq(sysOperationRecords.id, id))
      .limit(1);

    if (rows.length === 0) {
      throw new NotFoundException({
        code: ApiErrorCode.RESOURCE_NOT_FOUND,
        message: `Operation record with id ${id} not found`,
      });
    }

    return rows[0]!;
  }

  async remove(id: string): Promise<void> {
    await this.findOne(id);

    await this.db
      .delete(sysOperationRecords)
      .where(eq(sysOperationRecords.id, id));
  }

  async batchRemove(ids: string[]): Promise<{ count: number }> {
    const rows = await this.db
      .delete(sysOperationRecords)
      .where(inArray(sysOperationRecords.id, ids))
      .returning({ id: sysOperationRecords.id });

    return { count: rows.length };
  }
}
