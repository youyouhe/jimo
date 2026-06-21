import { sql } from 'drizzle-orm';
import {
  pgTable,
  text,
  timestamp,
  uuid,
  varchar,
  uniqueIndex,
} from 'drizzle-orm/pg-core';

/**
 * System department table (persistent — NOT an autocode-generated `lc_*` table,
 * so it survives the cleanup job).
 *
 * `leadId` points at the department head (sys_users.id) — used by approval
 * approver resolution (e.g. SELF_DEPT_LEAD). Kept as a plain uuid column
 * (no inline FK) to avoid a circular import with users.ts; the FK is the same
 * soft convention used for createdBy/updatedBy elsewhere.
 */
export const sysDepartments = pgTable(
  'sys_departments',
  {
    id: uuid('id').defaultRandom().primaryKey(),
    name: varchar('name', { length: 100 }).notNull(),
    code: varchar('code', { length: 50 }).notNull(),
    description: text('description').default(''),
    parentId: uuid('parent_id'),
    leadId: uuid('lead_id'),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
    deletedAt: timestamp('deleted_at', { withTimezone: true }),
    createdBy: uuid('created_by'),
    updatedBy: uuid('updated_by'),
  },
  (t) => [
    uniqueIndex('idx_sys_departments_code_active')
      .on(t.code)
      .where(sql`${t.deletedAt} IS NULL`),
  ],
);

export type SysDepartment = typeof sysDepartments.$inferSelect;
export type NewSysDepartment = typeof sysDepartments.$inferInsert;
