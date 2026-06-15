import { sql } from 'drizzle-orm';
import {
  pgTable,
  uuid,
  varchar,
  timestamp,
  index,
  uniqueIndex,
} from 'drizzle-orm/pg-core';

export const sysAuthorityBtns = pgTable(
  'sys_authority_btns',
  {
    id: uuid('id').defaultRandom().primaryKey(),
    authorityId: uuid('authority_id').notNull(),
    menuId: uuid('menu_id').notNull(),
    btnName: varchar('btn_name', { length: 64 }).notNull(),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
    deletedAt: timestamp('deleted_at', { withTimezone: true }),
  },
  (t) => [
    uniqueIndex('idx_sys_authority_btns_unique')
      .on(t.authorityId, t.menuId, t.btnName)
      .where(sql`${t.deletedAt} IS NULL`),
    index('idx_sys_authority_btns_authority_id')
      .on(t.authorityId)
      .where(sql`${t.deletedAt} IS NULL`),
    index('idx_sys_authority_btns_menu_id')
      .on(t.menuId)
      .where(sql`${t.deletedAt} IS NULL`),
  ],
);

export type SysAuthorityBtn = typeof sysAuthorityBtns.$inferSelect;
export type NewSysAuthorityBtn = typeof sysAuthorityBtns.$inferInsert;
