-- ============================================================================
-- Migration 084: Metric alert no-data streak (1.8)
--
-- Bounded no-data policy for metric alert instances: an instance whose group
-- keeps having no data is resolved (firing) or cleared (pending) once the
-- streak reached both 10 evaluations and 60 minutes.
--   no_data_since        when the current no-data streak started (NULL = data)
--   no_data_evaluations  consecutive evaluations without data
--
-- Additive only, idempotent.
-- ============================================================================

ALTER TABLE alert_metric_instances ADD COLUMN IF NOT EXISTS no_data_since TIMESTAMPTZ NULL;
ALTER TABLE alert_metric_instances ADD COLUMN IF NOT EXISTS no_data_evaluations INTEGER NOT NULL DEFAULT 0;
