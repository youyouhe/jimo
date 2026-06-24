import {
  pgTable,
  uuid,
  varchar,
  integer,
  text,
  jsonb,
  timestamp,
} from 'drizzle-orm/pg-core';

export const sysAutoCodeHistories = pgTable(
  'sys_auto_code_histories',
  {
    id: uuid('id').defaultRandom().primaryKey(),
    packageName: varchar('package_name', { length: 255 }).notNull().default(''),
    tableName: varchar('table_name', { length: 255 }).notNull(),
    businessDB: varchar('business_db', { length: 255 }).notNull().default(''),
    templates: jsonb('templates').notNull().default({}),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),

    // ── Version management columns ──
    /** Auto-incrementing version number per tableName */
    version: integer('version').default(1),
    /** Snapshot of AutoCodeField[] at generation time */
    fields: jsonb('fields'),
    /** Human-readable change description */
    changeLog: text('change_log').default(''),
    /** Operation type: create / update / rollback */
    operation: varchar('operation', { length: 20 }).default('create'),
    /** ID of the previous version record (version chain) */
    parentId: uuid('parent_id'),
    /** Row-level visibility strategy: private/department/shared/public */
    visibilityStrategy: varchar('visibility_strategy', { length: 20 }).default('private'),
  },
);

export type SysAutoCodeHistory = typeof sysAutoCodeHistories.$inferSelect;
export type NewSysAutoCodeHistory = typeof sysAutoCodeHistories.$inferInsert;
