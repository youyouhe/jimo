import { sql } from 'drizzle-orm';
import {
  pgTable,
  integer,
  numeric,
  text,
  timestamp,
  uuid,
  varchar,
  uniqueIndex,
} from 'drizzle-orm/pg-core';

import { suppliers } from './suppliers';


export const purchaseOrders = pgTable(
  'lc_purchase_orders',
  {
    id: uuid('id').defaultRandom().primaryKey(),
    order_no: varchar('order_no', { length: 50 }).notNull(),
    supplier_id: uuid('supplier_id').notNull().references(() => suppliers.id),
    order_date: timestamp('order_date', { withTimezone: true }).notNull(),
    status: varchar('status', { length: 64 }).notNull(),
    total_amount: numeric('total_amount', { precision: 12, scale: 2 }).default('0'),
    remark: text('remark').default(''),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
    deletedAt: timestamp('deleted_at', { withTimezone: true }),
    createdBy: uuid('created_by'),
    updatedBy: uuid('updated_by'),
  },
  (t) => [
    uniqueIndex('idx_purchase_orders_order_no_active')
      .on(t.order_no)
      .where(sql`${t.deletedAt} IS NULL`),
  ],
);

export type PurchaseOrders = typeof purchaseOrders.$inferSelect;
export type NewPurchaseOrders = typeof purchaseOrders.$inferInsert;


export const purchaseOrderItem = pgTable(
  'lc_purchase_order_item',
  {
    id: uuid('id').defaultRandom().primaryKey(),
    material_name: varchar('material_name', { length: 100 }).notNull(),
    specification: varchar('specification', { length: 100 }).default(''),
    quantity: integer('quantity').notNull(),
    unit_price: numeric('unit_price', { precision: 12, scale: 2 }).notNull(),
    amount: numeric('amount', { precision: 12, scale: 2 }).default('0'),
    purchaseOrder_id: uuid('purchaseOrder_id').notNull().references(() => purchaseOrders.id),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
    deletedAt: timestamp('deleted_at', { withTimezone: true }),
  },
);

export type PurchaseOrderItem = typeof purchaseOrderItem.$inferSelect;
export type NewPurchaseOrderItem = typeof purchaseOrderItem.$inferInsert;
