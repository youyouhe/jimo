import { sql } from 'drizzle-orm';
import {
  pgTable,
  uuid,
  varchar,
  bigint,
  timestamp,
  index,
  uniqueIndex,
} from 'drizzle-orm/pg-core';

export const sysFiles = pgTable(
  'sys_files',
  {
    id: uuid('id').defaultRandom().primaryKey(),
    name: varchar('name', { length: 255 }).notNull(),
    url: varchar('url', { length: 512 }).notNull(),
    key: varchar('key', { length: 512 }).notNull(),
    tag: varchar('tag', { length: 64 }).notNull().default(''),
    ext: varchar('ext', { length: 16 }).notNull().default(''),
    size: bigint('size', { mode: 'number' }).notNull().default(0),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
    deletedAt: timestamp('deleted_at', { withTimezone: true }),
  },
  (t) => [
    uniqueIndex('idx_sys_files_key_active')
      .on(t.key)
      .where(sql`${t.deletedAt} IS NULL`),
    index('idx_sys_files_tag_active')
      .on(t.tag)
      .where(sql`${t.deletedAt} IS NULL`),
  ],
);

export type SysFile = typeof sysFiles.$inferSelect;
export type NewSysFile = typeof sysFiles.$inferInsert;
