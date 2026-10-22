-- ============================================================================
-- Migration 066: Sigma rule exceptions, raw YAML and last fired
-- Additive only: one new metadata table plus two nullable columns on
-- sigma_rules. Takes no lock on the log hypertables and does not touch
-- detection_events (only reads it once for the last_fired_at backfill).
--
-- Index finding: the per-rule hits aggregate (hits in the last 7 days) relies
-- on the existing idx_detection_events_rule (sigma_rule_id, time DESC) and
-- idx_detection_events_org_time (organization_id, time DESC) from migration
-- 006. No new index on detection_events is needed.
-- ============================================================================

CREATE TABLE IF NOT EXISTS sigma_rule_exceptions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id UUID NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  sigma_rule_id UUID NOT NULL REFERENCES sigma_rules(id) ON DELETE CASCADE,
  conditions JSONB NOT NULL,
  reason TEXT NULL,
  expires_at TIMESTAMPTZ NULL,
  hit_count BIGINT NOT NULL DEFAULT 0,
  last_hit_at TIMESTAMPTZ NULL,
  created_by UUID NULL REFERENCES users(id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_sigma_rule_exceptions_rule
  ON sigma_rule_exceptions (sigma_rule_id);

CREATE INDEX IF NOT EXISTS idx_sigma_rule_exceptions_org
  ON sigma_rule_exceptions (organization_id);

ALTER TABLE sigma_rules ADD COLUMN IF NOT EXISTS raw_yaml TEXT NULL;
ALTER TABLE sigma_rules ADD COLUMN IF NOT EXISTS last_fired_at TIMESTAMPTZ NULL;

-- One-off backfill from the retained detection_events (writes only the
-- sigma_rules metadata table).
UPDATE sigma_rules sr
SET last_fired_at = x.t
FROM (
  SELECT sigma_rule_id, max(time) AS t
  FROM detection_events
  GROUP BY sigma_rule_id
) x
WHERE x.sigma_rule_id = sr.id
  AND sr.last_fired_at IS NULL;
