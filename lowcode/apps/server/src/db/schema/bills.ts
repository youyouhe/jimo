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

import { projects } from './projects';


export const bills = pgTable(
  'lc_bills',
  {
    id: uuid('id').defaultRandom().primaryKey(),
    bill_no: varchar('bill_no', { length: 50 }).notNull(),
    bill_name: varchar('bill_name', { length: 200 }).notNull(),
    bill_date: timestamp('bill_date', { withTimezone: true }).notNull(),
    amount: numeric('amount', { precision: 12, scale: 2 }).notNull(),
    status: varchar('status', { length: 64 }).notNull(),
    project_id: uuid('project_id').notNull().references(() => projects.id),
    remark: text('remark').default(''),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
    deletedAt: timestamp('deleted_at', { withTimezone: true }),
    createdBy: uuid('created_by'),
    updatedBy: uuid('updated_by'),
  },
  (t) => [
    uniqueIndex('idx_bills_bill_no_active')
      .on(t.bill_no)
      .where(sql`${t.deletedAt} IS NULL`),
  ],
);

export type Bills = typeof bills.$inferSelect;
export type NewBills = typeof bills.$inferInsert;


export const billBillItem = pgTable(
  'lc_bill_bill_item',
  {
    id: uuid('id').defaultRandom().primaryKey(),
    item_name: varchar('item_name', { length: 200 }).notNull(),
    quantity: integer('quantity').notNull(),
    unit_price: numeric('unit_price', { precision: 12, scale: 2 }).notNull(),
    amount: numeric('amount', { precision: 12, scale: 2 }).notNull(),
    description: text('description').default(''),
    bill_id: uuid('bill_id').notNull().references(() => bills.id),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
    deletedAt: timestamp('deleted_at', { withTimezone: true }),
  },
);

export type BillBillItem = typeof billBillItem.$inferSelect;
export type NewBillBillItem = typeof billBillItem.$inferInsert;
