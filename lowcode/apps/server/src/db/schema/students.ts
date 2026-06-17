import { sql } from 'drizzle-orm';
import {
  pgTable,
  integer,
  timestamp,
  uuid,
  varchar,
  uniqueIndex,
} from 'drizzle-orm/pg-core';

import { studentClubs } from './student-clubs';


export const students = pgTable(
  'lc_students',
  {
    id: uuid('id').defaultRandom().primaryKey(),
    name: varchar('name', { length: 50 }).notNull(),
    student_no: varchar('student_no', { length: 30 }).notNull(),
    gender: varchar('gender', { length: 64 }).notNull(),
    enrollment_year: integer('enrollment_year').notNull(),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
    deletedAt: timestamp('deleted_at', { withTimezone: true }),
    createdBy: uuid('created_by'),
    updatedBy: uuid('updated_by'),
  },
  (t) => [
    uniqueIndex('idx_students_student_no_active')
      .on(t.student_no)
      .where(sql`${t.deletedAt} IS NULL`),
  ],
);

export type Students = typeof students.$inferSelect;
export type NewStudents = typeof students.$inferInsert;
