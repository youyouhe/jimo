-- Custom migration: rename lc_business_approvals to business_approvals.
-- The lc_ prefix is reserved for autocode-generated business tables.
-- This is a system framework table (BPM approval tracking) and should
-- live alongside other system tables without the lc_ prefix.
ALTER TABLE lc_business_approvals RENAME TO business_approvals;
ALTER INDEX lc_business_approvals_pkey RENAME TO business_approvals_pkey;
