import {
  pgTable,
  timestamp,
  uuid,
  varchar,
} from 'drizzle-orm/pg-core';


export const test = pgTable(
  'lc_test',
  {
    id: uuid('id').defaultRandom().primaryKey(),
    name: varchar('name', { length: 255 }).default(''),
    description: varchar('description', { length: 255 }).default(''),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
    deletedAt: timestamp('deleted_at', { withTimezone: true }),
    createdBy: uuid('created_by'),
    updatedBy: uuid('updated_by'),
  },
);

export type Test = typeof test.$inferSelect;
export type NewTest = typeof test.$inferInsert;
