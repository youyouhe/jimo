import { sql } from 'drizzle-orm';
import {
  pgTable,
  uuid,
  varchar,
  smallint,
  timestamp,
  index,
  uniqueIndex,
} from 'drizzle-orm/pg-core';

export const sysRoles = pgTable(
  'sys_roles',
  {
    id: uuid('id').defaultRandom().primaryKey(),
    name: varchar('name', { length: 64 }).notNull(),
    code: varchar('code', { length: 64 }).notNull(),
    description: varchar('description', { length: 255 }),
    isDefault: smallint('is_default').notNull().default(0),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
    deletedAt: timestamp('deleted_at', { withTimezone: true }),
  },
  (t) => [
    uniqueIndex('idx_sys_roles_code_active')
      .on(t.code)
      .where(sql`${t.deletedAt} IS NULL`),
  ],
);

export type SysRole = typeof sysRoles.$inferSelect;
export type NewSysRole = typeof sysRoles.$inferInsert;
