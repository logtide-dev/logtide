-- ============================================================================
-- Migration 064: error group triage (1.6)
-- Additive only. error_groups and exceptions are metadata tables.
--   * assigned_to: who owns the group (SET NULL when the user is deleted)
--   * regressed_at: last time a resolved group reopened on a new occurrence
--   * ignored_until / ignore_until_count / ignored_event_count: snooze until a
--     date or until N more events; the counter is maintained by the parsing job
--   * list and detail indexes
-- The update_error_group_on_exception trigger is not touched.
-- ============================================================================

ALTER TABLE error_groups
  ADD COLUMN IF NOT EXISTS assigned_to UUID NULL REFERENCES users(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS regressed_at TIMESTAMPTZ NULL,
  ADD COLUMN IF NOT EXISTS ignored_until TIMESTAMPTZ NULL,
  ADD COLUMN IF NOT EXISTS ignore_until_count INT NULL,
  ADD COLUMN IF NOT EXISTS ignored_event_count INT NOT NULL DEFAULT 0;

CREATE INDEX IF NOT EXISTS idx_error_groups_org_status_last_seen
  ON error_groups (organization_id, status, last_seen DESC);

CREATE INDEX IF NOT EXISTS idx_error_groups_assigned_to
  ON error_groups (organization_id, assigned_to)
  WHERE assigned_to IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_exceptions_org_fingerprint_created
  ON exceptions (organization_id, fingerprint, created_at DESC, id DESC);
