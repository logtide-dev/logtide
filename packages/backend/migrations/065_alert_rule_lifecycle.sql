-- ============================================================================
-- Migration 065: Alert rule lifecycle (1.6)
--
-- Gives alert rules a lifecycle (ok / firing, snooze, re-notify) and an
-- optional grammar query on threshold rules:
--   query              grammar text query (threshold rules only)
--   state              'ok' | 'firing'
--   last_triggered_at  start of the current (or latest) firing episode
--   last_evaluated_at  last successful evaluation
--   last_notified_at   last triggered / re-notify notification sent
--   snoozed_until      triggers and re-notifies are suppressed until then
--   renotify_minutes   repeat interval while firing (threshold rules only)
--
-- Additive only. alert_history (hypertable) is READ by the backfill below and
-- never altered. Idempotent: columns use IF NOT EXISTS, constraints are
-- dropped and re-added, and the backfill only touches rows without lifecycle
-- data yet (last_triggered_at IS NULL).
-- ============================================================================

ALTER TABLE alert_rules ADD COLUMN IF NOT EXISTS query TEXT NULL;
ALTER TABLE alert_rules ADD COLUMN IF NOT EXISTS state VARCHAR(10) NOT NULL DEFAULT 'ok';
ALTER TABLE alert_rules ADD COLUMN IF NOT EXISTS last_triggered_at TIMESTAMPTZ NULL;
ALTER TABLE alert_rules ADD COLUMN IF NOT EXISTS last_evaluated_at TIMESTAMPTZ NULL;
ALTER TABLE alert_rules ADD COLUMN IF NOT EXISTS last_notified_at TIMESTAMPTZ NULL;
ALTER TABLE alert_rules ADD COLUMN IF NOT EXISTS snoozed_until TIMESTAMPTZ NULL;
ALTER TABLE alert_rules ADD COLUMN IF NOT EXISTS renotify_minutes INTEGER NULL;

ALTER TABLE alert_rules DROP CONSTRAINT IF EXISTS chk_alert_rules_state;
ALTER TABLE alert_rules
  ADD CONSTRAINT chk_alert_rules_state
  CHECK (state IN ('ok', 'firing'));

ALTER TABLE alert_rules DROP CONSTRAINT IF EXISTS chk_alert_rules_renotify_range;
ALTER TABLE alert_rules
  ADD CONSTRAINT chk_alert_rules_renotify_range
  CHECK (renotify_minutes IS NULL OR renotify_minutes BETWEEN 5 AND 1440);

ALTER TABLE alert_rules DROP CONSTRAINT IF EXISTS chk_alert_rules_threshold_only;
ALTER TABLE alert_rules
  ADD CONSTRAINT chk_alert_rules_threshold_only
  CHECK (alert_type = 'threshold' OR (query IS NULL AND renotify_minutes IS NULL));

-- Backfill from alert_history so a rule that notified shortly before the
-- upgrade and is still breaching does not notify again on the first
-- evaluation: enabled threshold rules whose latest history row falls inside
-- their window start as already firing and notified. Everything else starts
-- ok, keeping the latest trigger time for display.
UPDATE alert_rules r
SET last_triggered_at = h.last_at,
    last_notified_at  = h.last_at,
    state = CASE
      WHEN r.enabled AND r.alert_type = 'threshold'
           AND h.last_at > NOW() - make_interval(mins => r.time_window)
      THEN 'firing' ELSE 'ok' END
FROM (SELECT rule_id, MAX(triggered_at) AS last_at FROM alert_history GROUP BY rule_id) h
WHERE h.rule_id = r.id AND r.last_triggered_at IS NULL;
