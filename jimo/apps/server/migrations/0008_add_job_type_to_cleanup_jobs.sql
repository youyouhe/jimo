ALTER TABLE "sys_cleanup_jobs" ADD COLUMN IF NOT EXISTS "job_type" varchar(50) NOT NULL DEFAULT 'cleanup';
