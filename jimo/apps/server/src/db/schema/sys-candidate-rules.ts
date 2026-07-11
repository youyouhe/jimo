import {
  pgTable,
  uuid,
  varchar,
  jsonb,
  boolean,
  timestamp,
} from 'drizzle-orm/pg-core';

/**
 * A Resolution Rule (see CONTEXT.md) for the new Server-side candidate
 * resolution path — referenced from an approval chain as `srv:<id>`.
 *
 * Distinct from BPM's `resolution_rules` table (legacy, single-approver
 * strategies still resolved in BPM). This table's rules resolve entirely on
 * the Server side against sys_users/sys_user_roles/sys_roles/sys_employees,
 * and yield a Candidate List for a human to pick from — never written to
 * Flowable as candidateUsers/candidateGroups. See ADR-0001..0003.
 *
 * `filter` shape:
 * {
 *   roleIds?: string[],       // sys_roles.id — match ANY (union)
 *   positions?: string[],     // sys_employees.position — match ANY (union)
 *   orgScope?:
 *     | { type: 'fixed', deptId: string, includeSubtree?: boolean }
 *     | { type: 'self' | 'parent' | 'company' }
 * }
 * All present dimensions are combined with AND (intersection). orgScope
 * relative anchors are resolved against the flow's ORIGINAL INITIATOR's
 * department, regardless of which chain step is being resolved.
 */
export const sysCandidateRules = pgTable('sys_candidate_rules', {
  id: uuid('id').defaultRandom().primaryKey(),
  name: varchar('name', { length: 100 }).notNull(),
  filter: jsonb('filter').notNull(),
  enabled: boolean('enabled').notNull().default(true),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  deletedAt: timestamp('deleted_at', { withTimezone: true }),
});

export type SysCandidateRule = typeof sysCandidateRules.$inferSelect;
export type NewSysCandidateRule = typeof sysCandidateRules.$inferInsert;

export interface CandidateRuleFilter {
  roleIds?: string[];
  positions?: string[];
  orgScope?:
    | { type: 'fixed'; deptId: string; includeSubtree?: boolean }
    | { type: 'self' | 'parent' | 'company' };
}
