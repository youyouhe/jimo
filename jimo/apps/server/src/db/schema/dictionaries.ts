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

export const sysDictionaries = pgTable(
  'sys_dictionaries',
  {
    id: uuid('id').defaultRandom().primaryKey(),
    name: varchar('name', { length: 128 }).notNull(),
    type: varchar('type', { length: 128 }).notNull(),
    status: smallint('status').notNull().default(1),
    desc: varchar('desc', { length: 256 }),
    parentId: uuid('parent_id'),
    sort: smallint('sort').notNull().default(0),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
    deletedAt: timestamp('deleted_at', { withTimezone: true }),
  },
  (t) => [
    uniqueIndex('idx_sys_dicts_type_active')
      .on(t.type)
      .where(sql`${t.deletedAt} IS NULL`),
    index('idx_sys_dicts_parent_id').on(t.parentId),
    index('idx_sys_dicts_sort_active')
      .on(t.sort)
      .where(sql`${t.deletedAt} IS NULL`),
  ],
);

export type SysDictionary = typeof sysDictionaries.$inferSelect;
export type NewSysDictionary = typeof sysDictionaries.$inferInsert;
