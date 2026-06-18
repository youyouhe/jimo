import { sql } from 'drizzle-orm';
import {
  pgTable,
  text,
  timestamp,
  uuid,
  varchar,
  uniqueIndex,
} from 'drizzle-orm/pg-core';


export const posts = pgTable(
  'lc_posts',
  {
    id: uuid('id').defaultRandom().primaryKey(),
    title: varchar('title', { length: 200 }).notNull(),
    content: text('content').notNull(),
    summary: text('summary').default(''),
    cover_image: varchar('cover_image', { length: 512 }).default(''),
    published_at: timestamp('published_at', { withTimezone: true }),
    status: varchar('status', { length: 20 }).notNull(),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
    deletedAt: timestamp('deleted_at', { withTimezone: true }),
    createdBy: uuid('created_by'),
    updatedBy: uuid('updated_by'),
  },
  (t) => [
    uniqueIndex('idx_posts_title_active')
      .on(t.title)
      .where(sql`${t.deletedAt} IS NULL`),
  ],
);

export type Posts = typeof posts.$inferSelect;
export type NewPosts = typeof posts.$inferInsert;
