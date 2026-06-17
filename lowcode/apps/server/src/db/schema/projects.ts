import { sql } from 'drizzle-orm';
import {
  pgTable,
  boolean,
  text,
  timestamp,
  uuid,
  varchar,
  uniqueIndex,
} from 'drizzle-orm/pg-core';

import { projectTasks } from './project-tasks';


export const projects = pgTable(
  'lc_projects',
  {
    id: uuid('id').defaultRandom().primaryKey(),
    name: varchar('name', { length: 100 }).notNull(),
    description: text('description').default(''),
    start_date: timestamp('start_date', { withTimezone: true }).notNull(),
    end_date: timestamp('end_date', { withTimezone: true }),
    is_active: boolean('is_active').notNull(),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
    deletedAt: timestamp('deleted_at', { withTimezone: true }),
    createdBy: uuid('created_by'),
    updatedBy: uuid('updated_by'),
  },
  (t) => [
    uniqueIndex('idx_projects_name_active')
      .on(t.name)
      .where(sql`${t.deletedAt} IS NULL`),
  ],
);

export type Projects = typeof projects.$inferSelect;
export type NewProjects = typeof projects.$inferInsert;
