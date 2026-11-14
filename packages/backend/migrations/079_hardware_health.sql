-- ============================================================================
-- Migration 079: Hardware health (1.7)
-- Host registry of the hw-agent, the `hardware` incident source and the
-- `hardware` notification event type. Additive only:
--   * hardware_hosts: one row per (project, host.name), registered when a
--     batch of hw.* metrics is ingested, then evaluated by the worker. The
--     snapshot (components, findings, info, collectors) is the last
--     evaluation result. `status` is the effective (debounced) status;
--     pending_status/pending_since hold a change that has not lasted long
--     enough yet. episode_started_at/episode_incident_id track the current
--     degradation episode and its incident, so an incident resolved by hand
--     is not reopened before the host recovers to ok and degrades again.
--   * incidents.source gains 'hardware'; the check is re-added NOT VALID,
--     like in 034 and 062, so the migration never scans historical rows.
--   * incidents.hardware_host_id links a hardware incident to its host
--     (ON DELETE SET NULL: the incident outlives the host). The FK is added
--     NOT VALID: the column is new, so every existing row is NULL anyway.
--   * One active incident per host is a database guarantee, mirroring
--     uq_incidents_active_monitor of 062.
--   * idx_incidents_hardware_host: lookups by host of incidents of any
--     status, and the ON DELETE SET NULL of the FK when a host is deleted.
--   * organization_default_channels accepts the 'hardware' event type; the
--     check is re-added NOT VALID, like the incidents source check.
-- ============================================================================

CREATE TABLE IF NOT EXISTS hardware_hosts (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id UUID NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  project_id UUID NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  host_name TEXT NOT NULL CHECK (char_length(host_name) BETWEEN 1 AND 255),
  status VARCHAR(10) NOT NULL DEFAULT 'unknown'
    CHECK (status IN ('ok', 'warning', 'critical', 'unknown', 'stale')),
  components JSONB NOT NULL DEFAULT '{}',
  findings JSONB NOT NULL DEFAULT '[]',
  info JSONB NOT NULL DEFAULT '{}',
  collectors JSONB NOT NULL DEFAULT '[]',
  is_virtual BOOLEAN NULL,
  muted BOOLEAN NOT NULL DEFAULT false,
  first_seen_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  last_seen_at TIMESTAMPTZ NULL,
  last_evaluated_at TIMESTAMPTZ NULL,
  status_changed_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  pending_status VARCHAR(10) NULL CHECK (pending_status IN ('ok', 'warning', 'critical')),
  pending_since TIMESTAMPTZ NULL,
  episode_started_at TIMESTAMPTZ NULL,
  episode_incident_id UUID NULL REFERENCES incidents(id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT uq_hardware_hosts_project_host UNIQUE (project_id, host_name)
);

CREATE INDEX IF NOT EXISTS idx_hardware_hosts_org ON hardware_hosts (organization_id);
CREATE INDEX IF NOT EXISTS idx_hardware_hosts_project_last_seen ON hardware_hosts (project_id, last_seen_at DESC);

-- Incidents: new source and host link
ALTER TABLE incidents DROP CONSTRAINT IF EXISTS incidents_source_check;
ALTER TABLE incidents ADD CONSTRAINT incidents_source_check
  CHECK (source IN ('sigma', 'alert', 'monitor', 'manual', 'hardware')) NOT VALID;

ALTER TABLE incidents ADD COLUMN IF NOT EXISTS hardware_host_id UUID NULL;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'incidents_hardware_host_id_fkey'
  ) THEN
    ALTER TABLE incidents ADD CONSTRAINT incidents_hardware_host_id_fkey
      FOREIGN KEY (hardware_host_id) REFERENCES hardware_hosts(id) ON DELETE SET NULL NOT VALID;
  END IF;
END $$;

CREATE UNIQUE INDEX IF NOT EXISTS uq_incidents_active_hardware_host ON incidents (source, hardware_host_id)
  WHERE hardware_host_id IS NOT NULL AND status IN ('open', 'investigating');

CREATE INDEX IF NOT EXISTS idx_incidents_hardware_host ON incidents (hardware_host_id)
  WHERE hardware_host_id IS NOT NULL;

-- Allow 'hardware' as a default channel event type
ALTER TABLE organization_default_channels DROP CONSTRAINT IF EXISTS organization_default_channels_event_type_check;
ALTER TABLE organization_default_channels ADD CONSTRAINT organization_default_channels_event_type_check
  CHECK (event_type IN ('incident', 'error', 'sigma', 'alert', 'monitoring', 'project_health', 'hardware')) NOT VALID;
