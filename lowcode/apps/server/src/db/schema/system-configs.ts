import { pgTable, uuid, varchar, text, timestamp, uniqueIndex } from 'drizzle-orm/pg-core';
import { sql } from 'drizzle-orm';

export const sysSystemConfigs = pgTable(
  'sys_system_configs',
  {
    id: uuid('id').defaultRandom().primaryKey(),
    key: varchar('key', { length: 128 }).notNull(),
    value: text('value').notNull(),
    desc: varchar('desc', { length: 256 }).default(''),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
    deletedAt: timestamp('deleted_at', { withTimezone: true }),
  },
  (t) => [
    uniqueIndex('idx_sys_system_configs_key_active')
      .on(t.key)
      .where(sql`${t.deletedAt} IS NULL`),
  ],
);

export type SysSystemConfig = typeof sysSystemConfigs.$inferSelect;
export type NewSysSystemConfig = typeof sysSystemConfigs.$inferInsert;
