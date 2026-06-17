import {
  pgTable,
  timestamp,
  uuid,
  varchar,
} from 'drizzle-orm/pg-core';

import { students } from './students';
import { clubs } from './clubs';


export const studentClubs = pgTable(
  'lc_student_clubs',
  {
    id: uuid('id').defaultRandom().primaryKey(),
    student_id: uuid('student_id').notNull().references(() => students.id),
    club_id: uuid('club_id').notNull().references(() => clubs.id),
    join_date: timestamp('join_date', { withTimezone: true }).notNull(),
    role: varchar('role', { length: 30 }).default(''),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
    deletedAt: timestamp('deleted_at', { withTimezone: true }),
    createdBy: uuid('created_by'),
    updatedBy: uuid('updated_by'),
  },
);

export type StudentClubs = typeof studentClubs.$inferSelect;
export type NewStudentClubs = typeof studentClubs.$inferInsert;
