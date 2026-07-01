import { sql } from 'drizzle-orm';
import {
  pgTable,
  uuid,
  varchar,
  smallint,
  timestamp,
  uniqueIndex,
} from 'drizzle-orm/pg-core';
import { sysDepartments } from './sys-departments.js';

/**
 * System employee table (persistent — NOT an autocode-generated `lc_*` table).
 *
 * Separates the "person" concept (sys_employees) from the "login account"
 * concept (sys_users). An employee can have 0, 1, or multiple user accounts
 * (for different roles/permissions), managed via sys_users.employee_id.
 *
 * department_id is an optional FK to sys_departments; NULL means unassigned.
 */
export const sysEmployees = pgTable(
  'sys_employees',
  {
    id: uuid('id').defaultRandom().primaryKey(),
    employeeNo: varchar('employee_no', { length: 32 }).notNull(),
    name: varchar('name', { length: 100 }).notNull(),
    departmentId: uuid('department_id').references(() => sysDepartments.id, { onDelete: 'set null' }),
    position: varchar('position', { length: 100 }),
    phone: varchar('phone', { length: 30 }),
    email: varchar('email', { length: 100 }),
    status: smallint('status').notNull().default(1), // 1=在职 2=离职 3=休假
    entryDate: timestamp('entry_date', { withTimezone: true }),
    leaveDate: timestamp('leave_date', { withTimezone: true }),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
    deletedAt: timestamp('deleted_at', { withTimezone: true }),
  },
  (t) => [
    uniqueIndex('idx_sys_employees_no_active')
      .on(t.employeeNo)
      .where(sql`${t.deletedAt} IS NULL`),
  ],
);

export type SysEmployee = typeof sysEmployees.$inferSelect;
export type NewSysEmployee = typeof sysEmployees.$inferInsert;
