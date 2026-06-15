import {
  Injectable,
  Inject,
  NotFoundException,
  ConflictException,
} from '@nestjs/common';
import { eq, and, isNull, like, sql, count, inArray, gte, lte, desc } from 'drizzle-orm';
import { DATABASE_CONNECTION, DrizzleDb } from '../../db/connection';
import { order, Order } from '../../db/schema/order';
import { orderDetail } from '../../db/schema/order';
import { orderPerformance } from '../../db/schema/order';
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

  async findAll(query: QueryOrderDto): Promise<PaginatedData<Order>> {
    const { page, pageSize, name, priceMin, priceMax } = query;
    const offset = (page - 1) * pageSize;

    const conditions: SQL[] = [isNull(order.deletedAt)];

    if (name) {
      conditions.push(like(order.name, `%${name}%`));
    }
    if (priceMin) {
      conditions.push(gte(order.price, priceMin));
    }
    if (priceMax) {
      conditions.push(lte(order.price, priceMax));
    }

    const whereClause = and(...conditions);

    const [rows, totalRows] = await Promise.all([
      this.db
        .select()
        .from(order)
        .where(whereClause)
        .orderBy(desc(order.createdAt))
        .limit(pageSize)
        .offset(offset),
      this.db
        .select({ count: count() })
        .from(order)
        .where(whereClause),
    ]);

    const total = totalRows[0]?.count ?? 0;

    // Batch-attach child detail rows
    if (rows.length > 0) {
      const masterIds = rows.map((r) => r.id);
      const detailsRows = await this.db
        .select()
        .from(orderDetail)
        .where(and(inArray(orderDetail.order_id, masterIds), isNull(orderDetail.deletedAt)));
      const detailsByMaster = new Map<string, any[]>();
      for (const row of detailsRows) {
        const arr = detailsByMaster.get(row.order_id) || [];
        arr.push(row);
        detailsByMaster.set(row.order_id, arr);
      }
      for (const row of rows) {
        (row as any).details = detailsByMaster.get(row.id) || [];
      }
      const performanceRows = await this.db
        .select()
        .from(orderPerformance)
        .where(and(inArray(orderPerformance.order_id, masterIds), isNull(orderPerformance.deletedAt)));
      const performanceByMaster = new Map<string, any[]>();
      for (const row of performanceRows) {
        const arr = performanceByMaster.get(row.order_id) || [];
        arr.push(row);
        performanceByMaster.set(row.order_id, arr);
      }
      for (const row of rows) {
        (row as any).performance = performanceByMaster.get(row.id) || [];
      }
    }

    return { list: rows, total, page, pageSize };
  }

  async findOne(id: string): Promise<Order> {
    const rows = await this.db
      .select()
      .from(order)
      .where(and(eq(order.id, id), isNull(order.deletedAt)))
      .limit(1);

    if (rows.length === 0) {
      throw new NotFoundException({
        code: ApiErrorCode.RESOURCE_NOT_FOUND,
        message: `Order with id ${id} not found`,
      });
    }
    (rows[0] as any).details = await this.getDetails(id);
    (rows[0] as any).performance = await this.getPerformance(id);
    return rows[0]!;
  }

  async create(dto: CreateOrderDto): Promise<Order> {

    return this.db.transaction(async (tx) => {
      const rows = await tx
        .insert(order)
        .values({
          name: dto.name,
          price: String(dto.price),
        })
        .returning();
      const created = rows[0]!;
      if (dto.details && (dto.details as any[]).length > 0) {
        await tx.insert(orderDetail).values(
          (dto.details as any[]).map((d: any) => ({
            order_id: created.id,
            name: d.name,
            number: d.number,
            price: d.price,
          })),
        );
      }
      if (dto.performance && (dto.performance as any[]).length > 0) {
        await tx.insert(orderPerformance).values(
          (dto.performance as any[]).map((d: any) => ({
            order_id: created.id,
            name: d.name,
            time: d.time ? new Date(d.time) : null,
            amount: d.amount,
            memo: d.memo,
          })),
        );
      }

      return created;
    });
  }

  async update(id: string, dto: UpdateOrderDto): Promise<Order> {
    const existing = await this.findOne(id);


    type OrderUpdateFields = {
      name?: string;
      price?: string;
      updatedAt?: Date;
    };

    const updateData: OrderUpdateFields = {
      updatedAt: new Date(),
    };

    if (dto.name !== undefined) updateData.name = dto.name;
    if (dto.price !== undefined) updateData.price = String(dto.price);

    const rows = await this.db
      .update(order)
      .set(updateData)
      .where(and(eq(order.id, id), isNull(order.deletedAt)))
      .returning();

    if (dto.details !== undefined) {
      await this.updateDetails(id, dto.details as any[]);
    }
    if (dto.performance !== undefined) {
      await this.updatePerformance(id, dto.performance as any[]);
    }
    return rows[0]!;
  }

  async remove(id: string): Promise<void> {
    await this.findOne(id);

    await this.removeDetails(id);
    await this.removePerformance(id);

    await this.db
      .update(order)
      .set({ deletedAt: sql`NOW()` })
      .where(and(eq(order.id, id), isNull(order.deletedAt)));
  }

  async batchRemove(ids: string[]): Promise<{ count: number }> {
    // Remove child detail rows for each id
    for (const id of ids) {
      try {
        await this.removeDetails(id);
        await this.removePerformance(id);
      } catch {
        // Record may not exist, ignore
      }
    }

    const rows = await this.db
      .update(order)
      .set({ deletedAt: sql`NOW()` })
      .where(and(inArray(order.id, ids), isNull(order.deletedAt)))
      .returning({ id: order.id });

    return { count: rows.length };
  }

  async getDetails(order_id: string): Promise<any[]> {
    return this.db
      .select()
      .from(orderDetail)
      .where(and(eq(orderDetail.order_id, order_id), isNull(orderDetail.deletedAt)));
  }

  async createDetails(order_id: string, details: any[]): Promise<void> {
    if (details.length === 0) return;
    const values = details.map((d) => ({
      order_id,
      name: d.name,
      number: d.number,
      price: d.price,
    }));
    await this.db.insert(orderDetail).values(values);
  }

  async updateDetails(order_id: string, details: any[]): Promise<void> {
    const existing = await this.getDetails(order_id);
    const existingIds = new Set(existing.map((r) => r.id));
    const incomingIds = new Set(details.filter((d) => d.id).map((d) => d.id));

    // Soft-delete rows no longer present
    const toDelete = existing.filter((r) => !incomingIds.has(r.id));
    if (toDelete.length > 0) {
      await this.db
        .update(orderDetail)
        .set({ deletedAt: sql`NOW()` })
        .where(and(inArray(orderDetail.id, toDelete.map((r) => r.id)), isNull(orderDetail.deletedAt)));
    }

    // Update existing rows
    for (const d of details.filter((d) => d.id && existingIds.has(d.id))) {
      await this.db
        .update(orderDetail)
        .set({
          name: d.name,
          number: d.number,
          price: d.price,
          updatedAt: sql`NOW()`,
        })
        .where(eq(orderDetail.id, d.id));
    }

    // Insert new rows (no id or temp id)
    const newRows = details.filter((d) => !d.id);
    if (newRows.length > 0) {
      await this.createDetails(order_id, newRows);
    }
  }

  async removeDetails(order_id: string): Promise<void> {
    await this.db
      .update(orderDetail)
      .set({ deletedAt: sql`NOW()` })
      .where(and(eq(orderDetail.order_id, order_id), isNull(orderDetail.deletedAt)));
  }

  async getPerformance(order_id: string): Promise<any[]> {
    return this.db
      .select()
      .from(orderPerformance)
      .where(and(eq(orderPerformance.order_id, order_id), isNull(orderPerformance.deletedAt)));
  }

  async createPerformance(order_id: string, details: any[]): Promise<void> {
    if (details.length === 0) return;
    const values = details.map((d) => ({
      order_id,
      name: d.name,
      time: d.time ? new Date(d.time) : null,
      amount: d.amount,
      memo: d.memo,
    }));
    await this.db.insert(orderPerformance).values(values);
  }

  async updatePerformance(order_id: string, details: any[]): Promise<void> {
    const existing = await this.getPerformance(order_id);
    const existingIds = new Set(existing.map((r) => r.id));
    const incomingIds = new Set(details.filter((d) => d.id).map((d) => d.id));

    // Soft-delete rows no longer present
    const toDelete = existing.filter((r) => !incomingIds.has(r.id));
    if (toDelete.length > 0) {
      await this.db
        .update(orderPerformance)
        .set({ deletedAt: sql`NOW()` })
        .where(and(inArray(orderPerformance.id, toDelete.map((r) => r.id)), isNull(orderPerformance.deletedAt)));
    }

    // Update existing rows
    for (const d of details.filter((d) => d.id && existingIds.has(d.id))) {
      await this.db
        .update(orderPerformance)
        .set({
          name: d.name,
          time: d.time ? new Date(d.time) : null,
          amount: d.amount,
          memo: d.memo,
          updatedAt: sql`NOW()`,
        })
        .where(eq(orderPerformance.id, d.id));
    }

    // Insert new rows (no id or temp id)
    const newRows = details.filter((d) => !d.id);
    if (newRows.length > 0) {
      await this.createPerformance(order_id, newRows);
    }
  }

  async removePerformance(order_id: string): Promise<void> {
    await this.db
      .update(orderPerformance)
      .set({ deletedAt: sql`NOW()` })
      .where(and(eq(orderPerformance.order_id, order_id), isNull(orderPerformance.deletedAt)));
  }

}
