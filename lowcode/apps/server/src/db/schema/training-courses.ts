import { sql } from 'drizzle-orm';
import {
  pgTable,
  boolean,
  integer,
  text,
  timestamp,
  uuid,
  varchar,
  uniqueIndex,
} from 'drizzle-orm/pg-core';


export const trainingCourses = pgTable(
  'lc_training_courses',
  {
    id: uuid('id').defaultRandom().primaryKey(),
    name: varchar('name', { length: 100 }).notNull(),
    description: text('description').default(''),
    start_date: timestamp('start_date', { withTimezone: true }).notNull(),
    end_date: timestamp('end_date', { withTimezone: true }).notNull(),
    is_published: boolean('is_published').notNull(),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
    deletedAt: timestamp('deleted_at', { withTimezone: true }),
    createdBy: uuid('created_by'),
    updatedBy: uuid('updated_by'),
  },
  (t) => [
    uniqueIndex('idx_training_courses_name_active')
      .on(t.name)
      .where(sql`${t.deletedAt} IS NULL`),
  ],
);

export type TrainingCourses = typeof trainingCourses.$inferSelect;
export type NewTrainingCourses = typeof trainingCourses.$inferInsert;


export const trainingCoursModule = pgTable(
  'lc_training_cours_module',
  {
    id: uuid('id').defaultRandom().primaryKey(),
    module_name: varchar('module_name', { length: 100 }).notNull(),
    module_desc: text('module_desc').default(''),
    sort_order: integer('sort_order').notNull(),
    trainingCours_id: uuid('trainingCours_id').notNull().references(() => trainingCourses.id),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
    deletedAt: timestamp('deleted_at', { withTimezone: true }),
  },
);

export type TrainingCoursModule = typeof trainingCoursModule.$inferSelect;
export type NewTrainingCoursModule = typeof trainingCoursModule.$inferInsert;

export const trainingCoursModuleTask = pgTable(
  'lc_training_cours_module_task',
  {
    id: uuid('id').defaultRandom().primaryKey(),
    task_name: varchar('task_name', { length: 100 }).notNull(),
    task_desc: text('task_desc').default(''),
    due_hours: integer('due_hours').default(0),
    sort_order: integer('sort_order').notNull(),
    trainingCoursModule_id: uuid('trainingCoursModule_id').notNull().references(() => trainingCoursModule.id),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
    deletedAt: timestamp('deleted_at', { withTimezone: true }),
  },
);

export type TrainingCoursModuleTask = typeof trainingCoursModuleTask.$inferSelect;
export type NewTrainingCoursModuleTask = typeof trainingCoursModuleTask.$inferInsert;
