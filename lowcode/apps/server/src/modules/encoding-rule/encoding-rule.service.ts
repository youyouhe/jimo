import {
  Injectable,
  Inject,
  NotFoundException,
  ConflictException,
} from '@nestjs/common';
import { eq, and, isNull, like, sql, count } from 'drizzle-orm';
import { DATABASE_CONNECTION, DrizzleDb } from '../../db/connection.js';
import { sysEncodingRules, SysEncodingRule } from '../../db/schema/encoding-rules.js';
import { CreateEncodingRuleDto } from './dto/create-encoding-rule.dto.js';
import { UpdateEncodingRuleDto } from './dto/update-encoding-rule.dto.js';
import { QueryEncodingRuleDto } from './dto/query-encoding-rule.dto.js';
import { ApiErrorCode, PaginatedData } from '@lowcode/shared';
import { SQL } from 'drizzle-orm';

@Injectable()
export class EncodingRuleService {
  constructor(
    @Inject(DATABASE_CONNECTION) private readonly db: DrizzleDb,
  ) {}

  async findAll(query: QueryEncodingRuleDto): Promise<PaginatedData<SysEncodingRule>> {
    const { page, pageSize, name } = query;
    const offset = (page - 1) * pageSize;

    const conditions: SQL[] = [isNull(sysEncodingRules.deletedAt)];

    if (name) {
      conditions.push(like(sysEncodingRules.name, `%${name}%`));
    }

    const whereClause = and(...conditions);

    const [rows, totalRows] = await Promise.all([
      this.db
        .select()
        .from(sysEncodingRules)
        .where(whereClause)
        .orderBy(sysEncodingRules.createdAt)
        .limit(pageSize)
        .offset(offset),
      this.db
        .select({ count: count() })
        .from(sysEncodingRules)
        .where(whereClause),
    ]);

    const total = totalRows[0]?.count ?? 0;

    return { list: rows, total, page, pageSize };
  }

  async findOne(id: string): Promise<SysEncodingRule> {
    const rows = await this.db
      .select()
      .from(sysEncodingRules)
      .where(and(eq(sysEncodingRules.id, id), isNull(sysEncodingRules.deletedAt)))
      .limit(1);

    if (rows.length === 0) {
      throw new NotFoundException({
        code: ApiErrorCode.RESOURCE_NOT_FOUND,
        message: `EncodingRule with id ${id} not found`,
      });
    }

    return rows[0]!;
  }

  async create(dto: CreateEncodingRuleDto): Promise<SysEncodingRule> {
    const existing = await this.db
      .select()
      .from(sysEncodingRules)
      .where(and(eq(sysEncodingRules.name, dto.name), isNull(sysEncodingRules.deletedAt)))
      .limit(1);

    if (existing.length > 0) {
      throw new ConflictException({
        code: ApiErrorCode.PARAM_ERROR,
        message: `Encoding rule name '${dto.name}' is already taken`,
      });
    }

    const rows = await this.db
      .insert(sysEncodingRules)
      .values({
        name: dto.name,
        prefix: dto.prefix ?? null,
        dateFormat: dto.dateFormat ?? null,
        separator: dto.separator ?? '',
        sequenceDigits: dto.sequenceDigits ?? 4,
        paddingChar: dto.paddingChar ?? '0',
        resetCycle: dto.resetCycle,
      })
      .returning();

    return rows[0]!;
  }

  async update(id: string, dto: UpdateEncodingRuleDto): Promise<SysEncodingRule> {
    const existing = await this.findOne(id);

    if (dto.name && dto.name !== existing.name) {
      const nameConflict = await this.db
        .select()
        .from(sysEncodingRules)
        .where(and(eq(sysEncodingRules.name, dto.name), isNull(sysEncodingRules.deletedAt)))
        .limit(1);

      if (nameConflict.length > 0) {
        throw new ConflictException({
          code: ApiErrorCode.PARAM_ERROR,
          message: `Encoding rule name '${dto.name}' is already taken`,
        });
      }
    }

    type UpdateFields = Partial<{
      name: string;
      prefix: string | null;
      dateFormat: string | null;
      separator: string;
      sequenceDigits: number;
      paddingChar: string;
      resetCycle: string;
      updatedAt: Date;
    }>;

    const updateData: UpdateFields = { updatedAt: new Date() };

    if (dto.name !== undefined) updateData.name = dto.name;
    if (dto.prefix !== undefined) updateData.prefix = dto.prefix ?? null;
    if (dto.dateFormat !== undefined) updateData.dateFormat = dto.dateFormat ?? null;
    if (dto.separator !== undefined) updateData.separator = dto.separator;
    if (dto.sequenceDigits !== undefined) updateData.sequenceDigits = dto.sequenceDigits;
    if (dto.paddingChar !== undefined) updateData.paddingChar = dto.paddingChar;
    if (dto.resetCycle !== undefined) updateData.resetCycle = dto.resetCycle;

    const rows = await this.db
      .update(sysEncodingRules)
      .set(updateData)
      .where(and(eq(sysEncodingRules.id, id), isNull(sysEncodingRules.deletedAt)))
      .returning();

    return rows[0]!;
  }

  async remove(id: string): Promise<void> {
    await this.findOne(id);

    await this.db
      .update(sysEncodingRules)
      .set({ deletedAt: sql`NOW()` })
      .where(and(eq(sysEncodingRules.id, id), isNull(sysEncodingRules.deletedAt)));
  }

  /**
   * Atomically increment the sequence counter for the given rule and return
   * the formatted code string. Uses a PostgreSQL upsert so concurrent calls
   * are safe without advisory locks.
   */
  async generateNext(ruleId: string): Promise<string> {
    const rule = await this.findOne(ruleId);

    const periodKey = this.computePeriodKey(rule.resetCycle);

    const result = await this.db.execute(
      sql`INSERT INTO sys_encoding_rule_sequences (rule_id, period_key, last_seq)
          VALUES (${ruleId}, ${periodKey}, 1)
          ON CONFLICT ON CONSTRAINT uq_sys_encoding_rule_sequences_rule_period
          DO UPDATE SET last_seq = sys_encoding_rule_sequences.last_seq + 1
          RETURNING last_seq`,
    );

    const row = (result as unknown as Array<{ last_seq: number }>)[0];
    const lastSeq = row?.last_seq ?? 1;

    return this.formatCode(rule, periodKey, lastSeq);
  }

  private computePeriodKey(resetCycle: string): string {
    const now = new Date();
    if (resetCycle === 'yearly') {
      return String(now.getFullYear());
    }
    if (resetCycle === 'monthly') {
      return `${now.getFullYear()}${String(now.getMonth() + 1).padStart(2, '0')}`;
    }
    // 'never'
    return '';
  }

  private formatCode(rule: SysEncodingRule, periodKey: string, lastSeq: number): string {
    const prefix = rule.prefix ?? '';
    const separator = rule.separator ?? '';
    const paddingChar = rule.paddingChar ?? '0';
    const sequenceDigits = rule.sequenceDigits ?? 4;

    const datePart = this.formatDatePart(rule.dateFormat, periodKey);
    const seqPart = String(lastSeq).padStart(sequenceDigits, paddingChar);

    const parts: string[] = [];

    if (prefix) {
      parts.push(prefix);
    }
    if (datePart) {
      parts.push(datePart);
    }
    parts.push(seqPart);

    return parts.join(separator);
  }

  private formatDatePart(dateFormat: string | null | undefined, periodKey: string): string {
    if (!dateFormat || dateFormat === 'none') {
      return '';
    }
    // periodKey is already in the right format based on resetCycle:
    //   'never'   -> ''
    //   'yearly'  -> '2026'
    //   'monthly' -> '202606'
    // For 'yyyyMMdd' we need the full date at generation time.
    if (dateFormat === 'yyyyMMdd') {
      const now = new Date();
      const yyyy = now.getFullYear();
      const MM = String(now.getMonth() + 1).padStart(2, '0');
      const dd = String(now.getDate()).padStart(2, '0');
      return `${yyyy}${MM}${dd}`;
    }
    // For 'yyyy' or 'yyMM': use periodKey when available, fall back to current date
    // (periodKey is empty when resetCycle='never', so we cannot derive the date from it)
    if (dateFormat === 'yyyy') {
      if (periodKey.length >= 4) return periodKey.slice(0, 4);
      return String(new Date().getFullYear());
    }
    if (dateFormat === 'yyMM') {
      if (periodKey.length >= 6) {
        // periodKey is 'YYYYMM' (6 chars) — take last 2 of year + MM
        return `${periodKey.slice(2, 4)}${periodKey.slice(4, 6)}`;
      }
      const now = new Date();
      const yy = String(now.getFullYear()).slice(2);
      const mm = String(now.getMonth() + 1).padStart(2, '0');
      return `${yy}${mm}`;
    }
    return '';
  }
}
