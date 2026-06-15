import {
  pgTable,
  integer,
  numeric,
  timestamp,
  uuid,
  varchar,
} from 'drizzle-orm/pg-core';


export const order = pgTable(
  'lc_order',
  {
    id: uuid('id').defaultRandom().primaryKey(),
    name: varchar('name', { length: 255 }).default(''),
    price: numeric('price', { precision: 12, scale: 2 }).default('0'),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
    deletedAt: timestamp('deleted_at', { withTimezone: true }),
    createdBy: uuid('created_by'),
    updatedBy: uuid('updated_by'),
  },
);

export type Order = typeof order.$inferSelect;
export type NewOrder = typeof order.$inferInsert;


export const orderDetail = pgTable(
  'lc_order_detail',
  {
    id: uuid('id').defaultRandom().primaryKey(),
    name: varchar('name', { length: 255 }).default(''),
    number: varchar('number', { length: 255 }).default(''),
    price: varchar('price', { length: 255 }).default(''),
    order_id: uuid('order_id').notNull().references(() => order.id),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
    deletedAt: timestamp('deleted_at', { withTimezone: true }),
  },
);

export type OrderDetail = typeof orderDetail.$inferSelect;
export type NewOrderDetail = typeof orderDetail.$inferInsert;


export const orderPerformance = pgTable(
  'lc_order_performance',
  {
    id: uuid('id').defaultRandom().primaryKey(),
    name: varchar('name', { length: 255 }).default(''),
    time: timestamp('time', { withTimezone: true }),
    amount: integer('amount').default(0),
    memo: varchar('memo', { length: 255 }).default(''),
    order_id: uuid('order_id').notNull().references(() => order.id),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
    deletedAt: timestamp('deleted_at', { withTimezone: true }),
  },
);

export type OrderPerformance = typeof orderPerformance.$inferSelect;
export type NewOrderPerformance = typeof orderPerformance.$inferInsert;
