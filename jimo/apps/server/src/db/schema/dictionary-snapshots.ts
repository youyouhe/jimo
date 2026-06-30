import {
  pgTable,
  uuid,
  varchar,
  smallint,
  jsonb,
  timestamp,
  index,
} from 'drizzle-orm/pg-core';

export const sysDictionarySnapshots = pgTable(
  'sys_dictionary_snapshots',
  {
    id: uuid('id').defaultRandom().primaryKey(),
    dictId: uuid('dict_id').notNull(),
    version: smallint('version').notNull(),
    snapshot: jsonb('snapshot').notNull(),
    changeType: varchar('change_type', { length: 32 }).notNull(),
    operator: varchar('operator', { length: 128 }),
    note: varchar('note', { length: 256 }),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    index('idx_dict_snapshots_dict_id').on(t.dictId),
    index('idx_dict_snapshots_dict_ver').on(t.dictId, t.version),
  ],
);

export type SysDictionarySnapshot = typeof sysDictionarySnapshots.$inferSelect;
export type NewSysDictionarySnapshot = typeof sysDictionarySnapshots.$inferInsert;
