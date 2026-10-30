-- ============================================================================
-- Migration 074: Project health rollout state
-- project_health_state remembers when the health cron first evaluated a project
-- and when it last saw it receiving data. The silent check only arms once the
-- project was seen receiving, so projects already idle when health checks are
-- introduced never alert. Issues opened on a project's first evaluation are
-- flagged as baseline: visible in the app, never notified.
-- ============================================================================

CREATE TABLE IF NOT EXISTS project_health_state (
  project_id UUID PRIMARY KEY REFERENCES projects(id) ON DELETE CASCADE,
  organization_id UUID NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  first_evaluated_at TIMESTAMPTZ NOT NULL,
  last_receiving_at TIMESTAMPTZ
);

CREATE INDEX IF NOT EXISTS idx_project_health_state_org
  ON project_health_state(organization_id);

ALTER TABLE project_health_issues
  ADD COLUMN IF NOT EXISTS baseline BOOLEAN NOT NULL DEFAULT FALSE;
