import { sql } from 'drizzle-orm';
import {
  pgTable,
  jsonb,
  text,
  timestamp,
  uuid,
  varchar,
  uniqueIndex,
} from 'drizzle-orm/pg-core';


export const students = pgTable(
  'lc_students',
  {
    id: uuid('id').defaultRandom().primaryKey(),
    student_no: varchar('student_no', { length: 50 }).notNull(),
    name: varchar('name', { length: 100 }).notNull(),
    gender: varchar('gender', { length: 64 }).default(''),
    birth_date: timestamp('birth_date', { withTimezone: true }),
    class_name: varchar('class_name', { length: 100 }).default(''),
    phone: varchar('phone', { length: 20 }).default(''),
    email: varchar('email', { length: 200 }).default(''),
    enrollment_status: varchar('enrollment_status', { length: 64 }).default(''),
    address: text('address').default(''),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
    deletedAt: timestamp('deleted_at', { withTimezone: true }),
    createdBy: uuid('created_by'),
    updatedBy: uuid('updated_by'),
    ownerId: uuid('owner_id'),
    sharedWith: jsonb('shared_with'),
  },
  (t) => [
    uniqueIndex('idx_students_student_no_active')
      .on(t.student_no)
      .where(sql`${t.deletedAt} IS NULL`),
  ],
);

export type Students = typeof students.$inferSelect;
export type NewStudents = typeof students.$inferInsert;
