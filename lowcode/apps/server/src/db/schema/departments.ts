import { sql } from 'drizzle-orm';
import {
  pgTable,
  text,
  timestamp,
  uuid,
  varchar,
  uniqueIndex,
} from 'drizzle-orm/pg-core';


export const departments = pgTable(
  'lc_departments',
  {
    id: uuid('id').defaultRandom().primaryKey(),
    name: varchar('name', { length: 100 }).notNull(),
    manager_name: varchar('manager_name', { length: 50 }).default(''),
    phone: varchar('phone', { length: 20 }).default(''),
    description: text('description').default(''),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
    deletedAt: timestamp('deleted_at', { withTimezone: true }),
    createdBy: uuid('created_by'),
    updatedBy: uuid('updated_by'),
  },
  (t) => [
    uniqueIndex('idx_departments_name_active')
      .on(t.name)
      .where(sql`${t.deletedAt} IS NULL`),
  ],
);

export type Departments = typeof departments.$inferSelect;
export type NewDepartments = typeof departments.$inferInsert;
