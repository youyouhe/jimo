CREATE TABLE "sys_roles" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"name" varchar(64) NOT NULL,
	"code" varchar(64) NOT NULL,
	"description" varchar(255),
	"is_default" smallint DEFAULT 0 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"deleted_at" timestamp with time zone
);
--> statement-breakpoint
CREATE TABLE "sys_user_roles" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid NOT NULL,
	"role_id" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "sys_menus" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"name" varchar(64) NOT NULL,
	"path" varchar(255),
	"component" varchar(255),
	"icon" varchar(64),
	"parent_id" uuid,
	"sort" smallint DEFAULT 0 NOT NULL,
	"is_visible" smallint DEFAULT 1 NOT NULL,
	"permission" varchar(128),
	"menu_type" smallint DEFAULT 1 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"deleted_at" timestamp with time zone
);
--> statement-breakpoint
ALTER TABLE "sys_user_roles" ADD CONSTRAINT "sys_user_roles_user_id_sys_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."sys_users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "sys_user_roles" ADD CONSTRAINT "sys_user_roles_role_id_sys_roles_id_fk" FOREIGN KEY ("role_id") REFERENCES "public"."sys_roles"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "idx_sys_roles_code_active" ON "sys_roles" USING btree ("code") WHERE "sys_roles"."deleted_at" IS NULL;--> statement-breakpoint
CREATE UNIQUE INDEX "idx_sys_user_roles_user_role" ON "sys_user_roles" USING btree ("user_id","role_id");--> statement-breakpoint
CREATE INDEX "idx_sys_menus_parent_id" ON "sys_menus" USING btree ("parent_id");--> statement-breakpoint
CREATE INDEX "idx_sys_menus_active" ON "sys_menus" USING btree ("sort") WHERE "sys_menus"."deleted_at" IS NULL;