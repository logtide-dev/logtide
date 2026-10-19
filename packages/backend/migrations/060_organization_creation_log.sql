-- ============================================================================
-- Migration 060: Organization creation log
-- Append-only record of every organization a user creates as owner through
-- POST /api/v1/organizations. Backs MAX_ORGANIZATION_CREATIONS_PER_USER_PER_MONTH,
-- which stops a user from resetting per-organization monthly quotas by
-- deleting an organization and creating a fresh one.
-- organization_id deliberately has NO foreign key: the organization may be
-- hard-deleted later and the creation must still count.
-- No backfill: the cap only counts creations made after this migration.
-- ============================================================================

CREATE TABLE IF NOT EXISTS organization_creation_log (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  organization_id UUID NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_organization_creation_log_user
  ON organization_creation_log (user_id, created_at);
