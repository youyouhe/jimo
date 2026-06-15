import { sql } from 'drizzle-orm';
import {
  pgTable,
  uuid,
  varchar,
  smallint,
  timestamp,
  index,
} from 'drizzle-orm/pg-core';

export const sysDictionaryDetails = pgTable(
  'sys_dictionary_details',
  {
    id: uuid('id').defaultRandom().primaryKey(),
    dictId: uuid('dict_id').notNull(),
    label: varchar('label', { length: 128 }).notNull(),
    value: varchar('value', { length: 128 }).notNull(),
    status: smallint('status').notNull().default(1),
    sort: smallint('sort').notNull().default(0),
    parentId: uuid('parent_id'),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
    deletedAt: timestamp('deleted_at', { withTimezone: true }),
  },
  (t) => [
    index('idx_sys_dict_details_dict_id_active')
      .on(t.dictId)
      .where(sql`${t.deletedAt} IS NULL`),
    index('idx_sys_dict_details_parent_id').on(t.parentId),
    index('idx_sys_dict_details_sort_active')
      .on(t.sort)
      .where(sql`${t.deletedAt} IS NULL`),
  ],
);

export type SysDictionaryDetail = typeof sysDictionaryDetails.$inferSelect;
export type NewSysDictionaryDetail = typeof sysDictionaryDetails.$inferInsert;
