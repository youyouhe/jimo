import {
  pgTable,
  numeric,
  timestamp,
  uuid,
  varchar,
} from 'drizzle-orm/pg-core';


export const contract = pgTable(
  'lc_contract',
  {
    id: uuid('id').defaultRandom().primaryKey(),
    name: varchar('name', { length: 255 }).default(''),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
    deletedAt: timestamp('deleted_at', { withTimezone: true }),
    createdBy: uuid('created_by'),
    updatedBy: uuid('updated_by'),
  },
);

export type Contract = typeof contract.$inferSelect;
export type NewContract = typeof contract.$inferInsert;


export const contractDetail = pgTable(
  'lc_contract_detail',
  {
    id: uuid('id').defaultRandom().primaryKey(),
    name: varchar('name', { length: 255 }).default(''),
    price: numeric('price', { precision: 12, scale: 2 }).default('0'),
    memo: varchar('memo', { length: 255 }).default(''),
    contract_id: uuid('contract_id').notNull().references(() => contract.id),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
    deletedAt: timestamp('deleted_at', { withTimezone: true }),
  },
);

export type ContractDetail = typeof contractDetail.$inferSelect;
export type NewContractDetail = typeof contractDetail.$inferInsert;
