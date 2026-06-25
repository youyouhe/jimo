import { sql } from 'drizzle-orm';
import {
  pgTable,
  boolean,
  jsonb,
  text,
  timestamp,
  uuid,
  varchar,
  uniqueIndex,
} from 'drizzle-orm/pg-core';


export const accounts = pgTable(
  'lc_accounts',
  {
    id: uuid('id').defaultRandom().primaryKey(),
    code: varchar('code', { length: 20 }).notNull(),
    name: varchar('name', { length: 100 }).notNull(),
    account_type: varchar('account_type', { length: 64 }).notNull(),
    balance_direction: varchar('balance_direction', { length: 64 }).notNull(),
    parent_id: uuid('parent_id'),
    description: text('description').default(''),
    is_enabled: boolean('is_enabled').notNull(),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
    deletedAt: timestamp('deleted_at', { withTimezone: true }),
    createdBy: uuid('created_by'),
    updatedBy: uuid('updated_by'),
    ownerId: uuid('owner_id'),
    sharedWith: jsonb('shared_with'),
  },
  (t) => [
    uniqueIndex('idx_accounts_code_active')
      .on(t.code)
      .where(sql`${t.deletedAt} IS NULL`),
    uniqueIndex('idx_accounts_name_active')
      .on(t.name)
      .where(sql`${t.deletedAt} IS NULL`),
  ],
);

export type Accounts = typeof accounts.$inferSelect;
export type NewAccounts = typeof accounts.$inferInsert;
