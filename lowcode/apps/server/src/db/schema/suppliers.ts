import { sql } from 'drizzle-orm';
import {
  pgTable,
  boolean,
  text,
  timestamp,
  uuid,
  varchar,
  uniqueIndex,
} from 'drizzle-orm/pg-core';


export const suppliers = pgTable(
  'lc_suppliers',
  {
    id: uuid('id').defaultRandom().primaryKey(),
    name: varchar('name', { length: 100 }).notNull(),
    contact_person: varchar('contact_person', { length: 50 }).default(''),
    phone: varchar('phone', { length: 20 }).default(''),
    email: varchar('email', { length: 100 }).default(''),
    address: text('address').default(''),
    is_active: boolean('is_active').notNull(),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
    deletedAt: timestamp('deleted_at', { withTimezone: true }),
    createdBy: uuid('created_by'),
    updatedBy: uuid('updated_by'),
  },
  (t) => [
    uniqueIndex('idx_suppliers_name_active')
      .on(t.name)
      .where(sql`${t.deletedAt} IS NULL`),
  ],
);

export type Suppliers = typeof suppliers.$inferSelect;
export type NewSuppliers = typeof suppliers.$inferInsert;
