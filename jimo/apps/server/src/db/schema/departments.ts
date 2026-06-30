import { sql } from 'drizzle-orm';
import {
  pgTable,
  boolean,
  integer,
  jsonb,
  timestamp,
  uuid,
  varchar,
  uniqueIndex,
} from 'drizzle-orm/pg-core';


export const departments = pgTable(
  'lc_departments',
  {
    id: uuid('id').defaultRandom().primaryKey(),
    code: varchar('code', { length: 32 }).notNull(),
    name: varchar('name', { length: 100 }).notNull(),
    sort_order: integer('sort_order').default(0),
    is_enabled: boolean('is_enabled').default(false),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
    deletedAt: timestamp('deleted_at', { withTimezone: true }),
    createdBy: uuid('created_by'),
    updatedBy: uuid('updated_by'),
    ownerId: uuid('owner_id'),
    sharedWith: jsonb('shared_with'),
  },
  (t) => [
    uniqueIndex('idx_departments_code_active')
      .on(t.code)
      .where(sql`${t.deletedAt} IS NULL`),
  ],
);

export type Departments = typeof departments.$inferSelect;
export type NewDepartments = typeof departments.$inferInsert;
