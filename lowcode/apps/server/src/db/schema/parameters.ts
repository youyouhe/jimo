import { sql } from 'drizzle-orm';
import {
  pgTable,
  uuid,
  varchar,
  text,
  timestamp,
  uniqueIndex,
} from 'drizzle-orm/pg-core';

export const sysParams = pgTable(
  'sys_params',
  {
    id: uuid('id').defaultRandom().primaryKey(),
    name: varchar('name', { length: 128 }).notNull(),
    key: varchar('key', { length: 128 }).notNull(),
    value: text('value').notNull(),
    desc: varchar('desc', { length: 256 }).default(''),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
    deletedAt: timestamp('deleted_at', { withTimezone: true }),
  },
  (t) => [
    uniqueIndex('idx_sys_params_key_active')
      .on(t.key)
      .where(sql`${t.deletedAt} IS NULL`),
  ],
);

export type SysParam = typeof sysParams.$inferSelect;
export type NewSysParam = typeof sysParams.$inferInsert;
