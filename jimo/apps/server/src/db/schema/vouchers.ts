import { sql } from 'drizzle-orm';
import {
  pgTable,
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
    voucher_no: varchar('voucher_no', { length: 50 }).notNull(),
    voucher_date: timestamp('voucher_date', { withTimezone: true }).notNull(),
    summary: text('summary').notNull(),
    prepared_by: varchar('prepared_by', { length: 50 }).notNull(),
    reviewed_by: varchar('reviewed_by', { length: 50 }).default(''),
    reviewed_at: timestamp('reviewed_at', { withTimezone: true }),
    status: varchar('status', { length: 64 }).notNull(),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
    deletedAt: timestamp('deleted_at', { withTimezone: true }),
    createdBy: uuid('created_by'),
    updatedBy: uuid('updated_by'),
    ownerId: uuid('owner_id'),
    sharedWith: jsonb('shared_with'),
  },
  (t) => [
    uniqueIndex('idx_vouchers_voucher_no_active')
      .on(t.voucher_no)
      .where(sql`${t.deletedAt} IS NULL`),
  ],
);

export type Vouchers = typeof vouchers.$inferSelect;
export type NewVouchers = typeof vouchers.$inferInsert;


export const voucherVoucherItem = pgTable(
  'lc_voucher_voucher_item',
  {
    id: uuid('id').defaultRandom().primaryKey(),
    account: uuid('account').notNull(),
    summary: varchar('summary', { length: 200 }).default(''),
    debit_amount: numeric('debit_amount', { precision: 12, scale: 2 }).default('0'),
    credit_amount: numeric('credit_amount', { precision: 12, scale: 2 }).default('0'),
    voucher_id: uuid('voucher_id').notNull().references(() => vouchers.id),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
    deletedAt: timestamp('deleted_at', { withTimezone: true }),
  },
);

export type VoucherVoucherItem = typeof voucherVoucherItem.$inferSelect;
export type NewVoucherVoucherItem = typeof voucherVoucherItem.$inferInsert;
