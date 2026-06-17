import { sql } from 'drizzle-orm';
import {
  pgTable,
  integer,
  text,
  timestamp,
  uuid,
  varchar,
  uniqueIndex,
} from 'drizzle-orm/pg-core';

import { departments } from './departments';


export const policies = pgTable(
  'lc_policies',
  {
    id: uuid('id').defaultRandom().primaryKey(),
    name: varchar('name', { length: 200 }).notNull(),
    policy_code: varchar('policy_code', { length: 100 }).default(''),
    policy_type: varchar('policy_type', { length: 64 }).default(''),
    version: varchar('version', { length: 50 }).default(''),
    status: varchar('status', { length: 64 }).default(''),
    department_id: uuid('department_id').references(() => departments.id),
    effective_date: timestamp('effective_date', { withTimezone: true }),
    expiration_date: timestamp('expiration_date', { withTimezone: true }),
    description: text('description').default(''),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
    deletedAt: timestamp('deleted_at', { withTimezone: true }),
    createdBy: uuid('created_by'),
    updatedBy: uuid('updated_by'),
  },
  (t) => [
    uniqueIndex('idx_policies_name_active')
      .on(t.name)
      .where(sql`${t.deletedAt} IS NULL`),
    uniqueIndex('idx_policies_policy_code_active')
      .on(t.policy_code)
      .where(sql`${t.deletedAt} IS NULL`),
  ],
);

export type Policies = typeof policies.$inferSelect;
export type NewPolicies = typeof policies.$inferInsert;


export const policyPolicyDetail = pgTable(
  'lc_policy_policy_detail',
  {
    id: uuid('id').defaultRandom().primaryKey(),
    chapter_number: varchar('chapter_number', { length: 20 }).default(''),
    title: varchar('title', { length: 300 }).notNull(),
    content: text('content').notNull(),
    sort_order: integer('sort_order').default(0),
    policy_id: uuid('policy_id').notNull().references(() => policies.id),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
    deletedAt: timestamp('deleted_at', { withTimezone: true }),
  },
);

export type PolicyPolicyDetail = typeof policyPolicyDetail.$inferSelect;
export type NewPolicyPolicyDetail = typeof policyPolicyDetail.$inferInsert;
