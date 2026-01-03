-- ============================================================================
-- LogWard - Substring Search Support (pg_trgm)
-- ============================================================================
-- Migration: 013_substring_search.sql
-- Created: 2026-01-03
-- Description: Enable pg_trgm extension for trigram-based substring search
--              and add system settings for search configuration.
-- Issue: https://github.com/logward-dev/logward/issues/68
-- ============================================================================

-- Enable pg_trgm extension for trigram similarity search
-- PREREQUISITE: postgresql-contrib package must be installed on self-hosted PostgreSQL
-- On managed databases (AWS RDS, Azure Database, Google Cloud SQL), pg_trgm is typically available
-- Verify availability: SELECT * FROM pg_available_extensions WHERE name = 'pg_trgm';
CREATE EXTENSION IF NOT EXISTS pg_trgm;

-- ============================================================================
-- TRIGRAM INDEX ON LOGS.MESSAGE
-- ============================================================================
-- This GIN index enables fast substring search using ILIKE or similarity operators
-- The index uses trigram decomposition (3-character sequences) for matching
--
-- Performance impact:
--   - Storage: Adds ~30-50% overhead to message column size
--   - Insert: Slightly slower inserts due to index maintenance
--   - Query: Substring searches 10-50x faster on large datasets
--
-- The index is created with IF NOT EXISTS to be safe for re-runs

CREATE INDEX IF NOT EXISTS idx_logs_message_trgm
  ON logs USING gin (message gin_trgm_ops);

COMMENT ON INDEX idx_logs_message_trgm IS
  'Trigram GIN index for fast substring search using ILIKE. Created for issue #68.';

-- ============================================================================
-- SYSTEM SETTINGS FOR SEARCH CONFIGURATION
-- ============================================================================
-- Add settings to control search behavior (admin-configurable)

INSERT INTO system_settings (key, value, description) VALUES
  ('search.default_mode', '"fulltext"'::jsonb, 'Default search mode: "fulltext" (word-based) or "substring" (anywhere in message)'),
  ('search.substring_indexed', 'true'::jsonb, 'Whether trigram index is enabled for substring search (improves performance)')
ON CONFLICT (key) DO NOTHING;

-- ============================================================================
-- SUMMARY
-- ============================================================================
-- Extension: pg_trgm (trigram matching)
-- New Index: idx_logs_message_trgm (GIN on logs.message)
-- New Settings:
--   - search.default_mode: Default search mode preference
--   - search.substring_indexed: Flag indicating index availability
--
-- Usage:
--   - Substring search: WHERE message ILIKE '%term%' (uses trigram index)
--   - Fulltext search: WHERE to_tsvector('english', message) @@ plainto_tsquery('english', 'term')
-- ============================================================================
