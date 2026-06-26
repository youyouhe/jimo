import { sql } from 'drizzle-orm';
import {
  pgTable,
  uuid,
  varchar,
  text,
  boolean,
  timestamp,
  uniqueIndex,
} from 'drizzle-orm/pg-core';

/**
 * BPM process definitions — metadata for each process workflow.
 *
 * Each definition can have multiple versions stored in bpm_process_versions.
 * The `current_version_id` points to the latest saved version (the working
 * copy in the designer), while `deployed_version_id` points to the version
 * that was last deployed to the BPM engine.
 *
 * A unique key ensures no two active definitions share the same process key.
 */
export const bpmProcessDefinitions = pgTable(
  'bpm_process_definitions',
  {
    id: uuid('id').defaultRandom().primaryKey(),
    name: varchar('name', { length: 100 }).notNull(),
    key: varchar('key', { length: 100 }).notNull(),
    description: text('description'),
    icon: varchar('icon', { length: 50 }),
    status: varchar('status', { length: 20 }).notNull().default('draft'),
    category: varchar('category', { length: 50 }),
    currentVersionId: uuid('current_version_id'),
    deployedVersionId: uuid('deployed_version_id'),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
    deletedAt: timestamp('deleted_at', { withTimezone: true }),
  },
  (t) => [
    uniqueIndex('idx_bpm_process_defs_key_active')
      .on(t.key)
      .where(sql`${t.deletedAt} IS NULL`),
  ],
);

export type BpmProcessDefinition = typeof bpmProcessDefinitions.$inferSelect;
export type NewBpmProcessDefinition = typeof bpmProcessDefinitions.$inferInsert;
