-- ============================================================================
-- Migration 071: API key prefix and onboarding resume state
-- api_keys.key_prefix stores only the first 9 characters of the key (the
-- literal "lp_" plus 6 hex chars) so the UI can tell keys apart. It is NULL for
-- keys created before 1.6 and can never authenticate on its own.
-- user_onboarding gains the server-side resume position (step, organization,
-- project). The FKs use SET NULL so a deleted org or project self-heals.
-- All columns are nullable and additive: no table rewrite.
-- ============================================================================

ALTER TABLE api_keys ADD COLUMN IF NOT EXISTS key_prefix TEXT NULL;

ALTER TABLE user_onboarding ADD COLUMN IF NOT EXISTS onboarding_step TEXT NULL;
ALTER TABLE user_onboarding
  ADD COLUMN IF NOT EXISTS organization_id UUID NULL REFERENCES organizations(id) ON DELETE SET NULL;
ALTER TABLE user_onboarding
  ADD COLUMN IF NOT EXISTS project_id UUID NULL REFERENCES projects(id) ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS idx_user_onboarding_organization
  ON user_onboarding (organization_id);
CREATE INDEX IF NOT EXISTS idx_user_onboarding_project
  ON user_onboarding (project_id);
