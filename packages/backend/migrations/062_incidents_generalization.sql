-- ============================================================================
-- Migration 062: incidents generalization (1.6)
-- The incidents table becomes the single incident store for every source:
-- sigma (security detections), alert (alert rule firing), monitor (uptime
-- outage) and manual. Additive only:
--   * source gains 'alert'; the check is re-added NOT VALID, like in 034, so
--     the migration never scans or rejects historical rows.
--   * alert_rule_id links an alert incident to its rule (ON DELETE SET NULL:
--     the incident outlives the rule).
--   * acknowledged_at/acknowledged_by and resolved_by record who acted.
--   * last_event_at is the time of the newest event behind the incident
--     (backfilled from time_window_end, else created_at).
--   * Two partial unique indexes make "one active incident per alert rule"
--     and "one active incident per monitor" a database guarantee; the service
--     relies on INSERT ... ON CONFLICT against them.
--
-- The backfill disables user triggers on incidents for its two statements so
-- that updated_at is not bumped (that would flood SSE clients and reorder
-- every list) and so that no history rows are written for it. Disabling
-- triggers takes a short exclusive lock on the table.
--
-- log_incident_change() is replaced. It used to attribute every change to the
-- assignee or, failing that, to (SELECT id FROM users WHERE is_admin = true
-- LIMIT 1): an arbitrary instance admin, possibly of another tenant. The
-- acting user now comes from the transaction-local setting
-- logtide.actor_user_id (empty or unset = no user), and an optional
-- logtide.change_reason is stored as metadata.reason. Both are set with
-- set_config(..., true) so they never leak to other pooled connections.
-- The trigger also keeps the lifecycle fields consistent: resolving stamps
-- resolved_at unless the caller gave one, reopening clears the resolution
-- fields, and going back to open clears the acknowledgement fields.
-- ============================================================================

ALTER TABLE incidents DROP CONSTRAINT IF EXISTS incidents_source_check;
ALTER TABLE incidents ADD CONSTRAINT incidents_source_check
  CHECK (source IN ('sigma', 'alert', 'monitor', 'manual')) NOT VALID;

ALTER TABLE incidents
  ADD COLUMN IF NOT EXISTS alert_rule_id UUID NULL REFERENCES alert_rules(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS acknowledged_at TIMESTAMPTZ NULL,
  ADD COLUMN IF NOT EXISTS acknowledged_by UUID NULL REFERENCES users(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS resolved_by UUID NULL REFERENCES users(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS last_event_at TIMESTAMPTZ NULL;

-- BEGIN F4 BACKFILL
ALTER TABLE incidents DISABLE TRIGGER USER;
UPDATE incidents SET last_event_at = COALESCE(time_window_end, created_at) WHERE last_event_at IS NULL;
-- Defensive: source='monitor' was never written before 1.6, but a duplicate active
-- pair would make the unique index below fail and block startup.
UPDATE incidents i SET status = 'resolved', resolved_at = NOW()
 WHERE i.source = 'monitor' AND i.monitor_id IS NOT NULL AND i.status IN ('open', 'investigating')
   AND EXISTS (SELECT 1 FROM incidents j WHERE j.source = i.source AND j.monitor_id = i.monitor_id
               AND j.status IN ('open', 'investigating') AND j.created_at > i.created_at);
ALTER TABLE incidents ENABLE TRIGGER USER;
-- END F4 BACKFILL

ALTER TABLE incidents ALTER COLUMN last_event_at SET DEFAULT NOW();
ALTER TABLE incidents ALTER COLUMN last_event_at SET NOT NULL;

CREATE INDEX IF NOT EXISTS idx_incidents_org_source_status ON incidents (organization_id, source, status);
CREATE INDEX IF NOT EXISTS idx_incidents_org_last_event ON incidents (organization_id, last_event_at DESC);
CREATE INDEX IF NOT EXISTS idx_incidents_org_updated ON incidents (organization_id, updated_at);
CREATE INDEX IF NOT EXISTS idx_incidents_alert_rule ON incidents (alert_rule_id) WHERE alert_rule_id IS NOT NULL;
CREATE UNIQUE INDEX IF NOT EXISTS uq_incidents_active_alert_rule ON incidents (source, alert_rule_id)
  WHERE alert_rule_id IS NOT NULL AND status IN ('open', 'investigating');
CREATE UNIQUE INDEX IF NOT EXISTS uq_incidents_active_monitor ON incidents (source, monitor_id)
  WHERE monitor_id IS NOT NULL AND status IN ('open', 'investigating');

-- Same trigger (trigger_log_incident_changes, BEFORE UPDATE, from 006) keeps
-- pointing at this function.
CREATE OR REPLACE FUNCTION log_incident_change()
RETURNS TRIGGER AS $$
DECLARE
  actor UUID := NULLIF(current_setting('logtide.actor_user_id', true), '')::uuid;
  reason TEXT := NULLIF(current_setting('logtide.change_reason', true), '');
  meta JSONB := CASE WHEN reason IS NULL THEN NULL ELSE jsonb_build_object('reason', reason) END;
BEGIN
  IF OLD.status IS DISTINCT FROM NEW.status THEN
    INSERT INTO incident_history (incident_id, user_id, action, field_name, old_value, new_value, metadata)
    VALUES (NEW.id, actor, 'status_change', 'status', OLD.status, NEW.status, meta);
  END IF;

  IF OLD.assignee_id IS DISTINCT FROM NEW.assignee_id THEN
    INSERT INTO incident_history (incident_id, user_id, action, field_name, old_value, new_value, metadata)
    VALUES (NEW.id, actor, 'assignment_change', 'assignee_id', OLD.assignee_id::TEXT, NEW.assignee_id::TEXT, meta);
  END IF;

  IF OLD.severity IS DISTINCT FROM NEW.severity THEN
    INSERT INTO incident_history (incident_id, user_id, action, field_name, old_value, new_value, metadata)
    VALUES (NEW.id, actor, 'severity_change', 'severity', OLD.severity, NEW.severity, meta);
  END IF;

  -- Resolving stamps resolved_at unless the caller set one explicitly.
  IF NEW.status = 'resolved' AND OLD.status IS DISTINCT FROM 'resolved'
     AND NEW.resolved_at IS NOT DISTINCT FROM OLD.resolved_at THEN
    NEW.resolved_at = NOW();
  END IF;

  -- An active incident carries no resolution.
  IF NEW.status IN ('open', 'investigating') THEN
    NEW.resolved_at = NULL;
    NEW.resolved_by = NULL;
  END IF;

  -- An open incident is not acknowledged.
  IF NEW.status = 'open' THEN
    NEW.acknowledged_at = NULL;
    NEW.acknowledged_by = NULL;
  END IF;

  RETURN NEW;
END;
$$ LANGUAGE plpgsql;
