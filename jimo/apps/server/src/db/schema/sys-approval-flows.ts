import { sql } from 'drizzle-orm';
import {
  pgTable,
  uuid,
  varchar,
  jsonb,
  boolean,
  timestamp,
  uniqueIndex,
} from 'drizzle-orm/pg-core';

/**
 * Per-business-type approval flow config (runtime, editable — NOT codegen-baked).
 *
 * config shape:
 * {
 *   rules: [ { when: { <field>: { <op>: <value> } | <value> }, chain: [ruleName, ...] } ],
 *   defaultChain: [ruleName, ...]
 * }
 *
 * At submit, ApprovalService loads the business record, evaluates `rules` in
 * order, and uses the first matching rule's chain (falling back to
 * defaultChain). Each chain entry is a resolution-rule name resolved by BPM's
 * AssigneeResolver at runtime (deptHead / deptFinance / ceo / ...).
 */
export const sysApprovalFlows = pgTable(
  'sys_approval_flows',
  {
    id: uuid('id').defaultRandom().primaryKey(),
    businessType: varchar('business_type', { length: 50 }).notNull(),
    name: varchar('name', { length: 100 }).default(''),
    config: jsonb('config').notNull(),
    enabled: boolean('enabled').default(true),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
    deletedAt: timestamp('deleted_at', { withTimezone: true }),
  },
  (t) => [
    uniqueIndex('idx_sys_approval_flows_type_active')
      .on(t.businessType)
      .where(sql`${t.deletedAt} IS NULL`),
  ],
);

export type SysApprovalFlow = typeof sysApprovalFlows.$inferSelect;
export type NewSysApprovalFlow = typeof sysApprovalFlows.$inferInsert;
