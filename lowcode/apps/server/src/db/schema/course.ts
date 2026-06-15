import {
  pgTable,
  timestamp,
  uuid,
  varchar,
} from 'drizzle-orm/pg-core';


export const course = pgTable(
  'lc_course',
  {
    id: uuid('id').defaultRandom().primaryKey(),
    course: varchar('course', { length: 255 }).default(''),
    teacher: varchar('teacher', { length: 255 }).default(''),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
    deletedAt: timestamp('deleted_at', { withTimezone: true }),
    createdBy: uuid('created_by'),
    updatedBy: uuid('updated_by'),
  },
);

export type Course = typeof course.$inferSelect;
export type NewCourse = typeof course.$inferInsert;
