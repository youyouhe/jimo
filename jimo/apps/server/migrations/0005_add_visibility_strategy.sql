ALTER TABLE sys_auto_code_histories ADD COLUMN IF NOT EXISTS visibility_strategy varchar(20) DEFAULT 'private';
