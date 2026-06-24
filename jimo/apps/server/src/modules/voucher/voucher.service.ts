import {
  Injectable,
  Inject,
  NotFoundException,
  ConflictException,
} from '@nestjs/common';
import { eq, and, isNull, like, sql, count, inArray, gte, lte, desc } from 'drizzle-orm';
import { DATABASE_CONNECTION, DrizzleDb } from '../../db/connection';
import { OwnershipHelper } from '../../common/ownership/ownership.helper';
import { vouchers, Vouchers } from '../../db/schema/vouchers';
import { voucherVoucherItem } from '../../db/schema/vouchers';
import { accounts } from '../../db/schema/accounts';
import { CreateVoucherDto } from './dto/create-voucher.dto';
import { UpdateVoucherDto } from './dto/update-voucher.dto';
import { QueryVoucherDto } from './dto/query-voucher.dto';
import { ApiErrorCode, PaginatedData } from '@jimo/shared';
import { SQL } from 'drizzle-orm';

@Injectable()
export class VoucherService {
  constructor(
    @Inject(DATABASE_CONNECTION) private readonly db: DrizzleDb,
    private readonly ownershipHelper: OwnershipHelper,
  ) {}

  async findAll(query: QueryVoucherDto, userId?: string, isAdmin: boolean = false): Promise<PaginatedData<Vouchers>> {
    const { page, pageSize, voucher_no, voucher_date, summary, prepared_by, status } = query;
    const offset = (page - 1) * pageSize;

    const conditions: SQL[] = [isNull(vouchers.deletedAt)];
    const _ownership = this.ownershipHelper.visibleCondition(vouchers.ownerId, vouchers.sharedWith, userId, isAdmin, 'private');
    if (_ownership) conditions.push(_ownership);

    if (voucher_no) {
      conditions.push(like(vouchers.voucher_no, `%${voucher_no}%`));
    }
    if (voucher_date) {
      conditions.push(eq(vouchers.voucher_date, new Date(voucher_date)));
    }
    if (summary) {
      conditions.push(like(vouchers.summary, `%${summary}%`));
    }
    if (prepared_by) {
      conditions.push(like(vouchers.prepared_by, `%${prepared_by}%`));
    }
    if (status) {
      conditions.push(eq(vouchers.status, status));
    }

    const whereClause = and(...conditions);

    const [rows, totalRows] = await Promise.all([
      this.db
        .select()
        .from(vouchers)
        .where(whereClause)
        .orderBy(desc(vouchers.createdAt))
        .limit(pageSize)
        .offset(offset),
      this.db
        .select({ count: count() })
        .from(vouchers)
        .where(whereClause),
    ]);

    const total = totalRows[0]?.count ?? 0;

    // Batch-attach child detail rows
    if (rows.length > 0) {
      const masterIds = rows.map((r) => r.id);
      const voucher_itemsRows = await this.db
        .select({
          id: voucherVoucherItem.id,
          voucher_id: voucherVoucherItem.voucher_id,
          account: voucherVoucherItem.account,
          summary: voucherVoucherItem.summary,
          debit_amount: voucherVoucherItem.debit_amount,
          credit_amount: voucherVoucherItem.credit_amount,
          account_display: accounts.name,
        })
        .from(voucherVoucherItem)
            .leftJoin(accounts, eq(voucherVoucherItem.account, accounts.id))
        .where(and(inArray(voucherVoucherItem.voucher_id, masterIds), isNull(voucherVoucherItem.deletedAt)));
      const voucher_itemsByMaster = new Map<string, any[]>();
      for (const row of voucher_itemsRows) {
        if (row.voucher_id == null) continue;
        const arr = voucher_itemsByMaster.get(row.voucher_id) || [];
        arr.push(row);
        voucher_itemsByMaster.set(row.voucher_id, arr);
      }
      for (const row of rows) {
        (row as any).voucher_items = voucher_itemsByMaster.get(row.id) || [];
      }
    }

    return { list: rows, total, page, pageSize };
  }

  async findOne(id: string, userId?: string, isAdmin: boolean = false): Promise<Vouchers> {
    const conditions = [eq(vouchers.id, id), isNull(vouchers.deletedAt)];
    const _ownership = this.ownershipHelper.visibleCondition(vouchers.ownerId, vouchers.sharedWith, userId, isAdmin, 'private');
    if (_ownership) conditions.push(_ownership);
    const rows = await this.db
      .select()
      .from(vouchers)
      .where(and(...conditions))
      .limit(1);

    if (rows.length === 0) {
      throw new NotFoundException({
        code: ApiErrorCode.RESOURCE_NOT_FOUND,
        message: `Voucher with id ${id} not found`,
      });
    }
    (rows[0] as any).voucher_items = await this.getVoucherItems(id);
    return rows[0]!;
  }

  async create(dto: CreateVoucherDto, userId?: string): Promise<Vouchers> {
    // Check unique: voucher_no
    const existingByVoucherNo = await this.db
      .select()
      .from(vouchers)
      .where(and(eq(vouchers.voucher_no, dto.voucher_no), isNull(vouchers.deletedAt)))
      .limit(1);

    if (existingByVoucherNo.length > 0) {
      throw new ConflictException({
        code: ApiErrorCode.PARAM_ERROR,
        message: `VoucherNo '${dto.voucher_no}' is already taken`,
      });
    }

    return this.db.transaction(async (tx) => {
      const rows = await tx
        .insert(vouchers)
        .values({
          ownerId: userId,
          voucher_no: dto.voucher_no,
          voucher_date: dto.voucher_date ? new Date(dto.voucher_date) : new Date(),
          summary: dto.summary,
          prepared_by: dto.prepared_by,
          status: dto.status,
        })
        .returning();
      const created = rows[0]!;
      if (dto.voucher_items && (dto.voucher_items as any[]).length > 0) {
        await tx.insert(voucherVoucherItem).values(
          (dto.voucher_items as any[]).map((d: any) => ({
            voucher_id: created.id,
            account: d.account,
            summary: d.summary,
            debit_amount: String(d.debit_amount),
            credit_amount: String(d.credit_amount),
          })),
        );
      }

      return created;
    });
  }

  async update(id: string, dto: UpdateVoucherDto, userId?: string, isAdmin: boolean = false): Promise<Vouchers> {
    const existing = await this.findOne(id, userId, isAdmin);


    type VoucherUpdateFields = {
      voucher_date?: Date;
      summary?: string;
      status?: string;
      updatedAt?: Date;
    };

    const updateData: VoucherUpdateFields = {
      updatedAt: new Date(),
    };

    if (dto.voucher_date !== undefined) updateData.voucher_date = dto.voucher_date ? new Date(dto.voucher_date) : undefined;
    if (dto.summary !== undefined) updateData.summary = dto.summary;
    if (dto.status !== undefined) updateData.status = dto.status;

    const rows = await this.db
      .update(vouchers)
      .set(updateData)
      .where(
        isAdmin
          ? and(eq(vouchers.id, id), isNull(vouchers.deletedAt))
          : and(eq(vouchers.id, id), isNull(vouchers.deletedAt), eq(vouchers.ownerId, userId!)),
      )
      .returning();

    if (dto.voucher_items !== undefined) {
      await this.updateVoucherItems(id, dto.voucher_items as any[]);
    }
    return rows[0]!;
  }

  async remove(id: string, userId?: string, isAdmin: boolean = false): Promise<void> {
    await this.findOne(id, userId, isAdmin);

    await this.removeVoucherItems(id);

    await this.db
      .update(vouchers)
      .set({ deletedAt: sql`NOW()` })
      .where(
        isAdmin
          ? and(eq(vouchers.id, id), isNull(vouchers.deletedAt))
          : and(eq(vouchers.id, id), isNull(vouchers.deletedAt), eq(vouchers.ownerId, userId!)),
      );
  }

  async batchRemove(ids: string[], userId?: string, isAdmin: boolean = false): Promise<{ count: number }> {
    // Remove child detail rows for each id
    for (const id of ids) {
      try {
        await this.removeVoucherItems(id);
      } catch {
        // Record may not exist, ignore
      }
    }

    const rows = await this.db
      .update(vouchers)
      .set({ deletedAt: sql`NOW()` })
      .where(
        isAdmin
          ? and(inArray(vouchers.id, ids), isNull(vouchers.deletedAt))
          : and(inArray(vouchers.id, ids), isNull(vouchers.deletedAt), eq(vouchers.ownerId, userId!)),
      )
      .returning({ id: vouchers.id });

    return { count: rows.length };
  }

  async getVoucherItems(voucher_id: string): Promise<any[]> {
    const rows = await this.db
      .select({
      id: voucherVoucherItem.id,
      voucher_id: voucherVoucherItem.voucher_id,
      account: voucherVoucherItem.account,
      summary: voucherVoucherItem.summary,
      debit_amount: voucherVoucherItem.debit_amount,
      credit_amount: voucherVoucherItem.credit_amount,
      account_display: accounts.name,
    })
      .from(voucherVoucherItem)
        .leftJoin(accounts, eq(voucherVoucherItem.account, accounts.id))
      .where(and(eq(voucherVoucherItem.voucher_id, voucher_id), isNull(voucherVoucherItem.deletedAt)));

    return rows;
  }

  async createVoucherItems(voucher_id: string, details: any[]): Promise<void> {
    if (details.length === 0) return;
    const values = details.map((d) => ({
      voucher_id,
      account: d.account,
      summary: d.summary,
      debit_amount: String(d.debit_amount),
      credit_amount: String(d.credit_amount),
    }));
    const inserted = await this.db.insert(voucherVoucherItem).values(values).returning();

  }

  async updateVoucherItems(voucher_id: string, details: any[]): Promise<void> {
    const existing = await this.getVoucherItems(voucher_id);
    const existingIds = new Set(existing.map((r) => r.id));
    const incomingIds = new Set(details.filter((d) => d.id).map((d) => d.id));

    // Soft-delete rows no longer present
    const toDelete = existing.filter((r) => !incomingIds.has(r.id));
    if (toDelete.length > 0) {

      await this.db
        .update(voucherVoucherItem)
        .set({ deletedAt: sql`NOW()` })
        .where(and(inArray(voucherVoucherItem.id, toDelete.map((r) => r.id)), isNull(voucherVoucherItem.deletedAt)));
    }

    // Update existing rows
    for (const d of details.filter((d) => d.id && existingIds.has(d.id))) {
      await this.db
        .update(voucherVoucherItem)
        .set({
          account: d.account,
          summary: d.summary,
          debit_amount: String(d.debit_amount),
          credit_amount: String(d.credit_amount),
          updatedAt: sql`NOW()`,
        })
        .where(eq(voucherVoucherItem.id, d.id));

    }

    // Insert new rows (no id or temp id)
    const newRows = details.filter((d) => !d.id);
    if (newRows.length > 0) {
      await this.createVoucherItems(voucher_id, newRows);
    }
  }

  async removeVoucherItems(voucher_id: string): Promise<void> {

    await this.db
      .update(voucherVoucherItem)
      .set({ deletedAt: sql`NOW()` })
      .where(and(eq(voucherVoucherItem.voucher_id, voucher_id), isNull(voucherVoucherItem.deletedAt)));
  }

}
