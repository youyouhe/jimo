import {
  pgTable,
  integer,
  text,
  timestamp,
  uuid,
  varchar,
} from 'drizzle-orm/pg-core';

import { policies } from './policies';


export const policyDetails = pgTable(
  'lc_policy_details',
  {
    id: uuid('id').defaultRandom().primaryKey(),
    policy_id: uuid('policy_id').notNull().references(() => policies.id),
    chapter_number: varchar('chapter_number', { length: 20 }).default(''),
    title: varchar('title', { length: 300 }).notNull(),
    content: text('content').notNull(),
    sort_order: integer('sort_order').default(0),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
    deletedAt: timestamp('deleted_at', { withTimezone: true }),
    createdBy: uuid('created_by'),
    updatedBy: uuid('updated_by'),
  },
);

export type PolicyDetails = typeof policyDetails.$inferSelect;
export type NewPolicyDetails = typeof policyDetails.$inferInsert;
