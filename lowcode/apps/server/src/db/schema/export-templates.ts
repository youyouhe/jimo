import { sql } from 'drizzle-orm';
import {
  pgTable,
  uuid,
  varchar,
  jsonb,
  timestamp,
  uniqueIndex,
} from 'drizzle-orm/pg-core';

export const sysExportTemplates = pgTable(
  'sys_export_templates',
  {
    id: uuid('id').defaultRandom().primaryKey(),
    name: varchar('name', { length: 128 }).notNull(),
    tableName: varchar('table_name', { length: 128 }).notNull(),
    templateType: varchar('template_type', { length: 32 }).notNull().default('json'),
    config: jsonb('config'),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
    deletedAt: timestamp('deleted_at', { withTimezone: true }),
  },
  (t) => [
    uniqueIndex('idx_sys_export_templates_name_active')
      .on(t.name)
      .where(sql`${t.deletedAt} IS NULL`),
  ],
);

export type SysExportTemplate = typeof sysExportTemplates.$inferSelect;
export type NewSysExportTemplate = typeof sysExportTemplates.$inferInsert;
