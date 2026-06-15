import {
  pgTable,
  uuid,
  varchar,
  text,
  smallint,
  timestamp,
  index,
} from 'drizzle-orm/pg-core';

export const ErrorLevel = {
  FATAL: 'fatal',
  ERROR: 'error',
  WARN: 'warn',
  INFO: 'info',
} as const;
export type ErrorLevel = (typeof ErrorLevel)[keyof typeof ErrorLevel];

export const ErrorStatus = {
  UNRESOLVED: 0,
  RESOLVING: 1,
  RESOLVED: 2,
  IGNORED: 3,
} as const;

export const sysError = pgTable(
  'sys_error',
  {
    id: uuid('id').defaultRandom().primaryKey(),
    level: varchar('level', { length: 10 }).notNull().default(ErrorLevel.ERROR),
    source: varchar('source', { length: 128 }).notNull().default(''),
    message: text('message').notNull().default(''),
    stack: text('stack').default(''),
    solution: text('solution').default(''),
    status: smallint('status').notNull().default(ErrorStatus.UNRESOLVED),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    index('idx_sys_error_level').on(t.level),
    index('idx_sys_error_source').on(t.source),
    index('idx_sys_error_status').on(t.status),
    index('idx_sys_error_created_at').on(t.createdAt),
  ],
);

export type SysError = typeof sysError.$inferSelect;
export type NewSysError = typeof sysError.$inferInsert;
