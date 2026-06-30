import { pgTable, uuid, varchar, jsonb, timestamp, text } from 'drizzle-orm/pg-core';

export const sysCleanupJobs = pgTable('sys_cleanup_jobs', {
  id: uuid('id').primaryKey().defaultRandom(),
  tableName: varchar('table_name', { length: 255 }).notNull(),
  status: varchar('status', { length: 20 }).notNull().default('pending'),
  jobType: varchar('job_type', { length: 50 }).notNull().default('cleanup'),
  payload: jsonb('payload'),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  startedAt: timestamp('started_at', { withTimezone: true }),
  finishedAt: timestamp('finished_at', { withTimezone: true }),
  result: jsonb('result'),
  error: text('error'),
});

export type SysCleanupJob = typeof sysCleanupJobs.$inferSelect;
export type NewSysCleanupJob = typeof sysCleanupJobs.$inferInsert;
