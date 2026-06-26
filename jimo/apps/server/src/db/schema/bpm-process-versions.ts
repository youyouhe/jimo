import {
  pgTable,
  uuid,
  integer,
  varchar,
  text,
  jsonb,
  boolean,
  timestamp,
  index,
} from 'drizzle-orm/pg-core';

/**
 * Immutable version history for BPM process definitions.
 *
 * Each row is a point-in-time snapshot of a process definition. The `lf_json`
 * column stores the LogicFlow graph data (nodes, edges, properties), while
 * `bpmn_xml` stores the generated BPMN 2.0 XML. Versions are never updated —
 * a new version row is inserted for every save or deploy action.
 *
 * `definition_id` is a soft reference to bpm_process_definitions.id (no DB FK
 * constraint, to allow flexible lifecycle management).
 */
export const bpmProcessVersions = pgTable(
  'bpm_process_versions',
  {
    id: uuid('id').defaultRandom().primaryKey(),
    definitionId: uuid('definition_id').notNull(),
    version: integer('version').notNull(),
    name: varchar('name', { length: 100 }).notNull(),
    lfJson: jsonb('lf_json'),
    bpmnXml: text('bpmn_xml'),
    changeLog: text('change_log'),
    isDeployed: boolean('is_deployed').default(false),
    deployedAt: timestamp('deployed_at', { withTimezone: true }),
    deploymentId: varchar('deployment_id', { length: 100 }),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
    deletedAt: timestamp('deleted_at', { withTimezone: true }),
  },
  (t) => [
    index('idx_bpm_process_vers_def').on(t.definitionId),
    index('idx_bpm_process_vers_def_ver').on(t.definitionId, t.version),
  ],
);

export type BpmProcessVersion = typeof bpmProcessVersions.$inferSelect;
export type NewBpmProcessVersion = typeof bpmProcessVersions.$inferInsert;
