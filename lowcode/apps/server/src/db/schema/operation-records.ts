import {
  pgTable,
  uuid,
  varchar,
  integer,
  text,
  timestamp,
  index,
} from 'drizzle-orm/pg-core';

export const sysOperationRecords = pgTable(
  'sys_operation_records',
  {
    id: uuid('id').defaultRandom().primaryKey(),
    ip: varchar('ip', { length: 45 }).notNull(),
    method: varchar('method', { length: 10 }).notNull(),
    path: varchar('path', { length: 512 }).notNull(),
    status: integer('status').notNull(),
    latency: integer('latency').notNull(),
    agent: varchar('agent', { length: 512 }).notNull().default(''),
    errorMessage: text('error_message'),
    body: text('body').notNull().default(''),
    resp: text('resp').notNull().default(''),
    userId: uuid('user_id'),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    index('idx_opr_method').on(t.method),
    index('idx_opr_path').on(t.path),
    index('idx_opr_status').on(t.status),
    index('idx_opr_user_id').on(t.userId),
    index('idx_opr_created_at').on(t.createdAt.desc()),
  ],
);

export type SysOperationRecord = typeof sysOperationRecords.$inferSelect;
export type NewSysOperationRecord = typeof sysOperationRecords.$inferInsert;
