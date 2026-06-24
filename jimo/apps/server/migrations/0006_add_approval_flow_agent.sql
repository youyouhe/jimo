ALTER TABLE sys_auto_code_histories ADD COLUMN IF NOT EXISTS has_approval_flow boolean DEFAULT false;
ALTER TABLE sys_auto_code_histories ADD COLUMN IF NOT EXISTS has_agent boolean DEFAULT false;
