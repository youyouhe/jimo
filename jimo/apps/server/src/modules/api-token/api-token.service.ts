import { Injectable, Inject, NotFoundException, Logger } from '@nestjs/common';
import { eq, and, like, count, inArray, sql, isNull, or } from 'drizzle-orm';
import { randomBytes } from 'crypto';
import { DATABASE_CONNECTION, DrizzleDb } from '../../db/connection';
import { sysApiTokens, SysApiToken } from '../../db/schema/api-tokens';
import { CreateApiTokenDto } from './dto/create-api-token.dto';
import { QueryApiTokenDto } from './dto/query-api-token.dto';
import { PaginatedData } from '@jimo/shared';
import { SQL } from 'drizzle-orm';

@Injectable()
export class ApiTokenService {
  private readonly logger = new Logger(ApiTokenService.name);

  constructor(
    @Inject(DATABASE_CONNECTION) private readonly db: DrizzleDb,
  ) {}

  async findAll(query: QueryApiTokenDto): Promise<PaginatedData<SysApiToken>> {
    const { page, pageSize, name } = query;
    const offset = (page - 1) * pageSize;

    const conditions: SQL[] = [];

    if (name) {
      conditions.push(like(sysApiTokens.name, `%${name}%`));
    }

    const whereClause = conditions.length > 0 ? and(...conditions) : undefined;

    const [rows, totalRows] = await Promise.all([
      this.db
        .select()
        .from(sysApiTokens)
        .where(whereClause)
        .orderBy(sql`${sysApiTokens.createdAt} DESC`)
        .limit(pageSize)
        .offset(offset),
      this.db
        .select({ count: count() })
        .from(sysApiTokens)
        .where(whereClause),
    ]);

    const total = totalRows[0]?.count ?? 0;

    return { list: rows, total, page, pageSize };
  }

  async generate(dto: CreateApiTokenDto): Promise<SysApiToken> {
    const token = randomBytes(32).toString('hex');

    const rows = await this.db
      .insert(sysApiTokens)
      .values({
        name: dto.name,
        token,
        userId: 'system',
        expiresAt: dto.expiresAt ? new Date(dto.expiresAt) : undefined,
      })
      .returning();

    this.logger.log(`API token "${dto.name}" generated`);
    return rows[0]!;
  }

  async revoke(id: string): Promise<void> {
    const rows = await this.db
      .select()
      .from(sysApiTokens)
      .where(eq(sysApiTokens.id, id))
      .limit(1);

    if (rows.length === 0) {
      throw new NotFoundException(`API token with id ${id} not found`);
    }

    await this.db
      .delete(sysApiTokens)
      .where(eq(sysApiTokens.id, id));

    this.logger.log(`API token "${rows[0]!.name}" revoked`);
  }
}
