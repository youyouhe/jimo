import {
  pgTable,
  uuid,
  varchar,
  timestamp,
  index,
} from 'drizzle-orm/pg-core';

export const sysApiTokens = pgTable(
  'sys_api_tokens',
  {
    id: uuid('id').defaultRandom().primaryKey(),
    name: varchar('name', { length: 128 }).notNull(),
    token: varchar('token', { length: 255 }).notNull(),
    userId: uuid('user_id').notNull(),
    expiresAt: timestamp('expires_at', { withTimezone: true }),
    lastUsedAt: timestamp('last_used_at', { withTimezone: true }),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    index('idx_sys_api_tokens_token').on(t.token),
    index('idx_sys_api_tokens_user_id').on(t.userId),
  ],
);

export type SysApiToken = typeof sysApiTokens.$inferSelect;
export type NewSysApiToken = typeof sysApiTokens.$inferInsert;
