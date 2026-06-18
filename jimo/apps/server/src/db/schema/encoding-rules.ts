import { sql } from 'drizzle-orm';
import {
  pgTable,
  uuid,
  varchar,
  integer,
  timestamp,
  uniqueIndex,
} from 'drizzle-orm/pg-core';

export const sysEncodingRules = pgTable(
  'sys_encoding_rules',
  {
    id: uuid('id').defaultRandom().primaryKey(),
    name: varchar('name', { length: 100 }).notNull(),
    prefix: varchar('prefix', { length: 20 }),
    dateFormat: varchar('date_format', { length: 20 }),
    separator: varchar('separator', { length: 4 }).default('').notNull(),
    sequenceDigits: integer('sequence_digits').notNull().default(4),
    paddingChar: varchar('padding_char', { length: 1 }).notNull().default('0'),
    resetCycle: varchar('reset_cycle', { length: 10 }).notNull(),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
    deletedAt: timestamp('deleted_at', { withTimezone: true }),
  },
  (t) => [
    uniqueIndex('idx_sys_encoding_rules_name_active')
      .on(t.name)
      .where(sql`${t.deletedAt} IS NULL`),
  ],
);

export type SysEncodingRule = typeof sysEncodingRules.$inferSelect;
export type NewSysEncodingRule = typeof sysEncodingRules.$inferInsert;
