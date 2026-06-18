import { sql } from 'drizzle-orm';
import {
  pgTable,
  uuid,
  varchar,
  text,
  jsonb,
  timestamp,
  uniqueIndex,
} from 'drizzle-orm/pg-core';

export const sysVersions = pgTable(
  'sys_versions',
  {
    id: uuid('id').defaultRandom().primaryKey(),
    versionName: varchar('version_name', { length: 128 }).notNull(),
    versionNumber: varchar('version_number', { length: 32 }).notNull(),
    description: text('description'),
    data: jsonb('data'),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
    deletedAt: timestamp('deleted_at', { withTimezone: true }),
  },
  (t) => [
    uniqueIndex('idx_sys_versions_number_active')
      .on(t.versionNumber)
      .where(sql`${t.deletedAt} IS NULL`),
  ],
);

export type SysVersion = typeof sysVersions.$inferSelect;
export type NewSysVersion = typeof sysVersions.$inferInsert;
