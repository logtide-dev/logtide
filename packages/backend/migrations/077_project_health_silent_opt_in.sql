-- ============================================================================
-- Migration 077: Project health silent check is opt-in
-- A project that sends nothing for a while is not necessarily broken (night,
-- batch jobs, staging, low traffic), so "stopped sending data" no longer runs
-- by default. Projects whose owner already changed the silent threshold keep
-- the check: setting a threshold was an explicit choice. Open silent issues
-- of projects that do not opt in are resolved by the next health pass without
-- a notification.
-- ============================================================================

ALTER TABLE project_notification_settings
  ADD COLUMN IF NOT EXISTS silent_enabled BOOLEAN NOT NULL DEFAULT FALSE;

UPDATE project_notification_settings
SET silent_enabled = TRUE
WHERE silent_minutes <> 60;
