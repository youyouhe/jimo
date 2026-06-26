import { sql } from 'drizzle-orm';
import {
  pgTable,
  jsonb,
  text,
  timestamp,
  uuid,
  varchar,
  uniqueIndex,
} from 'drizzle-orm/pg-core';


export const regions = pgTable(
  'lc_regions',
  {
    id: uuid('id').defaultRandom().primaryKey(),
    name: varchar('name', { length: 200 }).notNull(),
    code: varchar('code', { length: 50 }).default(''),
    parent_id: uuid('parent_id'),
    level: varchar('level', { length: 20 }).default(''),
    remark: text('remark').default(''),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
    deletedAt: timestamp('deleted_at', { withTimezone: true }),
    createdBy: uuid('created_by'),
    updatedBy: uuid('updated_by'),
    ownerId: uuid('owner_id'),
    sharedWith: jsonb('shared_with'),
  },
  (t) => [
    uniqueIndex('idx_regions_name_active')
      .on(t.name)
      .where(sql`${t.deletedAt} IS NULL`),
    uniqueIndex('idx_regions_code_active')
      .on(t.code)
      .where(sql`${t.deletedAt} IS NULL`),
  ],
);

export type Regions = typeof regions.$inferSelect;
export type NewRegions = typeof regions.$inferInsert;
