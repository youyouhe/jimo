import { pgTable, uuid, varchar, timestamp, index } from 'drizzle-orm/pg-core';

export const sysJwtBlacklist = pgTable(
  'sys_jwt_blacklist',
  {
    id: uuid('id').defaultRandom().primaryKey(),
    jti: varchar('jti', { length: 128 }).notNull().unique(),
    expiresAt: timestamp('expires_at', { withTimezone: true }).notNull(),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    index('idx_sys_jwt_blacklist_expires_at').on(t.expiresAt),
  ],
);

export type SysJwtBlacklist = typeof sysJwtBlacklist.$inferSelect;
export type NewSysJwtBlacklist = typeof sysJwtBlacklist.$inferInsert;
