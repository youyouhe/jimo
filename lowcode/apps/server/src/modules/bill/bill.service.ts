import {
  Injectable,
  Inject,
  NotFoundException,
  ConflictException,
} from '@nestjs/common';
import { eq, and, isNull, like, sql, count, inArray, gte, lte, desc, getTableColumns } from 'drizzle-orm';
import { DATABASE_CONNECTION, DrizzleDb } from '../../db/connection';
import { bills, Bills } from '../../db/schema/bills';
import { projects } from '../../db/schema/projects';
import { billBillItem } from '../../db/schema/bills';
import { CreateBillDto } from './dto/create-bill.dto';
import { UpdateBillDto } from './dto/update-bill.dto';
import { QueryBillDto } from './dto/query-bill.dto';
import { ApiErrorCode, PaginatedData } from '@lowcode/shared';
import { SQL } from 'drizzle-orm';

@Injectable()
export class BillService {
  constructor(
    @Inject(DATABASE_CONNECTION) private readonly db: DrizzleDb,
  ) {}

  async findAll(query: QueryBillDto): Promise<PaginatedData<Bills>> {
    const { page, pageSize, bill_no, bill_name, status, project_id } = query;
    const offset = (page - 1) * pageSize;

    const conditions: SQL[] = [isNull(bills.deletedAt)];

    if (bill_no) {
      conditions.push(like(bills.bill_no, `%${bill_no}%`));
    }
    if (bill_name) {
      conditions.push(like(bills.bill_name, `%${bill_name}%`));
    }
    if (status) {
      conditions.push(eq(bills.status, status));
    }
    if (project_id) {
      conditions.push(eq(bills.project_id, project_id));
    }

    const whereClause = and(...conditions);

    const [rows, totalRows] = await Promise.all([
      this.db
        .select({
          ...getTableColumns(bills),
      project_id_display: projects.name,
        })
        .from(bills)
        .leftJoin(projects, eq(bills.project_id, projects.id))
        .where(whereClause)
        .orderBy(desc(bills.createdAt))
        .limit(pageSize)
        .offset(offset),
      this.db
        .select({ count: count() })
        .from(bills)
        .where(whereClause),
    ]);

    const total = totalRows[0]?.count ?? 0;

    // Batch-attach child detail rows
    if (rows.length > 0) {
      const masterIds = rows.map((r) => r.id);
      const bill_itemsRows = await this.db
        .select()
        .from(billBillItem)
        .where(and(inArray(billBillItem.bill_id, masterIds), isNull(billBillItem.deletedAt)));
      const bill_itemsByMaster = new Map<string, any[]>();
      for (const row of bill_itemsRows) {
        if (row.bill_id == null) continue;
        const arr = bill_itemsByMaster.get(row.bill_id) || [];
        arr.push(row);
        bill_itemsByMaster.set(row.bill_id, arr);
      }
      for (const row of rows) {
        (row as any).bill_items = bill_itemsByMaster.get(row.id) || [];
      }
    }

    return { list: rows, total, page, pageSize };
  }

  async findOne(id: string): Promise<Bills> {
    const rows = await this.db
      .select({
        ...getTableColumns(bills),
      project_id_display: projects.name,
      })
      .from(bills)
        .leftJoin(projects, eq(bills.project_id, projects.id))
      .where(and(eq(bills.id, id), isNull(bills.deletedAt)))
      .limit(1);

    if (rows.length === 0) {
      throw new NotFoundException({
        code: ApiErrorCode.RESOURCE_NOT_FOUND,
        message: `Bill with id ${id} not found`,
      });
    }
    (rows[0] as any).bill_items = await this.getBillItems(id);
    return rows[0]!;
  }

  async create(dto: CreateBillDto): Promise<Bills> {
    // Check unique: bill_no
    const existingByBillNo = await this.db
      .select()
      .from(bills)
      .where(and(eq(bills.bill_no, dto.bill_no), isNull(bills.deletedAt)))
      .limit(1);

    if (existingByBillNo.length > 0) {
      throw new ConflictException({
        code: ApiErrorCode.PARAM_ERROR,
        message: `BillNo '${dto.bill_no}' is already taken`,
      });
    }

    return this.db.transaction(async (tx) => {
      const rows = await tx
        .insert(bills)
        .values({
          bill_no: dto.bill_no,
          bill_name: dto.bill_name,
          bill_date: dto.bill_date ? new Date(dto.bill_date) : new Date(),
          amount: String(dto.amount),
          status: dto.status,
          project_id: dto.project_id,
          remark: dto.remark,
        })
        .returning();
      const created = rows[0]!;
      if (dto.bill_items && (dto.bill_items as any[]).length > 0) {
        await tx.insert(billBillItem).values(
          (dto.bill_items as any[]).map((d: any) => ({
            bill_id: created.id,
            item_name: d.item_name,
            quantity: d.quantity,
            unit_price: String(d.unit_price),
            amount: String(d.amount),
            description: d.description,
          })),
        );
      }

      return created;
    });
  }

  async update(id: string, dto: UpdateBillDto): Promise<Bills> {
    const existing = await this.findOne(id);

    if (dto.bill_no && dto.bill_no !== existing.bill_no) {
      const bill_noConflict = await this.db
        .select()
        .from(bills)
        .where(and(eq(bills.bill_no, dto.bill_no), isNull(bills.deletedAt)))
        .limit(1);

      if (bill_noConflict.length > 0) {
        throw new ConflictException({
          code: ApiErrorCode.PARAM_ERROR,
          message: `BillNo '${dto.bill_no}' is already taken`,
        });
      }
    }

    type BillUpdateFields = {
      bill_no?: string;
      bill_name?: string;
      bill_date?: Date;
      status?: string;
      project_id?: string;
      remark?: string;
      updatedAt?: Date;
    };

    const updateData: BillUpdateFields = {
      updatedAt: new Date(),
    };

    if (dto.bill_no !== undefined) updateData.bill_no = dto.bill_no;
    if (dto.bill_name !== undefined) updateData.bill_name = dto.bill_name;
    if (dto.bill_date !== undefined) updateData.bill_date = dto.bill_date ? new Date(dto.bill_date) : undefined;
    if (dto.status !== undefined) updateData.status = dto.status;
    if (dto.project_id !== undefined) updateData.project_id = dto.project_id ?? undefined;
    if (dto.remark !== undefined) updateData.remark = dto.remark;

    const rows = await this.db
      .update(bills)
      .set(updateData)
      .where(and(eq(bills.id, id), isNull(bills.deletedAt)))
      .returning();

    if (dto.bill_items !== undefined) {
      await this.updateBillItems(id, dto.bill_items as any[]);
    }
    return rows[0]!;
  }

  async remove(id: string): Promise<void> {
    await this.findOne(id);

    await this.removeBillItems(id);

    await this.db
      .update(bills)
      .set({ deletedAt: sql`NOW()` })
      .where(and(eq(bills.id, id), isNull(bills.deletedAt)));
  }

  async batchRemove(ids: string[]): Promise<{ count: number }> {
    // Remove child detail rows for each id
    for (const id of ids) {
      try {
        await this.removeBillItems(id);
      } catch {
        // Record may not exist, ignore
      }
    }

    const rows = await this.db
      .update(bills)
      .set({ deletedAt: sql`NOW()` })
      .where(and(inArray(bills.id, ids), isNull(bills.deletedAt)))
      .returning({ id: bills.id });

    return { count: rows.length };
  }

  async getBillItems(bill_id: string): Promise<any[]> {
    const rows = await this.db
      .select()
      .from(billBillItem)
      .where(and(eq(billBillItem.bill_id, bill_id), isNull(billBillItem.deletedAt)));

    return rows;
  }

  async createBillItems(bill_id: string, details: any[]): Promise<void> {
    if (details.length === 0) return;
    const values = details.map((d) => ({
      bill_id,
      item_name: d.item_name,
      quantity: d.quantity,
      unit_price: String(d.unit_price),
      amount: String(d.amount),
      description: d.description,
    }));
    const inserted = await this.db.insert(billBillItem).values(values).returning();

  }

  async updateBillItems(bill_id: string, details: any[]): Promise<void> {
    const existing = await this.getBillItems(bill_id);
    const existingIds = new Set(existing.map((r) => r.id));
    const incomingIds = new Set(details.filter((d) => d.id).map((d) => d.id));

    // Soft-delete rows no longer present
    const toDelete = existing.filter((r) => !incomingIds.has(r.id));
    if (toDelete.length > 0) {

      await this.db
        .update(billBillItem)
        .set({ deletedAt: sql`NOW()` })
        .where(and(inArray(billBillItem.id, toDelete.map((r) => r.id)), isNull(billBillItem.deletedAt)));
    }

    // Update existing rows
    for (const d of details.filter((d) => d.id && existingIds.has(d.id))) {
      await this.db
        .update(billBillItem)
        .set({
          item_name: d.item_name,
          quantity: d.quantity,
          unit_price: String(d.unit_price),
          amount: String(d.amount),
          description: d.description,
          updatedAt: sql`NOW()`,
        })
        .where(eq(billBillItem.id, d.id));

    }

    // Insert new rows (no id or temp id)
    const newRows = details.filter((d) => !d.id);
    if (newRows.length > 0) {
      await this.createBillItems(bill_id, newRows);
    }
  }

  async removeBillItems(bill_id: string): Promise<void> {

    await this.db
      .update(billBillItem)
      .set({ deletedAt: sql`NOW()` })
      .where(and(eq(billBillItem.bill_id, bill_id), isNull(billBillItem.deletedAt)));
  }

}
