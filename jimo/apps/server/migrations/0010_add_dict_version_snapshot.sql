-- Add version counter to sys_dictionaries
ALTER TABLE "sys_dictionaries" ADD COLUMN IF NOT EXISTS "version" smallint NOT NULL DEFAULT 1;

-- Snapshot table (append-only, no soft delete)
CREATE TABLE IF NOT EXISTS "sys_dictionary_snapshots" (
  "id"          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  "dict_id"     uuid NOT NULL,
  "version"     smallint NOT NULL,
  "snapshot"    jsonb NOT NULL,
  "change_type" varchar(32) NOT NULL,
  "operator"    varchar(128),
  "note"        varchar(256),
  "created_at"  timestamp with time zone DEFAULT now() NOT NULL
);

CREATE INDEX IF NOT EXISTS "idx_dict_snapshots_dict_id"  ON "sys_dictionary_snapshots" ("dict_id");
CREATE INDEX IF NOT EXISTS "idx_dict_snapshots_dict_ver" ON "sys_dictionary_snapshots" ("dict_id", "version");
