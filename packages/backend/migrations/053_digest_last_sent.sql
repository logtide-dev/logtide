-- ============================================================================
-- Migration 053: Digest dispatch bookkeeping
-- Adds last_sent_at to digest_configs. The hourly digest-dispatch cron uses it
-- as a double-fire guard and operators can see when a digest last went out.
-- ============================================================================

ALTER TABLE digest_configs ADD COLUMN IF NOT EXISTS last_sent_at TIMESTAMPTZ;
