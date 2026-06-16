CREATE TABLE "sys_params" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"name" varchar(128) NOT NULL,
	"key" varchar(128) NOT NULL,
	"value" text NOT NULL,
	"desc" varchar(256) DEFAULT '',
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"deleted_at" timestamp with time zone
);
--> statement-breakpoint
CREATE TABLE "sys_files" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"name" varchar(255) NOT NULL,
	"url" varchar(512) NOT NULL,
	"key" varchar(512) NOT NULL,
	"tag" varchar(64) DEFAULT '' NOT NULL,
	"ext" varchar(16) DEFAULT '' NOT NULL,
	"size" bigint DEFAULT 0 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"deleted_at" timestamp with time zone
);
--> statement-breakpoint
CREATE TABLE "sys_dictionaries" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"name" varchar(128) NOT NULL,
	"type" varchar(128) NOT NULL,
	"status" smallint DEFAULT 1 NOT NULL,
	"desc" varchar(256),
	"parent_id" uuid,
	"sort" smallint DEFAULT 0 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"deleted_at" timestamp with time zone
);
--> statement-breakpoint
CREATE TABLE "sys_dictionary_details" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"dict_id" uuid NOT NULL,
	"label" varchar(128) NOT NULL,
	"value" varchar(128) NOT NULL,
	"status" smallint DEFAULT 1 NOT NULL,
	"sort" smallint DEFAULT 0 NOT NULL,
	"parent_id" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"deleted_at" timestamp with time zone
);
--> statement-breakpoint
CREATE TABLE "sys_operation_records" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"ip" varchar(45) NOT NULL,
	"method" varchar(10) NOT NULL,
	"path" varchar(512) NOT NULL,
	"status" integer NOT NULL,
	"latency" integer NOT NULL,
	"agent" varchar(512) DEFAULT '' NOT NULL,
	"error_message" text,
	"body" text DEFAULT '' NOT NULL,
	"resp" text DEFAULT '' NOT NULL,
	"user_id" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "sys_apis" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"method" varchar(10) DEFAULT 'GET' NOT NULL,
	"path" varchar(512) NOT NULL,
	"permission" varchar(128),
	"description" varchar(256) DEFAULT '',
	"api_group" varchar(128) DEFAULT 'default',
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"deleted_at" timestamp with time zone
);
--> statement-breakpoint
CREATE TABLE "sys_system_configs" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"key" varchar(128) NOT NULL,
	"value" text NOT NULL,
	"desc" varchar(256) DEFAULT '',
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"deleted_at" timestamp with time zone
);
--> statement-breakpoint
CREATE TABLE "sys_login_logs" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid,
	"username" varchar(64) DEFAULT '' NOT NULL,
	"ip" varchar(45) DEFAULT '' NOT NULL,
	"user_agent" text DEFAULT '',
	"status" smallint DEFAULT 1 NOT NULL,
	"message" varchar(256) DEFAULT '',
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "sys_api_tokens" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"name" varchar(128) NOT NULL,
	"token" varchar(255) NOT NULL,
	"user_id" uuid NOT NULL,
	"expires_at" timestamp with time zone,
	"last_used_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "sys_error" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"level" varchar(10) DEFAULT 'error' NOT NULL,
	"source" varchar(128) DEFAULT '' NOT NULL,
	"message" text DEFAULT '' NOT NULL,
	"stack" text DEFAULT '',
	"solution" text DEFAULT '',
	"status" smallint DEFAULT 0 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "sys_auto_code_histories" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"package_name" varchar(255) DEFAULT '' NOT NULL,
	"table_name" varchar(255) NOT NULL,
	"business_db" varchar(255) DEFAULT '' NOT NULL,
	"templates" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"version" integer DEFAULT 1,
	"fields" jsonb,
	"change_log" text DEFAULT '',
	"operation" varchar(20) DEFAULT 'create',
	"parent_id" uuid
);
--> statement-breakpoint
CREATE TABLE "sys_auto_code_packages" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"name" varchar(255) NOT NULL,
	"description" text DEFAULT '',
	"templates" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"table_name" varchar(255) DEFAULT '',
	"fields" jsonb,
	"generate_web" boolean DEFAULT true,
	"menu_id" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"deleted_at" timestamp with time zone
);
--> statement-breakpoint
CREATE TABLE "sys_export_templates" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"name" varchar(128) NOT NULL,
	"table_name" varchar(128) NOT NULL,
	"template_type" varchar(32) DEFAULT 'json' NOT NULL,
	"config" jsonb,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"deleted_at" timestamp with time zone
);
--> statement-breakpoint
CREATE TABLE "sys_versions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"version_name" varchar(128) NOT NULL,
	"version_number" varchar(32) NOT NULL,
	"description" text,
	"data" jsonb,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"deleted_at" timestamp with time zone
);
--> statement-breakpoint
CREATE TABLE "sys_authority_btns" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"authority_id" uuid NOT NULL,
	"menu_id" uuid NOT NULL,
	"btn_name" varchar(64) NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"deleted_at" timestamp with time zone
);
--> statement-breakpoint
CREATE TABLE "sys_role_menus" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"role_id" uuid NOT NULL,
	"menu_id" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "lc_students" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"student_no" varchar(50) NOT NULL,
	"name" varchar(100) NOT NULL,
	"gender" varchar(64) DEFAULT '',
	"age" integer DEFAULT 0,
	"phone" varchar(20) DEFAULT '',
	"email" varchar(200) DEFAULT '',
	"address" varchar(500) DEFAULT '',
	"enrollment_date" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"deleted_at" timestamp with time zone,
	"created_by" uuid,
	"updated_by" uuid
);
--> statement-breakpoint
CREATE TABLE "lc_encoding_rules" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"name" varchar(100) NOT NULL,
	"prefix" varchar(20),
	"date_format" varchar(20),
	"separator" varchar(4) DEFAULT '' NOT NULL,
	"sequence_digits" integer DEFAULT 4 NOT NULL,
	"padding_char" varchar(1) DEFAULT '0' NOT NULL,
	"reset_cycle" varchar(10) NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"deleted_at" timestamp with time zone
);
--> statement-breakpoint
CREATE TABLE "lc_encoding_rule_sequences" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"rule_id" uuid NOT NULL,
	"period_key" varchar(20) NOT NULL,
	"last_seq" integer DEFAULT 0 NOT NULL,
	CONSTRAINT "uq_lc_encoding_rule_sequences_rule_period" UNIQUE("rule_id","period_key")
);
--> statement-breakpoint
ALTER TABLE "sys_auto_code_packages" ADD CONSTRAINT "sys_auto_code_packages_menu_id_sys_menus_id_fk" FOREIGN KEY ("menu_id") REFERENCES "public"."sys_menus"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "sys_role_menus" ADD CONSTRAINT "sys_role_menus_role_id_sys_roles_id_fk" FOREIGN KEY ("role_id") REFERENCES "public"."sys_roles"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "sys_role_menus" ADD CONSTRAINT "sys_role_menus_menu_id_sys_menus_id_fk" FOREIGN KEY ("menu_id") REFERENCES "public"."sys_menus"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "lc_encoding_rule_sequences" ADD CONSTRAINT "lc_encoding_rule_sequences_rule_id_lc_encoding_rules_id_fk" FOREIGN KEY ("rule_id") REFERENCES "public"."lc_encoding_rules"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "idx_sys_params_key_active" ON "sys_params" USING btree ("key") WHERE "sys_params"."deleted_at" IS NULL;--> statement-breakpoint
CREATE UNIQUE INDEX "idx_sys_files_key_active" ON "sys_files" USING btree ("key") WHERE "sys_files"."deleted_at" IS NULL;--> statement-breakpoint
CREATE INDEX "idx_sys_files_tag_active" ON "sys_files" USING btree ("tag") WHERE "sys_files"."deleted_at" IS NULL;--> statement-breakpoint
CREATE UNIQUE INDEX "idx_sys_dicts_type_active" ON "sys_dictionaries" USING btree ("type") WHERE "sys_dictionaries"."deleted_at" IS NULL;--> statement-breakpoint
CREATE INDEX "idx_sys_dicts_parent_id" ON "sys_dictionaries" USING btree ("parent_id");--> statement-breakpoint
CREATE INDEX "idx_sys_dicts_sort_active" ON "sys_dictionaries" USING btree ("sort") WHERE "sys_dictionaries"."deleted_at" IS NULL;--> statement-breakpoint
CREATE INDEX "idx_sys_dict_details_dict_id_active" ON "sys_dictionary_details" USING btree ("dict_id") WHERE "sys_dictionary_details"."deleted_at" IS NULL;--> statement-breakpoint
CREATE INDEX "idx_sys_dict_details_parent_id" ON "sys_dictionary_details" USING btree ("parent_id");--> statement-breakpoint
CREATE INDEX "idx_sys_dict_details_sort_active" ON "sys_dictionary_details" USING btree ("sort") WHERE "sys_dictionary_details"."deleted_at" IS NULL;--> statement-breakpoint
CREATE INDEX "idx_opr_method" ON "sys_operation_records" USING btree ("method");--> statement-breakpoint
CREATE INDEX "idx_opr_path" ON "sys_operation_records" USING btree ("path");--> statement-breakpoint
CREATE INDEX "idx_opr_status" ON "sys_operation_records" USING btree ("status");--> statement-breakpoint
CREATE INDEX "idx_opr_user_id" ON "sys_operation_records" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX "idx_opr_created_at" ON "sys_operation_records" USING btree ("created_at" DESC NULLS LAST);--> statement-breakpoint
CREATE UNIQUE INDEX "idx_sys_apis_method_path_active" ON "sys_apis" USING btree ("method","path") WHERE "sys_apis"."deleted_at" IS NULL;--> statement-breakpoint
CREATE UNIQUE INDEX "idx_sys_system_configs_key_active" ON "sys_system_configs" USING btree ("key") WHERE "sys_system_configs"."deleted_at" IS NULL;--> statement-breakpoint
CREATE INDEX "idx_sys_login_logs_username" ON "sys_login_logs" USING btree ("username");--> statement-breakpoint
CREATE INDEX "idx_sys_login_logs_status" ON "sys_login_logs" USING btree ("status");--> statement-breakpoint
CREATE INDEX "idx_sys_login_logs_created_at" ON "sys_login_logs" USING btree ("created_at");--> statement-breakpoint
CREATE INDEX "idx_sys_login_logs_user_id" ON "sys_login_logs" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX "idx_sys_api_tokens_token" ON "sys_api_tokens" USING btree ("token");--> statement-breakpoint
CREATE INDEX "idx_sys_api_tokens_user_id" ON "sys_api_tokens" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX "idx_sys_error_level" ON "sys_error" USING btree ("level");--> statement-breakpoint
CREATE INDEX "idx_sys_error_source" ON "sys_error" USING btree ("source");--> statement-breakpoint
CREATE INDEX "idx_sys_error_status" ON "sys_error" USING btree ("status");--> statement-breakpoint
CREATE INDEX "idx_sys_error_created_at" ON "sys_error" USING btree ("created_at");--> statement-breakpoint
CREATE UNIQUE INDEX "idx_sys_export_templates_name_active" ON "sys_export_templates" USING btree ("name") WHERE "sys_export_templates"."deleted_at" IS NULL;--> statement-breakpoint
CREATE UNIQUE INDEX "idx_sys_versions_number_active" ON "sys_versions" USING btree ("version_number") WHERE "sys_versions"."deleted_at" IS NULL;--> statement-breakpoint
CREATE UNIQUE INDEX "idx_sys_authority_btns_unique" ON "sys_authority_btns" USING btree ("authority_id","menu_id","btn_name") WHERE "sys_authority_btns"."deleted_at" IS NULL;--> statement-breakpoint
CREATE INDEX "idx_sys_authority_btns_authority_id" ON "sys_authority_btns" USING btree ("authority_id") WHERE "sys_authority_btns"."deleted_at" IS NULL;--> statement-breakpoint
CREATE INDEX "idx_sys_authority_btns_menu_id" ON "sys_authority_btns" USING btree ("menu_id") WHERE "sys_authority_btns"."deleted_at" IS NULL;--> statement-breakpoint
CREATE UNIQUE INDEX "idx_role_menu_unique" ON "sys_role_menus" USING btree ("role_id","menu_id");--> statement-breakpoint
CREATE UNIQUE INDEX "idx_students_student_no_active" ON "lc_students" USING btree ("student_no") WHERE "lc_students"."deleted_at" IS NULL;--> statement-breakpoint
CREATE UNIQUE INDEX "idx_lc_encoding_rules_name_active" ON "lc_encoding_rules" USING btree ("name") WHERE "lc_encoding_rules"."deleted_at" IS NULL;