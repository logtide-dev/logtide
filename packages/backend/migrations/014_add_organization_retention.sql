-- ============================================================================
-- Migration 014: Add Per-Organization Log Retention
-- ============================================================================
-- This migration adds customizable log retention periods per organization.
--
-- Features:
-- - Each organization can have a custom retention period (1-365 days)
-- - Default is 90 days (matches existing global TimescaleDB policy)
-- - Only admins can modify retention settings
-- - A background worker job handles cleanup based on org retention settings
--
-- Version: 1.0.0
-- Date: 2025-01-09
-- ============================================================================

-- Add retention_days column to organizations table
ALTER TABLE organizations
ADD COLUMN IF NOT EXISTS retention_days INTEGER NOT NULL DEFAULT 90;

-- Add check constraint for valid range (1-365 days)
DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM pg_constraint
        WHERE conname = 'chk_organizations_retention_days_range'
    ) THEN
        ALTER TABLE organizations
        ADD CONSTRAINT chk_organizations_retention_days_range
        CHECK (retention_days >= 1 AND retention_days <= 365);
    END IF;
END $$;

-- Add index for retention worker queries (finds orgs needing cleanup)
CREATE INDEX IF NOT EXISTS idx_organizations_retention_days
ON organizations (retention_days);

-- Add comment for documentation
COMMENT ON COLUMN organizations.retention_days IS
'Number of days to retain logs for this organization (1-365). Default is 90 days.';

-- ============================================================================
-- SUMMARY
-- ============================================================================
--
-- Changes:
--   - Added retention_days column (INTEGER, NOT NULL, DEFAULT 90)
--   - Added check constraint (1-365 days)
--   - Added index for efficient worker queries
--
-- Backward Compatibility:
--   - Existing organizations get default 90 days (no data loss)
--   - Global TimescaleDB 90-day policy remains as safety net
--
-- Notes:
--   - The retention worker runs daily and deletes logs older than org's retention
--   - TimescaleDB's global 90-day policy still applies as maximum
--   - Organizations with retention > 90 days will still have logs deleted at 90 days
--     due to TimescaleDB policy (this can be adjusted if needed)
--
-- ============================================================================
