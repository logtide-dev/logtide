-- ============================================================================
-- LogWard - Fix incident_history user_id column
-- ============================================================================
-- Migration: 007_fix_incident_history_user_id.sql
-- Created: 2025-12-03
-- Description: Make user_id column nullable in incident_history table
--              This allows triggers to record history even when user context
--              is not available.
-- ============================================================================

-- Make user_id nullable (trigger might not always have user context)
ALTER TABLE incident_history
  ALTER COLUMN user_id DROP NOT NULL;

-- Update comments
COMMENT ON COLUMN incident_history.user_id IS 'User who made the change (nullable - trigger might not find user context)';
