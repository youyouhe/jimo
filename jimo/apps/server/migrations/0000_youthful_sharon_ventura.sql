CREATE TABLE "sys_users" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"username" varchar(64) NOT NULL,
	"password_hash" varchar(255) NOT NULL,
	"nickname" varchar(64) DEFAULT '' NOT NULL,
	"email" varchar(128),
	"phone" varchar(20),
	"avatar" varchar(512) DEFAULT '',
	"status" smallint DEFAULT 1 NOT NULL,
	"last_login_at" timestamp with time zone,
	"last_login_ip" varchar(45),
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"deleted_at" timestamp with time zone
);
--> statement-breakpoint
CREATE TABLE "sys_jwt_blacklist" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"jti" varchar(128) NOT NULL,
	"expires_at" timestamp with time zone NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "sys_jwt_blacklist_jti_unique" UNIQUE("jti")
);
--> statement-breakpoint
CREATE UNIQUE INDEX "idx_sys_users_username_active" ON "sys_users" USING btree ("username") WHERE "sys_users"."deleted_at" IS NULL;--> statement-breakpoint
CREATE INDEX "idx_sys_users_email_active" ON "sys_users" USING btree ("email") WHERE "sys_users"."deleted_at" IS NULL AND "sys_users"."email" IS NOT NULL;--> statement-breakpoint
CREATE INDEX "idx_sys_users_phone_active" ON "sys_users" USING btree ("phone") WHERE "sys_users"."deleted_at" IS NULL AND "sys_users"."phone" IS NOT NULL;--> statement-breakpoint
CREATE INDEX "idx_sys_users_status_active" ON "sys_users" USING btree ("status") WHERE "sys_users"."deleted_at" IS NULL;--> statement-breakpoint
CREATE INDEX "idx_sys_jwt_blacklist_expires_at" ON "sys_jwt_blacklist" USING btree ("expires_at");