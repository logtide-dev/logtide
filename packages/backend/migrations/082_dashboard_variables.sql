-- ============================================================================
-- Migration 082: Dashboard variables
-- Dashboards (schema v2) can declare selector variables such as $host and
-- $service. Metrics panel filters whose value is "$<name>" take the selected
-- value. The column holds the declared variables as a JSON array.
-- ============================================================================

ALTER TABLE custom_dashboards
  ADD COLUMN IF NOT EXISTS variables JSONB NOT NULL DEFAULT '[]'::jsonb;
