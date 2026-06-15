import {
  pgTable,
  uuid,
  varchar,
  text,
  smallint,
  timestamp,
  index,
} from 'drizzle-orm/pg-core';

export const LoginLogStatus = {
  SUCCESS: 1,
  FAILURE: 0,
} as const;

export const sysLoginLogs = pgTable(
  'sys_login_logs',
  {
    id: uuid('id').defaultRandom().primaryKey(),
    userId: uuid('user_id'),
    username: varchar('username', { length: 64 }).notNull().default(''),
    ip: varchar('ip', { length: 45 }).notNull().default(''),
    userAgent: text('user_agent').default(''),
    status: smallint('status').notNull().default(LoginLogStatus.SUCCESS),
    message: varchar('message', { length: 256 }).default(''),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    index('idx_sys_login_logs_username').on(t.username),
    index('idx_sys_login_logs_status').on(t.status),
    index('idx_sys_login_logs_created_at').on(t.createdAt),
    index('idx_sys_login_logs_user_id').on(t.userId),
  ],
);

export type SysLoginLog = typeof sysLoginLogs.$inferSelect;
export type NewSysLoginLog = typeof sysLoginLogs.$inferInsert;
