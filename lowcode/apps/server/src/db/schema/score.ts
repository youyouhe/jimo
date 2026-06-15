import {
  pgTable,
  numeric,
  timestamp,
  uuid,
  varchar,
} from 'drizzle-orm/pg-core';

import { student } from './student';
import { course } from './course';


export const score = pgTable(
  'lc_score',
  {
    id: uuid('id').defaultRandom().primaryKey(),
    student: uuid('student').references(() => student.id),
    course: uuid('course').references(() => course.id),
    myscore: numeric('myscore', { precision: 12, scale: 2 }).default('0'),
    memo: varchar('memo', { length: 255 }).default(''),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
    deletedAt: timestamp('deleted_at', { withTimezone: true }),
    createdBy: uuid('created_by'),
    updatedBy: uuid('updated_by'),
  },
);

export type Score = typeof score.$inferSelect;
export type NewScore = typeof score.$inferInsert;
