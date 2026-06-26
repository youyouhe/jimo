CREATE TABLE IF NOT EXISTS "bpm_process_definitions" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  "name" varchar(100) NOT NULL,
  "key" varchar(100) NOT NULL,
  "description" text,
  "icon" varchar(50),
  "status" varchar(20) NOT NULL DEFAULT 'draft',
  "category" varchar(50),
  "current_version_id" uuid,
  "deployed_version_id" uuid,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL,
  "updated_at" timestamp with time zone DEFAULT now() NOT NULL,
  "deleted_at" timestamp with time zone
);

CREATE UNIQUE INDEX IF NOT EXISTS "idx_bpm_process_defs_key_active" ON "bpm_process_definitions" ("key") WHERE "deleted_at" IS NULL;

CREATE TABLE IF NOT EXISTS "bpm_process_versions" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  "definition_id" uuid NOT NULL,
  "version" integer NOT NULL,
  "name" varchar(100) NOT NULL,
  "lf_json" jsonb,
  "bpmn_xml" text,
  "change_log" text,
  "is_deployed" boolean DEFAULT false,
  "deployed_at" timestamp with time zone,
  "deployment_id" varchar(100),
  "created_at" timestamp with time zone DEFAULT now() NOT NULL,
  "updated_at" timestamp with time zone DEFAULT now() NOT NULL,
  "deleted_at" timestamp with time zone
);

CREATE INDEX IF NOT EXISTS "idx_bpm_process_vers_def" ON "bpm_process_versions" ("definition_id");
CREATE INDEX IF NOT EXISTS "idx_bpm_process_vers_def_ver" ON "bpm_process_versions" ("definition_id", "version");
