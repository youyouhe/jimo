import { sql } from 'drizzle-orm';
import {
  pgTable,
  text,
  timestamp,
  uuid,
  varchar,
  uniqueIndex,
} from 'drizzle-orm/pg-core';


export const clubs = pgTable(
  'lc_clubs',
  {
    id: uuid('id').defaultRandom().primaryKey(),
    name: varchar('name', { length: 80 }).notNull(),
    description: text('description').default(''),
    founded_date: timestamp('founded_date', { withTimezone: true }),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
    deletedAt: timestamp('deleted_at', { withTimezone: true }),
    createdBy: uuid('created_by'),
    updatedBy: uuid('updated_by'),
  },
  (t) => [
    uniqueIndex('idx_clubs_name_active')
      .on(t.name)
      .where(sql`${t.deletedAt} IS NULL`),
  ],
);

export type Clubs = typeof clubs.$inferSelect;
export type NewClubs = typeof clubs.$inferInsert;
