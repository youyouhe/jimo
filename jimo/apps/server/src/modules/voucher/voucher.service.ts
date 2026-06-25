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
import { voucherItem } from '../../db/schema/vouchers';
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
    const { page, pageSize, voucher_number, voucher_date, summary, status } = query;
    const offset = (page - 1) * pageSize;

    const conditions: SQL[] = [isNull(vouchers.deletedAt)];
    const _ownership = this.ownershipHelper.visibleCondition(vouchers.ownerId, vouchers.sharedWith, userId, isAdmin, 'private');
    if (_ownership) conditions.push(_ownership);

    if (voucher_number) {
      conditions.push(like(vouchers.voucher_number, `%${voucher_number}%`));
    }
    if (voucher_date) {
      conditions.push(eq(vouchers.voucher_date, new Date(voucher_date)));
    }
    if (summary) {
      conditions.push(like(vouchers.summary, `%${summary}%`));
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
      const itemsRows = await this.db
        .select({
          id: voucherItem.id,
          voucher_id: voucherItem.voucher_id,
          account_id: voucherItem.account_id,
          debit_amount: voucherItem.debit_amount,
          credit_amount: voucherItem.credit_amount,
          summary: voucherItem.summary,
          sort_order: voucherItem.sort_order,
          account_id_display: accounts.name,
        })
        .from(voucherItem)
            .leftJoin(accounts, eq(voucherItem.account_id, accounts.id))
        .where(and(inArray(voucherItem.voucher_id, masterIds), isNull(voucherItem.deletedAt)));
      const itemsByMaster = new Map<string, any[]>();
      for (const row of itemsRows) {
        if (row.voucher_id == null) continue;
        const arr = itemsByMaster.get(row.voucher_id) || [];
        arr.push(row);
        itemsByMaster.set(row.voucher_id, arr);
      }
      for (const row of rows) {
        (row as any).items = itemsByMaster.get(row.id) || [];
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
    (rows[0] as any).items = await this.getItems(id);
    return rows[0]!;
  }

  async create(dto: CreateVoucherDto, userId?: string): Promise<Vouchers> {
    // Check unique: voucher_number
    const existingByVoucherNumber = await this.db
      .select()
      .from(vouchers)
      .where(and(eq(vouchers.voucher_number, dto.voucher_number), isNull(vouchers.deletedAt)))
      .limit(1);

    if (existingByVoucherNumber.length > 0) {
      throw new ConflictException({
        code: ApiErrorCode.PARAM_ERROR,
        message: `VoucherNumber '${dto.voucher_number}' is already taken`,
      });
    }

    return this.db.transaction(async (tx) => {
      const rows = await tx
        .insert(vouchers)
        .values({
          ownerId: userId,
          voucher_number: dto.voucher_number,
          voucher_date: dto.voucher_date ? new Date(dto.voucher_date) : new Date(),
          summary: dto.summary,
          status: dto.status,
          attachment: dto.attachment,
        })
        .returning();
      const created = rows[0]!;
      if (dto.items && (dto.items as any[]).length > 0) {
        await tx.insert(voucherItem).values(
          (dto.items as any[]).map((d: any) => ({
            voucher_id: created.id,
            account_id: d.account_id,
            debit_amount: String(d.debit_amount),
            credit_amount: String(d.credit_amount),
            summary: d.summary,
            sort_order: d.sort_order,
          })),
        );
      }

      return created;
    });
  }

  async update(id: string, dto: UpdateVoucherDto, userId?: string, isAdmin: boolean = false): Promise<Vouchers> {
    const existing = await this.findOne(id, userId, isAdmin);

    if (dto.voucher_number && dto.voucher_number !== existing.voucher_number) {
      const voucher_numberConflict = await this.db
        .select()
        .from(vouchers)
        .where(and(eq(vouchers.voucher_number, dto.voucher_number), isNull(vouchers.deletedAt)))
        .limit(1);

      if (voucher_numberConflict.length > 0) {
        throw new ConflictException({
          code: ApiErrorCode.PARAM_ERROR,
          message: `VoucherNumber '${dto.voucher_number}' is already taken`,
        });
      }
    }

    type VoucherUpdateFields = {
      voucher_number?: string;
      voucher_date?: Date;
      summary?: string;
      status?: string;
      attachment?: string;
      updatedAt?: Date;
    };

    const updateData: VoucherUpdateFields = {
      updatedAt: new Date(),
    };

    if (dto.voucher_number !== undefined) updateData.voucher_number = dto.voucher_number;
    if (dto.voucher_date !== undefined) updateData.voucher_date = dto.voucher_date ? new Date(dto.voucher_date) : undefined;
    if (dto.summary !== undefined) updateData.summary = dto.summary;
    if (dto.status !== undefined) updateData.status = dto.status;
    if (dto.attachment !== undefined) updateData.attachment = dto.attachment;

    const rows = await this.db
      .update(vouchers)
      .set(updateData)
      .where(
        isAdmin
          ? and(eq(vouchers.id, id), isNull(vouchers.deletedAt))
          : and(eq(vouchers.id, id), isNull(vouchers.deletedAt), eq(vouchers.ownerId, userId!)),
      )
      .returning();

    if (dto.items !== undefined) {
      await this.updateItems(id, dto.items as any[]);
    }
    return rows[0]!;
  }

  async remove(id: string, userId?: string, isAdmin: boolean = false): Promise<void> {
    await this.findOne(id, userId, isAdmin);

    await this.removeItems(id);

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
        await this.removeItems(id);
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

  async getItems(voucher_id: string): Promise<any[]> {
    const rows = await this.db
      .select({
      id: voucherItem.id,
      voucher_id: voucherItem.voucher_id,
      account_id: voucherItem.account_id,
      debit_amount: voucherItem.debit_amount,
      credit_amount: voucherItem.credit_amount,
      summary: voucherItem.summary,
      sort_order: voucherItem.sort_order,
      
      account_id_display: accounts.name,
    })
      .from(voucherItem)
        .leftJoin(accounts, eq(voucherItem.account_id, accounts.id))
      .where(and(eq(voucherItem.voucher_id, voucher_id), isNull(voucherItem.deletedAt)));

    return rows;
  }

  async createItems(voucher_id: string, details: any[]): Promise<void> {
    if (details.length === 0) return;
    const values = details.map((d) => ({
      voucher_id,
      account_id: d.account_id,
      debit_amount: String(d.debit_amount),
      credit_amount: String(d.credit_amount),
      summary: d.summary,
      sort_order: d.sort_order,
    }));
    const inserted = await this.db.insert(voucherItem).values(values).returning();

  }

  async updateItems(voucher_id: string, details: any[]): Promise<void> {
    const existing = await this.getItems(voucher_id);
    const existingIds = new Set(existing.map((r) => r.id));
    const incomingIds = new Set(details.filter((d) => d.id).map((d) => d.id));

    // Soft-delete rows no longer present
    const toDelete = existing.filter((r) => !incomingIds.has(r.id));
    if (toDelete.length > 0) {

      await this.db
        .update(voucherItem)
        .set({ deletedAt: sql`NOW()` })
        .where(and(inArray(voucherItem.id, toDelete.map((r) => r.id)), isNull(voucherItem.deletedAt)));
    }

    // Update existing rows
    for (const d of details.filter((d) => d.id && existingIds.has(d.id))) {
      await this.db
        .update(voucherItem)
        .set({
          account_id: d.account_id,
          debit_amount: String(d.debit_amount),
          credit_amount: String(d.credit_amount),
          summary: d.summary,
          sort_order: d.sort_order,
          updatedAt: sql`NOW()`,
        })
        .where(eq(voucherItem.id, d.id));

    }

    // Insert new rows (no id or temp id)
    const newRows = details.filter((d) => !d.id);
    if (newRows.length > 0) {
      await this.createItems(voucher_id, newRows);
    }
  }

  async removeItems(voucher_id: string): Promise<void> {

    await this.db
      .update(voucherItem)
      .set({ deletedAt: sql`NOW()` })
      .where(and(eq(voucherItem.voucher_id, voucher_id), isNull(voucherItem.deletedAt)));
  }

}
