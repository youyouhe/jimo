import { uuid, pgTable, timestamp, uniqueIndex } from 'drizzle-orm/pg-core';
import { sysRoles } from './roles';
import { sysMenus } from './menus';

/**
 * sys_role_menus — many-to-many junction between roles and menus.
 * Mirrors GVA's sys_authority_menus table.
 */
export const sysRoleMenus = pgTable(
  'sys_role_menus',
  {
    id: uuid('id').defaultRandom().primaryKey(),
    roleId: uuid('role_id')
      .notNull()
      .references(() => sysRoles.id, { onDelete: 'cascade' }),
    menuId: uuid('menu_id')
      .notNull()
      .references(() => sysMenus.id, { onDelete: 'cascade' }),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    uniqueIndex('idx_role_menu_unique').on(t.roleId, t.menuId),
  ],
);

export type SysRoleMenu = typeof sysRoleMenus.$inferSelect;
export type NewSysRoleMenu = typeof sysRoleMenus.$inferInsert;
