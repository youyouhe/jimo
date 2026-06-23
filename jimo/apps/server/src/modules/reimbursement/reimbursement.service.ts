import {
  Injectable,
  Inject,
  NotFoundException,
  ConflictException,
} from '@nestjs/common';
import { eq, and, isNull, like, sql, count, inArray, gte, lte, desc } from 'drizzle-orm';
import { DATABASE_CONNECTION, DrizzleDb } from '../../db/connection';
import { OwnershipHelper } from '../../common/ownership/ownership.helper';
import { reimbursements, Reimbursements } from '../../db/schema/reimbursements';
import { CreateReimbursementDto } from './dto/create-reimbursement.dto';
import { UpdateReimbursementDto } from './dto/update-reimbursement.dto';
import { QueryReimbursementDto } from './dto/query-reimbursement.dto';
import { ApiErrorCode, PaginatedData } from '@jimo/shared';
import { SQL } from 'drizzle-orm';

@Injectable()
export class ReimbursementService {
  constructor(
    @Inject(DATABASE_CONNECTION) private readonly db: DrizzleDb,
    private readonly ownershipHelper: OwnershipHelper,
  ) {}

  async findAll(query: QueryReimbursementDto, userId?: string, isAdmin: boolean = false): Promise<PaginatedData<Reimbursements>> {
    const { page, pageSize, title, reimbursement_category } = query;
    const offset = (page - 1) * pageSize;

    const conditions: SQL[] = [isNull(reimbursements.deletedAt)];
    const _ownership = this.ownershipHelper.visibleCondition(reimbursements.ownerId, reimbursements.sharedWith, userId, isAdmin);
    if (_ownership) conditions.push(_ownership);

    if (title) {
      conditions.push(like(reimbursements.title, `%${title}%`));
    }
    if (reimbursement_category) {
      conditions.push(eq(reimbursements.reimbursement_category, reimbursement_category));
    }

    const whereClause = and(...conditions);

    const [rows, totalRows] = await Promise.all([
      this.db
        .select()
        .from(reimbursements)
        .where(whereClause)
        .orderBy(desc(reimbursements.createdAt))
        .limit(pageSize)
        .offset(offset),
      this.db
        .select({ count: count() })
        .from(reimbursements)
        .where(whereClause),
    ]);

    const total = totalRows[0]?.count ?? 0;

    return { list: rows, total, page, pageSize };
  }

  async findOne(id: string): Promise<Reimbursements> {
    const rows = await this.db
      .select()
      .from(reimbursements)
      .where(and(eq(reimbursements.id, id), isNull(reimbursements.deletedAt)))
      .limit(1);

    if (rows.length === 0) {
      throw new NotFoundException({
        code: ApiErrorCode.RESOURCE_NOT_FOUND,
        message: `Reimbursement with id ${id} not found`,
      });
    }

    return rows[0]!;
  }

  async create(dto: CreateReimbursementDto, userId?: string): Promise<Reimbursements> {

    const rows = await this.db
      .insert(reimbursements)
      .values({
        ownerId: userId,
        title: dto.title,
        reimbursement_category: dto.reimbursement_category,
        amount: String(dto.amount),
        description: dto.description,
        attachments: dto.attachments,
      })
      .returning();
    return rows[0]!;

  }

  async update(id: string, dto: UpdateReimbursementDto): Promise<Reimbursements> {
    const existing = await this.findOne(id);


    type ReimbursementUpdateFields = {
      title?: string;
      reimbursement_category?: string;
      amount?: string;
      description?: string;
      attachments?: string;
      updatedAt?: Date;
    };

    const updateData: ReimbursementUpdateFields = {
      updatedAt: new Date(),
    };

    if (dto.title !== undefined) updateData.title = dto.title;
    if (dto.reimbursement_category !== undefined) updateData.reimbursement_category = dto.reimbursement_category;
    if (dto.amount !== undefined) updateData.amount = String(dto.amount);
    if (dto.description !== undefined) updateData.description = dto.description;
    if (dto.attachments !== undefined) updateData.attachments = dto.attachments;

    const rows = await this.db
      .update(reimbursements)
      .set(updateData)
      .where(and(eq(reimbursements.id, id), isNull(reimbursements.deletedAt)))
      .returning();


    return rows[0]!;
  }

  async remove(id: string): Promise<void> {
    await this.findOne(id);


    await this.db
      .update(reimbursements)
      .set({ deletedAt: sql`NOW()` })
      .where(and(eq(reimbursements.id, id), isNull(reimbursements.deletedAt)));
  }

  async batchRemove(ids: string[]): Promise<{ count: number }> {

    const rows = await this.db
      .update(reimbursements)
      .set({ deletedAt: sql`NOW()` })
      .where(and(inArray(reimbursements.id, ids), isNull(reimbursements.deletedAt)))
      .returning({ id: reimbursements.id });

    return { count: rows.length };
  }

}
