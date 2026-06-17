import {
  Injectable,
  Inject,
  NotFoundException,
  ConflictException,
} from '@nestjs/common';
import { eq, and, isNull, like, sql, count, inArray, gte, lte, desc, getTableColumns } from 'drizzle-orm';
import { DATABASE_CONNECTION, DrizzleDb } from '../../db/connection';
import { purchaseOrders, PurchaseOrders } from '../../db/schema/purchase-orders';
import { suppliers } from '../../db/schema/suppliers';
import { purchaseOrderItem } from '../../db/schema/purchase-orders';
import { CreatePurchaseOrderDto } from './dto/create-purchase-order.dto';
import { UpdatePurchaseOrderDto } from './dto/update-purchase-order.dto';
import { QueryPurchaseOrderDto } from './dto/query-purchase-order.dto';
import { ApiErrorCode, PaginatedData } from '@lowcode/shared';
import { SQL } from 'drizzle-orm';

@Injectable()
export class PurchaseOrderService {
  constructor(
    @Inject(DATABASE_CONNECTION) private readonly db: DrizzleDb,
  ) {}

  async findAll(query: QueryPurchaseOrderDto): Promise<PaginatedData<PurchaseOrders>> {
    const { page, pageSize, order_no, supplier_id, status } = query;
    const offset = (page - 1) * pageSize;

    const conditions: SQL[] = [isNull(purchaseOrders.deletedAt)];

    if (order_no) {
      conditions.push(like(purchaseOrders.order_no, `%${order_no}%`));
    }
    if (supplier_id) {
      conditions.push(eq(purchaseOrders.supplier_id, supplier_id));
    }
    if (status) {
      conditions.push(eq(purchaseOrders.status, status));
    }

    const whereClause = and(...conditions);

    const [rows, totalRows] = await Promise.all([
      this.db
        .select({
          ...getTableColumns(purchaseOrders),
      supplier_id_display: suppliers.name,
        })
        .from(purchaseOrders)
        .leftJoin(suppliers, eq(purchaseOrders.supplier_id, suppliers.id))
        .where(whereClause)
        .orderBy(desc(purchaseOrders.createdAt))
        .limit(pageSize)
        .offset(offset),
      this.db
        .select({ count: count() })
        .from(purchaseOrders)
        .where(whereClause),
    ]);

    const total = totalRows[0]?.count ?? 0;

    // Batch-attach child detail rows
    if (rows.length > 0) {
      const masterIds = rows.map((r) => r.id);
      const itemsRows = await this.db
        .select()
        .from(purchaseOrderItem)
        .where(and(inArray(purchaseOrderItem.purchaseOrder_id, masterIds), isNull(purchaseOrderItem.deletedAt)));
      const itemsByMaster = new Map<string, any[]>();
      for (const row of itemsRows) {
        if (row.purchaseOrder_id == null) continue;
        const arr = itemsByMaster.get(row.purchaseOrder_id) || [];
        arr.push(row);
        itemsByMaster.set(row.purchaseOrder_id, arr);
      }
      for (const row of rows) {
        (row as any).items = itemsByMaster.get(row.id) || [];
      }
    }

    return { list: rows, total, page, pageSize };
  }

  async findOne(id: string): Promise<PurchaseOrders> {
    const rows = await this.db
      .select({
        ...getTableColumns(purchaseOrders),
      supplier_id_display: suppliers.name,
      })
      .from(purchaseOrders)
        .leftJoin(suppliers, eq(purchaseOrders.supplier_id, suppliers.id))
      .where(and(eq(purchaseOrders.id, id), isNull(purchaseOrders.deletedAt)))
      .limit(1);

    if (rows.length === 0) {
      throw new NotFoundException({
        code: ApiErrorCode.RESOURCE_NOT_FOUND,
        message: `PurchaseOrder with id ${id} not found`,
      });
    }
    (rows[0] as any).items = await this.getItems(id);
    return rows[0]!;
  }

  async create(dto: CreatePurchaseOrderDto): Promise<PurchaseOrders> {
    // Check unique: order_no
    const existingByOrderNo = await this.db
      .select()
      .from(purchaseOrders)
      .where(and(eq(purchaseOrders.order_no, dto.order_no), isNull(purchaseOrders.deletedAt)))
      .limit(1);

    if (existingByOrderNo.length > 0) {
      throw new ConflictException({
        code: ApiErrorCode.PARAM_ERROR,
        message: `OrderNo '${dto.order_no}' is already taken`,
      });
    }

    return this.db.transaction(async (tx) => {
      const rows = await tx
        .insert(purchaseOrders)
        .values({
          order_no: dto.order_no,
          supplier_id: dto.supplier_id,
          order_date: dto.order_date ? new Date(dto.order_date) : new Date(),
          status: dto.status,
          remark: dto.remark,
        })
        .returning();
      const created = rows[0]!;
      if (dto.items && (dto.items as any[]).length > 0) {
        await tx.insert(purchaseOrderItem).values(
          (dto.items as any[]).map((d: any) => ({
            purchaseOrder_id: created.id,
            material_name: d.material_name,
            specification: d.specification,
            quantity: d.quantity,
            unit_price: String(d.unit_price),
            amount: String(d.amount),
          })),
        );
      }

      return created;
    });
  }

  async update(id: string, dto: UpdatePurchaseOrderDto): Promise<PurchaseOrders> {
    const existing = await this.findOne(id);


    type PurchaseOrderUpdateFields = {
      supplier_id?: string;
      order_date?: Date;
      status?: string;
      remark?: string;
      updatedAt?: Date;
    };

    const updateData: PurchaseOrderUpdateFields = {
      updatedAt: new Date(),
    };

    if (dto.supplier_id !== undefined) updateData.supplier_id = dto.supplier_id ?? undefined;
    if (dto.order_date !== undefined) updateData.order_date = dto.order_date ? new Date(dto.order_date) : undefined;
    if (dto.status !== undefined) updateData.status = dto.status;
    if (dto.remark !== undefined) updateData.remark = dto.remark;

    const rows = await this.db
      .update(purchaseOrders)
      .set(updateData)
      .where(and(eq(purchaseOrders.id, id), isNull(purchaseOrders.deletedAt)))
      .returning();

    if (dto.items !== undefined) {
      await this.updateItems(id, dto.items as any[]);
    }
    return rows[0]!;
  }

  async remove(id: string): Promise<void> {
    await this.findOne(id);

    await this.removeItems(id);

    await this.db
      .update(purchaseOrders)
      .set({ deletedAt: sql`NOW()` })
      .where(and(eq(purchaseOrders.id, id), isNull(purchaseOrders.deletedAt)));
  }

  async batchRemove(ids: string[]): Promise<{ count: number }> {
    // Remove child detail rows for each id
    for (const id of ids) {
      try {
        await this.removeItems(id);
      } catch {
        // Record may not exist, ignore
      }
    }

    const rows = await this.db
      .update(purchaseOrders)
      .set({ deletedAt: sql`NOW()` })
      .where(and(inArray(purchaseOrders.id, ids), isNull(purchaseOrders.deletedAt)))
      .returning({ id: purchaseOrders.id });

    return { count: rows.length };
  }

  async getItems(purchaseOrder_id: string): Promise<any[]> {
    const rows = await this.db
      .select()
      .from(purchaseOrderItem)
      .where(and(eq(purchaseOrderItem.purchaseOrder_id, purchaseOrder_id), isNull(purchaseOrderItem.deletedAt)));

    return rows;
  }

  async createItems(purchaseOrder_id: string, details: any[]): Promise<void> {
    if (details.length === 0) return;
    const values = details.map((d) => ({
      purchaseOrder_id,
      material_name: d.material_name,
      specification: d.specification,
      quantity: d.quantity,
      unit_price: String(d.unit_price),
      amount: String(d.amount),
    }));
    const inserted = await this.db.insert(purchaseOrderItem).values(values).returning();

  }

  async updateItems(purchaseOrder_id: string, details: any[]): Promise<void> {
    const existing = await this.getItems(purchaseOrder_id);
    const existingIds = new Set(existing.map((r) => r.id));
    const incomingIds = new Set(details.filter((d) => d.id).map((d) => d.id));

    // Soft-delete rows no longer present
    const toDelete = existing.filter((r) => !incomingIds.has(r.id));
    if (toDelete.length > 0) {

      await this.db
        .update(purchaseOrderItem)
        .set({ deletedAt: sql`NOW()` })
        .where(and(inArray(purchaseOrderItem.id, toDelete.map((r) => r.id)), isNull(purchaseOrderItem.deletedAt)));
    }

    // Update existing rows
    for (const d of details.filter((d) => d.id && existingIds.has(d.id))) {
      await this.db
        .update(purchaseOrderItem)
        .set({
          material_name: d.material_name,
          specification: d.specification,
          quantity: d.quantity,
          unit_price: String(d.unit_price),
          amount: String(d.amount),
          updatedAt: sql`NOW()`,
        })
        .where(eq(purchaseOrderItem.id, d.id));

    }

    // Insert new rows (no id or temp id)
    const newRows = details.filter((d) => !d.id);
    if (newRows.length > 0) {
      await this.createItems(purchaseOrder_id, newRows);
    }
  }

  async removeItems(purchaseOrder_id: string): Promise<void> {

    await this.db
      .update(purchaseOrderItem)
      .set({ deletedAt: sql`NOW()` })
      .where(and(eq(purchaseOrderItem.purchaseOrder_id, purchaseOrder_id), isNull(purchaseOrderItem.deletedAt)));
  }

}
