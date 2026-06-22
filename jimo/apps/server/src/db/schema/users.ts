import { sql } from 'drizzle-orm';
import {
  pgTable,
  uuid,
  varchar,
  smallint,
  timestamp,
  index,
  uniqueIndex,
} from 'drizzle-orm/pg-core';
import { sysDepartments } from './sys-departments.js';

export const UserRole = {
  SUPER_ADMIN: 'super_admin',
  ADMIN: 'admin',
  EDITOR: 'editor',
  VIEWER: 'viewer',
} as const;
export type UserRole = (typeof UserRole)[keyof typeof UserRole];

export const sysUsers = pgTable(
  'sys_users',
  {
    id: uuid('id').defaultRandom().primaryKey(),
    username: varchar('username', { length: 64 }).notNull(),
    passwordHash: varchar('password_hash', { length: 255 }).notNull(),
    nickname: varchar('nickname', { length: 64 }).notNull().default(''),
    email: varchar('email', { length: 128 }),
    phone: varchar('phone', { length: 20 }),
    avatar: varchar('avatar', { length: 512 }).default(''),
    // NOTE: a user's roles live in sys_user_roles (→ sys_roles), the single
    // source of truth. There is no denormalized role column here.
    status: smallint('status').notNull().default(1),
    lastLoginAt: timestamp('last_login_at', { withTimezone: true }),
    lastLoginIp: varchar('last_login_ip', { length: 45 }),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
    deletedAt: timestamp('deleted_at', { withTimezone: true }),
    deptId: uuid('dept_id').references(() => sysDepartments.id, { onDelete: 'set null' }),
    bpmUserId: varchar('bpm_user_id', { length: 32 }),
  },
  (t) => [
    uniqueIndex('idx_sys_users_username_active')
      .on(t.username)
      .where(sql`${t.deletedAt} IS NULL`),
    index('idx_sys_users_email_active')
      .on(t.email)
      .where(sql`${t.deletedAt} IS NULL AND ${t.email} IS NOT NULL`),
    index('idx_sys_users_phone_active')
      .on(t.phone)
      .where(sql`${t.deletedAt} IS NULL AND ${t.phone} IS NOT NULL`),
    index('idx_sys_users_status_active')
      .on(t.status)
      .where(sql`${t.deletedAt} IS NULL`),
    index('idx_sys_users_dept_active')
      .on(t.deptId)
      .where(sql`${t.deletedAt} IS NULL AND ${t.deptId} IS NOT NULL`),
    index('idx_sys_users_bpm_user_id')
      .on(t.bpmUserId)
      .where(sql`${t.bpmUserId} IS NOT NULL`),
  ],
);

export type SysUser = typeof sysUsers.$inferSelect;
export type NewSysUser = typeof sysUsers.$inferInsert;
