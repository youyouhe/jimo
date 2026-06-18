import { sql } from 'drizzle-orm';
import {
  pgTable,
  uuid,
  varchar,
  text,
  timestamp,
  uniqueIndex,
} from 'drizzle-orm/pg-core';

export const sysApis = pgTable(
  'sys_apis',
  {
    id: uuid('id').defaultRandom().primaryKey(),
    method: varchar('method', { length: 10 }).notNull().default('GET'),
    path: varchar('path', { length: 512 }).notNull(),
    permission: varchar('permission', { length: 128 }),
    description: varchar('description', { length: 256 }).default(''),
    apiGroup: varchar('api_group', { length: 128 }).default('default'),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
    deletedAt: timestamp('deleted_at', { withTimezone: true }),
  },
  (t) => [
    uniqueIndex('idx_sys_apis_method_path_active')
      .on(t.method, t.path)
      .where(sql`${t.deletedAt} IS NULL`),
  ],
);

export type SysApi = typeof sysApis.$inferSelect;
export type NewSysApi = typeof sysApis.$inferInsert;
