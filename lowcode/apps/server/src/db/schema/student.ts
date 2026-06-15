import {
  pgTable,
  integer,
  numeric,
  timestamp,
  uuid,
  varchar,
} from 'drizzle-orm/pg-core';

import { score } from './score';


export const student = pgTable(
  'lc_student',
  {
    id: uuid('id').defaultRandom().primaryKey(),
    name: varchar('name', { length: 255 }).default(''),
    age: integer('age').default(0),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
    deletedAt: timestamp('deleted_at', { withTimezone: true }),
    createdBy: uuid('created_by'),
    updatedBy: uuid('updated_by'),
  },
);

export type Student = typeof student.$inferSelect;
export type NewStudent = typeof student.$inferInsert;


export const studentFamily = pgTable(
  'lc_student_family',
  {
    id: uuid('id').defaultRandom().primaryKey(),
    name: varchar('name', { length: 255 }).default(''),
    relation: varchar('relation', { length: 255 }).default(''),
    student_id: uuid('student_id').notNull().references(() => student.id),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
    deletedAt: timestamp('deleted_at', { withTimezone: true }),
  },
);

export type StudentFamily = typeof studentFamily.$inferSelect;
export type NewStudentFamily = typeof studentFamily.$inferInsert;
