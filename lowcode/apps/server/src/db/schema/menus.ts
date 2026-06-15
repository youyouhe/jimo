import { sql } from 'drizzle-orm';
import {
  pgTable,
  uuid,
  varchar,
  smallint,
  timestamp,
  index,
} from 'drizzle-orm/pg-core';

export const sysMenus = pgTable(
  'sys_menus',
  {
    id: uuid('id').defaultRandom().primaryKey(),
    name: varchar('name', { length: 64 }).notNull(),
    path: varchar('path', { length: 255 }),
    component: varchar('component', { length: 255 }),
    icon: varchar('icon', { length: 64 }),
    parentId: uuid('parent_id'),
    sort: smallint('sort').notNull().default(0),
    isVisible: smallint('is_visible').notNull().default(1),
    permission: varchar('permission', { length: 128 }),
    menuType: smallint('menu_type').notNull().default(1),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
    deletedAt: timestamp('deleted_at', { withTimezone: true }),
  },
  (t) => [
    index('idx_sys_menus_parent_id').on(t.parentId),
    index('idx_sys_menus_active')
      .on(t.sort)
      .where(sql`${t.deletedAt} IS NULL`),
  ],
);

export type SysMenu = typeof sysMenus.$inferSelect;
export type NewSysMenu = typeof sysMenus.$inferInsert;
