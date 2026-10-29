-- W12: status page branding, email subscribers and affected-component links.
-- Additive and idempotent. No hypertable DDL.

CREATE TABLE IF NOT EXISTS status_page_config (
  project_id UUID PRIMARY KEY REFERENCES projects(id) ON DELETE CASCADE,
  organization_id UUID NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  title VARCHAR(120),
  description VARCHAR(500),
  logo_url VARCHAR(2048),
  accent_color VARCHAR(7) CHECK (accent_color ~ '^#[0-9a-fA-F]{6}$'),
  show_monitor_types BOOLEAN NOT NULL DEFAULT FALSE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_status_page_config_org ON status_page_config(organization_id);

CREATE TABLE IF NOT EXISTS status_page_subscribers (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id UUID NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  project_id UUID NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  email VARCHAR(320) NOT NULL,
  email_normalized VARCHAR(320) NOT NULL,
  confirm_token_hash VARCHAR(64),
  confirm_expires_at TIMESTAMPTZ,
  confirmed_at TIMESTAMPTZ,
  last_confirmation_sent_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT status_page_subscribers_project_email_unique UNIQUE (project_id, email_normalized)
);

CREATE INDEX IF NOT EXISTS idx_status_page_subscribers_org ON status_page_subscribers(organization_id);
CREATE INDEX IF NOT EXISTS idx_status_page_subscribers_confirmed
  ON status_page_subscribers(project_id) WHERE confirmed_at IS NOT NULL;

CREATE TABLE IF NOT EXISTS status_incident_monitors (
  incident_id UUID NOT NULL REFERENCES status_incidents(id) ON DELETE CASCADE,
  monitor_id UUID NOT NULL REFERENCES monitors(id) ON DELETE CASCADE,
  PRIMARY KEY (incident_id, monitor_id)
);

CREATE INDEX IF NOT EXISTS idx_status_incident_monitors_monitor ON status_incident_monitors(monitor_id);

CREATE TABLE IF NOT EXISTS maintenance_monitors (
  maintenance_id UUID NOT NULL REFERENCES scheduled_maintenances(id) ON DELETE CASCADE,
  monitor_id UUID NOT NULL REFERENCES monitors(id) ON DELETE CASCADE,
  PRIMARY KEY (maintenance_id, monitor_id)
);

CREATE INDEX IF NOT EXISTS idx_maintenance_monitors_monitor ON maintenance_monitors(monitor_id);

ALTER TABLE status_incidents
  ADD COLUMN IF NOT EXISTS source_incident_id UUID REFERENCES incidents(id) ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS idx_status_incidents_source_incident
  ON status_incidents(source_incident_id) WHERE source_incident_id IS NOT NULL;
