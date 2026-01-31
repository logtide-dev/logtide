-- ============================================================================
-- DETECTION PACKS TABLE
-- ============================================================================
-- Tracks which detection packs are enabled per organization with custom thresholds

CREATE TABLE IF NOT EXISTS detection_pack_activations (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id UUID NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  pack_id TEXT NOT NULL, -- e.g., 'startup-reliability', 'auth-security'
  enabled BOOLEAN NOT NULL DEFAULT true,
  custom_thresholds JSONB, -- Override thresholds: {"rule-id": {"threshold": 100, "timeWindow": 5}}
  activated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE(organization_id, pack_id)
);

CREATE INDEX IF NOT EXISTS idx_pack_activations_org ON detection_pack_activations(organization_id);
CREATE INDEX IF NOT EXISTS idx_pack_activations_pack ON detection_pack_activations(pack_id);

-- Add index on alert_rules metadata for efficient pack filtering
-- This allows fast queries like: WHERE metadata->>'packId' = 'startup-reliability'
CREATE INDEX IF NOT EXISTS idx_alert_rules_metadata_pack ON alert_rules USING GIN (metadata);
