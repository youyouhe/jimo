import { sql } from 'drizzle-orm';
import {
  pgTable,
  text,
  timestamp,
  uuid,
  varchar,
  jsonb,
  uniqueIndex,
  index,
} from 'drizzle-orm/pg-core';

/**
 * Unified approval tracking table.
 *
 * One active row per business record (businessType + businessId). The `executor`
 * column records which engine owns the flow:
 *   - 'bpm'    → contract flow in the external BPM service (status synced via webhook)
 *   - 'nestjs' → built-in state machine for low-code generated tables
 *
 * The business payload itself never lives here — only approval metadata. The
 * raw callback payload is kept in `payload` for audit.
 */
export const businessApprovals = pgTable(
  'business_approvals',
  {
    id: uuid('id').defaultRandom().primaryKey(),
    businessType: varchar('business_type', { length: 50 }).notNull(),
    businessId: varchar('business_id', { length: 64 }).notNull(),
    executor: varchar('executor', { length: 20 }).notNull(),
    status: varchar('status', { length: 20 }).notNull(),
    processInstanceId: varchar('process_instance_id', { length: 64 }),
    initiatorId: varchar('initiator_id', { length: 64 }),
    approverId: varchar('approver_id', { length: 64 }),
    comment: text('comment'),
    payload: jsonb('payload'),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
    deletedAt: timestamp('deleted_at', { withTimezone: true }),
  },
  (t) => [
    // One active approval record per business row.
    uniqueIndex('idx_business_approvals_biz_active')
      .on(t.businessType, t.businessId)
      .where(sql`${t.deletedAt} IS NULL`),
    index('idx_business_approvals_proc').on(t.processInstanceId),
    index('idx_business_approvals_status').on(t.status),
  ],
);

export type BusinessApproval = typeof businessApprovals.$inferSelect;
export type NewBusinessApproval = typeof businessApprovals.$inferInsert;
