import {
  pgTable,
  uuid,
  varchar,
  text,
  boolean,
  jsonb,
  timestamp,
} from 'drizzle-orm/pg-core';
import { sysMenus } from './menus';

export const sysAutoCodePackages = pgTable(
  'sys_auto_code_packages',
  {
    id: uuid('id').defaultRandom().primaryKey(),
    name: varchar('name', { length: 255 }).notNull(),
    slug: varchar('slug', { length: 64 }).notNull().default(''),
    description: text('description').default(''),
    templates: jsonb('templates').notNull().default({}),
    // ── Generation config snapshot (for "Load from Package") ──
    tableName: varchar('table_name', { length: 255 }).default(''),
    fields: jsonb('fields'),
    generateWeb: boolean('generate_web').default(true),
    // ── Associated directory menu (for package-scoped menu grouping) ──
    menuId: uuid('menu_id').references(() => sysMenus.id, { onDelete: 'set null' }),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
    deletedAt: timestamp('deleted_at', { withTimezone: true }),
  },
);

export type SysAutoCodePackage = typeof sysAutoCodePackages.$inferSelect;
export type NewSysAutoCodePackage = typeof sysAutoCodePackages.$inferInsert;
