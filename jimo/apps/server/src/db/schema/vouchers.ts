import { sql } from 'drizzle-orm';
import {
  pgTable,
  integer,
  jsonb,
  numeric,
  text,
  timestamp,
  uuid,
  varchar,
  uniqueIndex,
} from 'drizzle-orm/pg-core';


export const vouchers = pgTable(
  'lc_vouchers',
  {
    id: uuid('id').defaultRandom().primaryKey(),
    voucher_number: varchar('voucher_number', { length: 30 }).notNull(),
    voucher_date: timestamp('voucher_date', { withTimezone: true }).notNull(),
    summary: text('summary').notNull(),
    status: varchar('status', { length: 64 }).notNull(),
    attachment: varchar('attachment', { length: 512 }).default(''),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
    deletedAt: timestamp('deleted_at', { withTimezone: true }),
    createdBy: uuid('created_by'),
    updatedBy: uuid('updated_by'),
    ownerId: uuid('owner_id'),
    sharedWith: jsonb('shared_with'),
  },
  (t) => [
    uniqueIndex('idx_vouchers_voucher_number_active')
      .on(t.voucher_number)
      .where(sql`${t.deletedAt} IS NULL`),
  ],
);

export type Vouchers = typeof vouchers.$inferSelect;
export type NewVouchers = typeof vouchers.$inferInsert;


export const voucherItem = pgTable(
  'lc_voucher_item',
  {
    id: uuid('id').defaultRandom().primaryKey(),
    account_id: uuid('account_id').notNull(),
    debit_amount: numeric('debit_amount', { precision: 12, scale: 2 }).default('0'),
    credit_amount: numeric('credit_amount', { precision: 12, scale: 2 }).default('0'),
    summary: text('summary').default(''),
    sort_order: integer('sort_order').default(0),
    voucher_id: uuid('voucher_id').notNull().references(() => vouchers.id),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
    deletedAt: timestamp('deleted_at', { withTimezone: true }),
  },
);

export type VoucherItem = typeof voucherItem.$inferSelect;
export type NewVoucherItem = typeof voucherItem.$inferInsert;
