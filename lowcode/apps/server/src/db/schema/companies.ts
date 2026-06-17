import { sql } from 'drizzle-orm';
import {
  pgTable,
  text,
  timestamp,
  uuid,
  varchar,
  uniqueIndex,
} from 'drizzle-orm/pg-core';


export const companies = pgTable(
  'lc_companies',
  {
    id: uuid('id').defaultRandom().primaryKey(),
    name: varchar('name', { length: 200 }).notNull(),
    short_name: varchar('short_name', { length: 100 }).default(''),
    logo: varchar('logo', { length: 512 }).default(''),
    credit_code: varchar('credit_code', { length: 50 }).default(''),
    address: varchar('address', { length: 300 }).default(''),
    phone: varchar('phone', { length: 30 }).default(''),
    email: varchar('email', { length: 100 }).default(''),
    website: varchar('website', { length: 200 }).default(''),
    description: text('description').default(''),
    established_date: timestamp('established_date', { withTimezone: true }),
    status: varchar('status', { length: 64 }).default(''),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
    deletedAt: timestamp('deleted_at', { withTimezone: true }),
    createdBy: uuid('created_by'),
    updatedBy: uuid('updated_by'),
  },
  (t) => [
    uniqueIndex('idx_companies_name_active')
      .on(t.name)
      .where(sql`${t.deletedAt} IS NULL`),
    uniqueIndex('idx_companies_credit_code_active')
      .on(t.credit_code)
      .where(sql`${t.deletedAt} IS NULL`),
  ],
);

export type Companies = typeof companies.$inferSelect;
export type NewCompanies = typeof companies.$inferInsert;
