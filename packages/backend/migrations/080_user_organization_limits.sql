-- ============================================================================
-- Migration 080: Per-user organization limits
-- MAX_ORGANIZATIONS_PER_USER and MAX_ORGANIZATION_CREATIONS_PER_USER_PER_MONTH
-- apply to every user of the instance. These columns let an instance
-- administrator raise, lower or lift them for one user.
--   NULL = use the instance setting
--   -1   = no limit for this user
--   n>=0 = this user's limit (0 = may not own/create any organization)
-- ============================================================================

ALTER TABLE users
  ADD COLUMN IF NOT EXISTS max_organizations INTEGER,
  ADD COLUMN IF NOT EXISTS max_organization_creations_per_month INTEGER;

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'users_max_organizations_check') THEN
    ALTER TABLE users
      ADD CONSTRAINT users_max_organizations_check
      CHECK (max_organizations IS NULL OR max_organizations >= -1);
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'users_max_organization_creations_check') THEN
    ALTER TABLE users
      ADD CONSTRAINT users_max_organization_creations_check
      CHECK (max_organization_creations_per_month IS NULL OR max_organization_creations_per_month >= -1);
  END IF;
END $$;
