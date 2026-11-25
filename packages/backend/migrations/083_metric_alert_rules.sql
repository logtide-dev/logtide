-- ============================================================================
-- Migration 083: Metric alert rules (1.8)
--
-- A third alert rule kind, `metric`, stored with the other alert rules:
--   alert_rules.metric_config   the rule definition (explorer query restricted
--                               to one visible query or formula, condition,
--                               threshold, window, for N evaluations, severity)
--   alert_metric_instances      per-group lifecycle state of a metric rule
--                               (one row per group of the query's group by,
--                               group_key '' when ungrouped)
--   alert_history.metric_metadata  value, labels and unit of the instance a
--                               notification is about
--
-- Additive only: new nullable columns, a new table, and the alert_type /
-- threshold-only constraints widened to accept the new kind (renotify is
-- allowed on metric rules too; the text query stays threshold-only).
-- Idempotent: IF NOT EXISTS everywhere, constraints dropped and re-added.
-- ============================================================================

ALTER TABLE alert_rules ADD COLUMN IF NOT EXISTS metric_config JSONB NULL;

ALTER TABLE alert_rules DROP CONSTRAINT IF EXISTS chk_alert_type;
ALTER TABLE alert_rules
  ADD CONSTRAINT chk_alert_type
  CHECK (alert_type IN ('threshold', 'rate_of_change', 'metric'));

ALTER TABLE alert_rules DROP CONSTRAINT IF EXISTS chk_alert_rules_threshold_only;
ALTER TABLE alert_rules
  ADD CONSTRAINT chk_alert_rules_threshold_only
  CHECK (
    (alert_type = 'threshold' OR query IS NULL)
    AND (alert_type IN ('threshold', 'metric') OR renotify_minutes IS NULL)
  );

ALTER TABLE alert_rules DROP CONSTRAINT IF EXISTS chk_alert_rules_metric_config;
ALTER TABLE alert_rules
  ADD CONSTRAINT chk_alert_rules_metric_config
  CHECK ((alert_type = 'metric') = (metric_config IS NOT NULL));

CREATE TABLE IF NOT EXISTS alert_metric_instances (
  rule_id UUID NOT NULL REFERENCES alert_rules(id) ON DELETE CASCADE,
  organization_id UUID NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  -- Sorted "key=value" pairs of the group labels joined with a newline; '' when ungrouped.
  group_key TEXT NOT NULL,
  labels JSONB NOT NULL DEFAULT '{}'::jsonb,
  state VARCHAR(10) NOT NULL DEFAULT 'ok',
  -- Consecutive breaching evaluations (the rule fires at for_evaluations).
  consecutive_breaches INTEGER NOT NULL DEFAULT 0,
  last_value DOUBLE PRECISION NULL,
  last_triggered_at TIMESTAMPTZ NULL,
  last_notified_at TIMESTAMPTZ NULL,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  PRIMARY KEY (rule_id, group_key),
  CONSTRAINT chk_alert_metric_instances_state CHECK (state IN ('ok', 'firing'))
);

CREATE INDEX IF NOT EXISTS idx_alert_metric_instances_org
  ON alert_metric_instances (organization_id);

ALTER TABLE alert_history ADD COLUMN IF NOT EXISTS metric_metadata JSONB NULL;
