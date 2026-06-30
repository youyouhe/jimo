import { pgTable, uuid, varchar, jsonb, timestamp, text } from 'drizzle-orm/pg-core';

/**
 * Queue table for autocode generate jobs, consumed by the standalone
 * `tools/generate-worker.ts` (runs via tsx, outside the NestJS watch process
 * so dev watch restarts can no longer interrupt a generate job).
 *
 * Mirrors sys_cleanup_jobs. Enqueued by AutocodeService.startGenerate; polled
 * by generate-worker via `FOR UPDATE SKIP LOCKED`. payload stores the full
 * AutoCodeDto + the steps/progress array.
 */
export const sysGenerateJobs = pgTable('sys_generate_jobs', {
  id: uuid('id').primaryKey().defaultRandom(),
  tableName: varchar('table_name', { length: 255 }).notNull(),
  status: varchar('status', { length: 20 }).notNull().default('pending'),
  jobType: varchar('job_type', { length: 50 }).notNull().default('generate'),
  payload: jsonb('payload'),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  startedAt: timestamp('started_at', { withTimezone: true }),
  finishedAt: timestamp('finished_at', { withTimezone: true }),
  result: jsonb('result'),
  error: text('error'),
});

export type SysGenerateJob = typeof sysGenerateJobs.$inferSelect;
export type NewSysGenerateJob = typeof sysGenerateJobs.$inferInsert;
