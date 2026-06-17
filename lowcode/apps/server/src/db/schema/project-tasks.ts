import {
  pgTable,
  timestamp,
  uuid,
  varchar,
} from 'drizzle-orm/pg-core';

import { projects } from './projects';


export const projectTasks = pgTable(
  'lc_project_tasks',
  {
    id: uuid('id').defaultRandom().primaryKey(),
    project_id: uuid('project_id').notNull().references(() => projects.id),
    task_name: varchar('task_name', { length: 100 }).notNull(),
    assignee: varchar('assignee', { length: 50 }).default(''),
    status: varchar('status', { length: 64 }).notNull(),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
    deletedAt: timestamp('deleted_at', { withTimezone: true }),
    createdBy: uuid('created_by'),
    updatedBy: uuid('updated_by'),
  },
);

export type ProjectTasks = typeof projectTasks.$inferSelect;
export type NewProjectTasks = typeof projectTasks.$inferInsert;
