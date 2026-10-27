-- ============================================================================
-- Migration 073: Project health
-- Persisted health issues per project, per-project notification settings and
-- the project_health event type for default notification channels.
-- ============================================================================

CREATE TABLE IF NOT EXISTS project_health_issues (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id UUID NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  project_id UUID NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  check_key VARCHAR(40) NOT NULL,
  severity VARCHAR(10) NOT NULL CHECK (severity IN ('critical', 'warning')),
  opened_at TIMESTAMPTZ NOT NULL,
  last_seen_at TIMESTAMPTZ NOT NULL,
  resolved_at TIMESTAMPTZ,
  details JSONB NOT NULL DEFAULT '{}',
  notified_open_at TIMESTAMPTZ,
  notified_resolve_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

-- At most one open issue per project and check
CREATE UNIQUE INDEX IF NOT EXISTS idx_project_health_issues_open
  ON project_health_issues(project_id, check_key) WHERE resolved_at IS NULL;
CREATE INDEX IF NOT EXISTS idx_project_health_issues_org_project
  ON project_health_issues(organization_id, project_id, resolved_at);

CREATE TABLE IF NOT EXISTS project_notification_settings (
  project_id UUID PRIMARY KEY REFERENCES projects(id) ON DELETE CASCADE,
  organization_id UUID NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  health_channel_ids UUID[] NOT NULL DEFAULT '{}',
  silent_minutes INT NOT NULL DEFAULT 60 CHECK (silent_minutes BETWEEN 10 AND 1440),
  mutes JSONB NOT NULL DEFAULT '{}',
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- Allow 'project_health' as a default channel event type
ALTER TABLE organization_default_channels DROP CONSTRAINT IF EXISTS organization_default_channels_event_type_check;
ALTER TABLE organization_default_channels ADD CONSTRAINT organization_default_channels_event_type_check
  CHECK (event_type IN ('incident', 'error', 'sigma', 'alert', 'monitoring', 'project_health'));
