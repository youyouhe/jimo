ALTER TABLE "sys_auto_code_packages" ADD COLUMN IF NOT EXISTS "slug" varchar(64);

-- Backfill existing rows: derive slug from name (lowercase, spaces→hyphens, strip non-alnum)
UPDATE "sys_auto_code_packages"
SET "slug" = lower(regexp_replace(regexp_replace(name, '[^a-zA-Z0-9\s-]', '', 'g'), '\s+', '-', 'g'))
WHERE "slug" IS NULL;

-- After backfill make it NOT NULL
ALTER TABLE "sys_auto_code_packages" ALTER COLUMN "slug" SET NOT NULL;
ALTER TABLE "sys_auto_code_packages" ALTER COLUMN "slug" SET DEFAULT '';

CREATE UNIQUE INDEX IF NOT EXISTS "idx_packages_slug_active"
  ON "sys_auto_code_packages" ("slug")
  WHERE "deleted_at" IS NULL;
