import {
  pgTable,
  uuid,
  varchar,
  integer,
  unique,
} from 'drizzle-orm/pg-core';
import { sysEncodingRules } from './encoding-rules.js';

export const sysEncodingRuleSequences = pgTable(
  'sys_encoding_rule_sequences',
  {
    id: uuid('id').defaultRandom().primaryKey(),
    ruleId: uuid('rule_id').notNull().references(() => sysEncodingRules.id),
    periodKey: varchar('period_key', { length: 20 }).notNull(),
    lastSeq: integer('last_seq').notNull().default(0),
  },
  (t) => [
    unique('uq_sys_encoding_rule_sequences_rule_period').on(t.ruleId, t.periodKey),
  ],
);

export type SysEncodingRuleSequence = typeof sysEncodingRuleSequences.$inferSelect;
export type NewSysEncodingRuleSequence = typeof sysEncodingRuleSequences.$inferInsert;
