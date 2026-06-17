import {
  Injectable,
  Inject,
  NotFoundException,
  ConflictException,
} from '@nestjs/common';
import { eq, and, isNull, like, sql, count, inArray, gte, lte, desc } from 'drizzle-orm';
import { DATABASE_CONNECTION, DrizzleDb } from '../../db/connection';
import { orders, Orders } from '../../db/schema/orders';
import { orderOrderItem } from '../../db/schema/orders';
import { orderOrderItemProductBatche } from '../../db/schema/orders';
import { CreateOrderDto } from './dto/create-order.dto';
import { UpdateOrderDto } from './dto/update-order.dto';
import { QueryOrderDto } from './dto/query-order.dto';
import { ApiErrorCode, PaginatedData } from '@lowcode/shared';
import { SQL } from 'drizzle-orm';

@Injectable()
export class OrderService {
  constructor(
    @Inject(DATABASE_CONNECTION) private readonly db: DrizzleDb,
  ) {}

  async findAll(query: QueryOrderDto): Promise<PaginatedData<Orders>> {
    const { page, pageSize, order_no, customer_name, order_status, order_date } = query;
    const offset = (page - 1) * pageSize;

    const conditions: SQL[] = [isNull(orders.deletedAt)];

    if (order_no) {
      conditions.push(like(orders.order_no, `%${order_no}%`));
    }
    if (customer_name) {
      conditions.push(like(orders.customer_name, `%${customer_name}%`));
    }
    if (order_status) {
      conditions.push(eq(orders.order_status, order_status));
    }
    if (order_date) {
      conditions.push(eq(orders.order_date, new Date(order_date)));
    }

    const whereClause = and(...conditions);

    const [rows, totalRows] = await Promise.all([
      this.db
        .select()
        .from(orders)
        .where(whereClause)
        .orderBy(desc(orders.createdAt))
        .limit(pageSize)
        .offset(offset),
      this.db
        .select({ count: count() })
        .from(orders)
        .where(whereClause),
    ]);

    const total = totalRows[0]?.count ?? 0;

    // Batch-attach child detail rows
    if (rows.length > 0) {
      const masterIds = rows.map((r) => r.id);
      const order_itemsRows = await this.db
        .select()
        .from(orderOrderItem)
        .where(and(inArray(orderOrderItem.order_id, masterIds), isNull(orderOrderItem.deletedAt)));
      // Batch-attach grandchild product_batches onto each order_item
      if (order_itemsRows.length > 0) {
        const childIds = order_itemsRows.map((r) => r.id);
        const product_batchesRows = await this.db.select().from(orderOrderItemProductBatche).where(and(inArray(orderOrderItemProductBatche.orderOrderItem_id, childIds), isNull(orderOrderItemProductBatche.deletedAt)));
        const product_batchesByChild = new Map<string, any[]>();
        for (const r of product_batchesRows) { if (r.orderOrderItem_id == null) continue; const a = product_batchesByChild.get(r.orderOrderItem_id) || []; a.push(r); product_batchesByChild.set(r.orderOrderItem_id, a); }
        for (const r of order_itemsRows) { (r as any).product_batches = product_batchesByChild.get(r.id) || []; }
      }
      const order_itemsByMaster = new Map<string, any[]>();
      for (const row of order_itemsRows) {
        if (row.order_id == null) continue;
        const arr = order_itemsByMaster.get(row.order_id) || [];
        arr.push(row);
        order_itemsByMaster.set(row.order_id, arr);
      }
      for (const row of rows) {
        (row as any).order_items = order_itemsByMaster.get(row.id) || [];
      }
    }

    return { list: rows, total, page, pageSize };
  }

  async findOne(id: string): Promise<Orders> {
    const rows = await this.db
      .select()
      .from(orders)
      .where(and(eq(orders.id, id), isNull(orders.deletedAt)))
      .limit(1);

    if (rows.length === 0) {
      throw new NotFoundException({
        code: ApiErrorCode.RESOURCE_NOT_FOUND,
        message: `Order with id ${id} not found`,
      });
    }
    (rows[0] as any).order_items = await this.getOrderItems(id);
    return rows[0]!;
  }

  async create(dto: CreateOrderDto): Promise<Orders> {
    // Check unique: order_no
    const existingByOrderNo = await this.db
      .select()
      .from(orders)
      .where(and(eq(orders.order_no, dto.order_no), isNull(orders.deletedAt)))
      .limit(1);

    if (existingByOrderNo.length > 0) {
      throw new ConflictException({
        code: ApiErrorCode.PARAM_ERROR,
        message: `OrderNo '${dto.order_no}' is already taken`,
      });
    }

    return this.db.transaction(async (tx) => {
      const rows = await tx
        .insert(orders)
        .values({
          order_no: dto.order_no,
          customer_name: dto.customer_name,
          order_status: dto.order_status,
          total_amount: String(dto.total_amount),
          order_date: dto.order_date ? new Date(dto.order_date) : new Date(),
        })
        .returning();
      const created = rows[0]!;
      if (dto.order_items && (dto.order_items as any[]).length > 0) {
        await tx.insert(orderOrderItem).values(
          (dto.order_items as any[]).map((d: any) => ({
            order_id: created.id,
            product_name: d.product_name,
            quantity: d.quantity,
            unit_price: String(d.unit_price),
            subtotal: String(d.subtotal),
            product_batches: d.product_batches,
          })),
        );
      }

      return created;
    });
  }

  async update(id: string, dto: UpdateOrderDto): Promise<Orders> {
    const existing = await this.findOne(id);

    if (dto.order_no && dto.order_no !== existing.order_no) {
      const order_noConflict = await this.db
        .select()
        .from(orders)
        .where(and(eq(orders.order_no, dto.order_no), isNull(orders.deletedAt)))
        .limit(1);

      if (order_noConflict.length > 0) {
        throw new ConflictException({
          code: ApiErrorCode.PARAM_ERROR,
          message: `OrderNo '${dto.order_no}' is already taken`,
        });
      }
    }

    type OrderUpdateFields = {
      order_no?: string;
      customer_name?: string;
      order_status?: string;
      total_amount?: string;
      order_date?: Date;
      updatedAt?: Date;
    };

    const updateData: OrderUpdateFields = {
      updatedAt: new Date(),
    };

    if (dto.order_no !== undefined) updateData.order_no = dto.order_no;
    if (dto.customer_name !== undefined) updateData.customer_name = dto.customer_name;
    if (dto.order_status !== undefined) updateData.order_status = dto.order_status;
    if (dto.total_amount !== undefined) updateData.total_amount = String(dto.total_amount);
    if (dto.order_date !== undefined) updateData.order_date = dto.order_date ? new Date(dto.order_date) : undefined;

    const rows = await this.db
      .update(orders)
      .set(updateData)
      .where(and(eq(orders.id, id), isNull(orders.deletedAt)))
      .returning();

    if (dto.order_items !== undefined) {
      await this.updateOrderItems(id, dto.order_items as any[]);
    }
    return rows[0]!;
  }

  async remove(id: string): Promise<void> {
    await this.findOne(id);

    await this.removeOrderItems(id);

    await this.db
      .update(orders)
      .set({ deletedAt: sql`NOW()` })
      .where(and(eq(orders.id, id), isNull(orders.deletedAt)));
  }

  async batchRemove(ids: string[]): Promise<{ count: number }> {
    // Remove child detail rows for each id
    for (const id of ids) {
      try {
        await this.removeOrderItems(id);
      } catch {
        // Record may not exist, ignore
      }
    }

    const rows = await this.db
      .update(orders)
      .set({ deletedAt: sql`NOW()` })
      .where(and(inArray(orders.id, ids), isNull(orders.deletedAt)))
      .returning({ id: orders.id });

    return { count: rows.length };
  }

  async getOrderItems(order_id: string): Promise<any[]> {
    const rows = await this.db
      .select()
      .from(orderOrderItem)
      .where(and(eq(orderOrderItem.order_id, order_id), isNull(orderOrderItem.deletedAt)));

    if (rows.length > 0) {
      const childIds = rows.map((r) => r.id);
      const product_batchesRows = await this.db.select().from(orderOrderItemProductBatche).where(and(inArray(orderOrderItemProductBatche.orderOrderItem_id, childIds), isNull(orderOrderItemProductBatche.deletedAt)));
      const product_batchesByChild = new Map<string, any[]>();
      for (const r of product_batchesRows) { if (r.orderOrderItem_id == null) continue; const a = product_batchesByChild.get(r.orderOrderItem_id) || []; a.push(r); product_batchesByChild.set(r.orderOrderItem_id, a); }
      for (const r of rows) { (r as any).product_batches = product_batchesByChild.get(r.id) || []; }
    }
    return rows;
  }

  async createOrderItems(order_id: string, details: any[]): Promise<void> {
    if (details.length === 0) return;
    const values = details.map((d) => ({
      order_id,
      product_name: d.product_name,
      quantity: d.quantity,
      unit_price: String(d.unit_price),
      subtotal: String(d.subtotal),
    }));
    const inserted = await this.db.insert(orderOrderItem).values(values).returning();
    for (let i = 0; i < inserted.length; i++) {
      const d = details[i];
      const childId = inserted[i].id;
      if (d.product_batches && (d.product_batches as any[]).length > 0) {
        await this.createOrderItemsProductBatches(childId, d.product_batches as any[]);
      }
    }
  }

  async updateOrderItems(order_id: string, details: any[]): Promise<void> {
    const existing = await this.getOrderItems(order_id);
    const existingIds = new Set(existing.map((r) => r.id));
    const incomingIds = new Set(details.filter((d) => d.id).map((d) => d.id));

    // Soft-delete rows no longer present
    const toDelete = existing.filter((r) => !incomingIds.has(r.id));
    if (toDelete.length > 0) {
      for (const del of toDelete) {
        await this.removeOrderItemsProductBatches(del.id);
      }
      await this.db
        .update(orderOrderItem)
        .set({ deletedAt: sql`NOW()` })
        .where(and(inArray(orderOrderItem.id, toDelete.map((r) => r.id)), isNull(orderOrderItem.deletedAt)));
    }

    // Update existing rows
    for (const d of details.filter((d) => d.id && existingIds.has(d.id))) {
      await this.db
        .update(orderOrderItem)
        .set({
          product_name: d.product_name,
          quantity: d.quantity,
          unit_price: String(d.unit_price),
          subtotal: String(d.subtotal),
          updatedAt: sql`NOW()`,
        })
        .where(eq(orderOrderItem.id, d.id));
      if (d.product_batches !== undefined) {
        await this.updateOrderItemsProductBatches(d.id, d.product_batches as any[]);
      }
    }

    // Insert new rows (no id or temp id)
    const newRows = details.filter((d) => !d.id);
    if (newRows.length > 0) {
      await this.createOrderItems(order_id, newRows);
    }
  }

  async removeOrderItems(order_id: string): Promise<void> {
    const childRows = await this.db.select({ id: orderOrderItem.id }).from(orderOrderItem).where(and(eq(orderOrderItem.order_id, order_id), isNull(orderOrderItem.deletedAt)));
    for (const cr of childRows) {
      await this.removeOrderItemsProductBatches(cr.id);
    }
    await this.db
      .update(orderOrderItem)
      .set({ deletedAt: sql`NOW()` })
      .where(and(eq(orderOrderItem.order_id, order_id), isNull(orderOrderItem.deletedAt)));
  }

  async getOrderItemsProductBatches(orderOrderItem_id: string): Promise<any[]> {
    return this.db
      .select()
      .from(orderOrderItemProductBatche)
      .where(and(eq(orderOrderItemProductBatche.orderOrderItem_id, orderOrderItem_id), isNull(orderOrderItemProductBatche.deletedAt)));
  }

  async createOrderItemsProductBatches(orderOrderItem_id: string, details: any[]): Promise<void> {
    if (details.length === 0) return;
    const values = details.map((d) => ({
      orderOrderItem_id,
      batch_no: d.batch_no,
      warehouse: d.warehouse,
      batch_quantity: d.batch_quantity,
      production_date: d.production_date ? new Date(d.production_date) : null,
    }));
    await this.db.insert(orderOrderItemProductBatche).values(values);
  }

  async updateOrderItemsProductBatches(orderOrderItem_id: string, details: any[]): Promise<void> {
    const existing = await this.getOrderItemsProductBatches(orderOrderItem_id);
    const existingIds = new Set(existing.map((r) => r.id));
    const incomingIds = new Set(details.filter((d) => d.id).map((d) => d.id));

    const toDelete = existing.filter((r) => !incomingIds.has(r.id));
    if (toDelete.length > 0) {
      await this.db
        .update(orderOrderItemProductBatche)
        .set({ deletedAt: sql`NOW()` })
        .where(and(inArray(orderOrderItemProductBatche.id, toDelete.map((r) => r.id)), isNull(orderOrderItemProductBatche.deletedAt)));
    }

    for (const d of details.filter((d) => d.id && existingIds.has(d.id))) {
      await this.db
        .update(orderOrderItemProductBatche)
        .set({
          batch_no: d.batch_no,
          warehouse: d.warehouse,
          batch_quantity: d.batch_quantity,
          production_date: d.production_date ? new Date(d.production_date) : null,
          updatedAt: sql`NOW()`,
        })
        .where(eq(orderOrderItemProductBatche.id, d.id));
    }

    const newRows = details.filter((d) => !d.id);
    if (newRows.length > 0) {
      await this.createOrderItemsProductBatches(orderOrderItem_id, newRows);
    }
  }

  async removeOrderItemsProductBatches(orderOrderItem_id: string): Promise<void> {
    await this.db
      .update(orderOrderItemProductBatche)
      .set({ deletedAt: sql`NOW()` })
      .where(and(eq(orderOrderItemProductBatche.orderOrderItem_id, orderOrderItem_id), isNull(orderOrderItemProductBatche.deletedAt)));
  }

}
