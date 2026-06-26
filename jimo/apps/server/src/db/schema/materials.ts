import { sql } from 'drizzle-orm';
import {
  pgTable,
  jsonb,
  numeric,
  text,
  timestamp,
  uuid,
  varchar,
  uniqueIndex,
} from 'drizzle-orm/pg-core';


export const materials = pgTable(
  'lc_materials',
  {
    id: uuid('id').defaultRandom().primaryKey(),
    name: varchar('name', { length: 200 }).notNull(),
    code: varchar('code', { length: 100 }).notNull(),
    material_type: varchar('material_type', { length: 64 }).default(''),
    specification: varchar('specification', { length: 200 }).default(''),
    unit: varchar('unit', { length: 50 }).default(''),
    unit_price: numeric('unit_price', { precision: 12, scale: 2 }).default('0'),
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
    uniqueIndex('idx_materials_code_active')
      .on(t.code)
      .where(sql`${t.deletedAt} IS NULL`),
  ],
);

export type Materials = typeof materials.$inferSelect;
export type NewMaterials = typeof materials.$inferInsert;
