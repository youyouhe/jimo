import {
  pgTable,
  uuid,
  timestamp,
  uniqueIndex,
} from 'drizzle-orm/pg-core';
import { sysUsers } from './users.js';
import { sysRoles } from './roles.js';

export const sysUserRoles = pgTable(
  'sys_user_roles',
  {
    id: uuid('id').defaultRandom().primaryKey(),
    userId: uuid('user_id')
      .notNull()
      .references(() => sysUsers.id),
    roleId: uuid('role_id')
      .notNull()
      .references(() => sysRoles.id),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    uniqueIndex('idx_sys_user_roles_user_role').on(t.userId, t.roleId),
  ],
);

export type SysUserRole = typeof sysUserRoles.$inferSelect;
export type NewSysUserRole = typeof sysUserRoles.$inferInsert;
