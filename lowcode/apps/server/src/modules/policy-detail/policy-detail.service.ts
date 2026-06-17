import {
  Injectable,
  Inject,
  NotFoundException,
  ConflictException,
} from '@nestjs/common';
import { eq, and, isNull, like, sql, count, inArray, gte, lte, desc, getTableColumns } from 'drizzle-orm';
import { DATABASE_CONNECTION, DrizzleDb } from '../../db/connection';
import { policyDetails, PolicyDetails } from '../../db/schema/policy-details';
import { policies } from '../../db/schema/policies';
import { CreatePolicyDetailDto } from './dto/create-policy-detail.dto';
import { UpdatePolicyDetailDto } from './dto/update-policy-detail.dto';
import { QueryPolicyDetailDto } from './dto/query-policy-detail.dto';
import { ApiErrorCode, PaginatedData } from '@lowcode/shared';
import { SQL } from 'drizzle-orm';

@Injectable()
export class PolicyDetailService {
  constructor(
    @Inject(DATABASE_CONNECTION) private readonly db: DrizzleDb,
  ) {}

  async findAll(query: QueryPolicyDetailDto): Promise<PaginatedData<PolicyDetails>> {
    const { page, pageSize, chapter_number, title } = query;
    const offset = (page - 1) * pageSize;

    const conditions: SQL[] = [isNull(policyDetails.deletedAt)];

    if (chapter_number) {
      conditions.push(like(policyDetails.chapter_number, `%${chapter_number}%`));
    }
    if (title) {
      conditions.push(like(policyDetails.title, `%${title}%`));
    }

    const whereClause = and(...conditions);

    const [rows, totalRows] = await Promise.all([
      this.db
        .select({
          ...getTableColumns(policyDetails),
      policy_id_display: policies.name,
        })
        .from(policyDetails)
        .leftJoin(policies, eq(policyDetails.policy_id, policies.id))
        .where(whereClause)
        .orderBy(desc(policyDetails.createdAt))
        .limit(pageSize)
        .offset(offset),
      this.db
        .select({ count: count() })
        .from(policyDetails)
        .where(whereClause),
    ]);

    const total = totalRows[0]?.count ?? 0;

    return { list: rows, total, page, pageSize };
  }

  async findOne(id: string): Promise<PolicyDetails> {
    const rows = await this.db
      .select({
        ...getTableColumns(policyDetails),
      policy_id_display: policies.name,
      })
      .from(policyDetails)
        .leftJoin(policies, eq(policyDetails.policy_id, policies.id))
      .where(and(eq(policyDetails.id, id), isNull(policyDetails.deletedAt)))
      .limit(1);

    if (rows.length === 0) {
      throw new NotFoundException({
        code: ApiErrorCode.RESOURCE_NOT_FOUND,
        message: `PolicyDetail with id ${id} not found`,
      });
    }

    return rows[0]!;
  }

  async create(dto: CreatePolicyDetailDto): Promise<PolicyDetails> {

    const rows = await this.db
      .insert(policyDetails)
      .values({
        policy_id: dto.policy_id,
        chapter_number: dto.chapter_number,
        title: dto.title,
        content: dto.content,
        sort_order: dto.sort_order,
      })
      .returning();
    return rows[0]!;

  }

  async update(id: string, dto: UpdatePolicyDetailDto): Promise<PolicyDetails> {
    const existing = await this.findOne(id);


    type PolicyDetailUpdateFields = {
      policy_id?: string;
      chapter_number?: string;
      title?: string;
      content?: string;
      sort_order?: number;
      updatedAt?: Date;
    };

    const updateData: PolicyDetailUpdateFields = {
      updatedAt: new Date(),
    };

    if (dto.policy_id !== undefined) updateData.policy_id = dto.policy_id ?? undefined;
    if (dto.chapter_number !== undefined) updateData.chapter_number = dto.chapter_number;
    if (dto.title !== undefined) updateData.title = dto.title;
    if (dto.content !== undefined) updateData.content = dto.content;
    if (dto.sort_order !== undefined) updateData.sort_order = dto.sort_order;

    const rows = await this.db
      .update(policyDetails)
      .set(updateData)
      .where(and(eq(policyDetails.id, id), isNull(policyDetails.deletedAt)))
      .returning();


    return rows[0]!;
  }

  async remove(id: string): Promise<void> {
    await this.findOne(id);


    await this.db
      .update(policyDetails)
      .set({ deletedAt: sql`NOW()` })
      .where(and(eq(policyDetails.id, id), isNull(policyDetails.deletedAt)));
  }

  async batchRemove(ids: string[]): Promise<{ count: number }> {

    const rows = await this.db
      .update(policyDetails)
      .set({ deletedAt: sql`NOW()` })
      .where(and(inArray(policyDetails.id, ids), isNull(policyDetails.deletedAt)))
      .returning({ id: policyDetails.id });

    return { count: rows.length };
  }

}
