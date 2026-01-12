-- ============================================================================
-- LogTide - SIEM Dashboard & Incident Management Tables
-- ============================================================================
-- Migration: 006_add_siem_tables.sql
-- Created: 2025-12-03
-- Description: Add tables for SIEM dashboard, incident management, and
--              security detection event tracking.
-- ============================================================================

-- ============================================================================
-- DETECTION EVENTS TABLE
-- ============================================================================
-- Tracks every Sigma rule match for analytics and SIEM dashboard
CREATE TABLE IF NOT EXISTS detection_events (
  time TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  id UUID NOT NULL DEFAULT gen_random_uuid(),

  -- References
  organization_id UUID NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  project_id UUID REFERENCES projects(id) ON DELETE CASCADE,
  sigma_rule_id UUID NOT NULL REFERENCES sigma_rules(id) ON DELETE CASCADE,
  log_id UUID NOT NULL,  -- Reference to logs.id (no FK due to hypertable)

  -- Detection metadata
  severity TEXT NOT NULL,  -- critical, high, medium, low, informational
  rule_title TEXT NOT NULL,
  rule_description TEXT,

  -- MITRE ATT&CK mapping
  mitre_tactics TEXT[],
  mitre_techniques TEXT[],

  -- Log context (denormalized for faster queries)
  service VARCHAR(100) NOT NULL,
  log_level VARCHAR(20) NOT NULL,
  log_message TEXT NOT NULL,
  trace_id TEXT,  -- TEXT to match logs.trace_id (OTLP compatibility)

  -- Matched fields (what triggered the detection)
  matched_fields JSONB,  -- { "field_name": "matched_value", ... }

  -- Incident association (nullable, set by auto-grouping job)
  incident_id UUID,  -- Reference to incidents.id (no FK to avoid circular dependency)

  PRIMARY KEY (time, id)
);

-- Convert to TimescaleDB hypertable for time-series analytics
SELECT create_hypertable('detection_events', 'time', if_not_exists => TRUE);

-- Indexes for efficient SIEM dashboard queries
CREATE INDEX IF NOT EXISTS idx_detection_events_org_time ON detection_events (organization_id, time DESC);
CREATE INDEX IF NOT EXISTS idx_detection_events_project_time ON detection_events (project_id, time DESC);
CREATE INDEX IF NOT EXISTS idx_detection_events_rule ON detection_events (sigma_rule_id, time DESC);
CREATE INDEX IF NOT EXISTS idx_detection_events_severity ON detection_events (severity, time DESC);
CREATE INDEX IF NOT EXISTS idx_detection_events_service ON detection_events (service, time DESC);
CREATE INDEX IF NOT EXISTS idx_detection_events_trace_id ON detection_events (trace_id) WHERE trace_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_detection_events_incident ON detection_events (incident_id) WHERE incident_id IS NOT NULL;

-- GIN indexes for array fields (MITRE filtering)
CREATE INDEX IF NOT EXISTS idx_detection_events_mitre_tactics ON detection_events USING GIN (mitre_tactics);
CREATE INDEX IF NOT EXISTS idx_detection_events_mitre_techniques ON detection_events USING GIN (mitre_techniques);

-- Retention policy (keep detection events for 180 days)
SELECT add_retention_policy('detection_events', INTERVAL '180 days', if_not_exists => TRUE);

-- Compression policy (compress after 14 days)
ALTER TABLE detection_events SET (
  timescaledb.compress,
  timescaledb.compress_segmentby = 'organization_id, severity',
  timescaledb.compress_orderby = 'time DESC'
);
SELECT add_compression_policy('detection_events', INTERVAL '14 days', if_not_exists => TRUE);

-- ============================================================================
-- INCIDENTS TABLE
-- ============================================================================
-- Main incident tracking table for security incident management
CREATE TABLE IF NOT EXISTS incidents (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),

  -- References
  organization_id UUID NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  project_id UUID REFERENCES projects(id) ON DELETE CASCADE,

  -- Incident metadata
  title VARCHAR(500) NOT NULL,
  description TEXT,
  severity TEXT NOT NULL,  -- critical, high, medium, low, informational
  status TEXT NOT NULL DEFAULT 'open',  -- open, investigating, resolved, false_positive

  -- Assignment
  assignee_id UUID REFERENCES users(id) ON DELETE SET NULL,

  -- Auto-grouping metadata
  trace_id TEXT,  -- If grouped by trace_id (TEXT to match logs.trace_id)
  time_window_start TIMESTAMPTZ,  -- Start of grouping time window
  time_window_end TIMESTAMPTZ,  -- End of grouping time window

  -- Aggregated stats (denormalized for performance)
  detection_count INTEGER NOT NULL DEFAULT 0,  -- Number of detections in this incident
  affected_services TEXT[],  -- List of services involved
  mitre_tactics TEXT[],  -- All MITRE tactics involved
  mitre_techniques TEXT[],  -- All MITRE techniques involved

  -- Enrichment data (optional)
  ip_reputation JSONB,  -- { "ip": "1.2.3.4", "reputation": "malicious", "source": "AbuseIPDB" }
  geo_data JSONB,  -- { "country": "IT", "city": "Rome", "lat": 41.9, "lon": 12.5 }

  -- Timestamps
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  resolved_at TIMESTAMPTZ,  -- When status changed to resolved

  -- Constraints
  CONSTRAINT valid_status CHECK (status IN ('open', 'investigating', 'resolved', 'false_positive')),
  CONSTRAINT valid_severity CHECK (severity IN ('critical', 'high', 'medium', 'low', 'informational'))
);

-- Indexes
CREATE INDEX IF NOT EXISTS idx_incidents_org ON incidents (organization_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_incidents_project ON incidents (project_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_incidents_status ON incidents (status, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_incidents_severity ON incidents (severity, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_incidents_assignee ON incidents (assignee_id) WHERE assignee_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_incidents_trace_id ON incidents (trace_id) WHERE trace_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_incidents_time_window ON incidents (time_window_start, time_window_end) WHERE time_window_start IS NOT NULL;

-- GIN indexes for array fields
CREATE INDEX IF NOT EXISTS idx_incidents_services ON incidents USING GIN (affected_services);
CREATE INDEX IF NOT EXISTS idx_incidents_mitre_tactics ON incidents USING GIN (mitre_tactics);
CREATE INDEX IF NOT EXISTS idx_incidents_mitre_techniques ON incidents USING GIN (mitre_techniques);

-- ============================================================================
-- INCIDENT_ALERTS TABLE (Link Table)
-- ============================================================================
-- Links incidents to their related alerts (both alert_history and detection_events)
CREATE TABLE IF NOT EXISTS incident_alerts (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  incident_id UUID NOT NULL REFERENCES incidents(id) ON DELETE CASCADE,

  -- Either detection_event or alert_history (one must be set)
  detection_event_id UUID,  -- Reference to detection_events (no FK due to hypertable)
  alert_history_id UUID,  -- Reference to alert_history (no FK due to hypertable)

  -- Metadata
  added_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),

  -- Constraint: at least one ID must be set
  CONSTRAINT at_least_one_alert CHECK (
    detection_event_id IS NOT NULL OR alert_history_id IS NOT NULL
  )
);

-- Indexes
CREATE INDEX IF NOT EXISTS idx_incident_alerts_incident ON incident_alerts (incident_id);
CREATE INDEX IF NOT EXISTS idx_incident_alerts_detection ON incident_alerts (detection_event_id) WHERE detection_event_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_incident_alerts_alert_history ON incident_alerts (alert_history_id) WHERE alert_history_id IS NOT NULL;

-- ============================================================================
-- INCIDENT_COMMENTS TABLE
-- ============================================================================
-- Comment thread for incident collaboration
CREATE TABLE IF NOT EXISTS incident_comments (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  incident_id UUID NOT NULL REFERENCES incidents(id) ON DELETE CASCADE,
  user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,

  -- Comment content
  comment TEXT NOT NULL,

  -- Metadata
  edited BOOLEAN NOT NULL DEFAULT false,
  edited_at TIMESTAMPTZ,

  -- Timestamps
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Indexes
CREATE INDEX IF NOT EXISTS idx_incident_comments_incident ON incident_comments (incident_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_incident_comments_user ON incident_comments (user_id);

-- ============================================================================
-- INCIDENT_HISTORY TABLE (Audit Trail)
-- ============================================================================
-- Tracks all changes to incidents for audit and compliance
CREATE TABLE IF NOT EXISTS incident_history (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  incident_id UUID NOT NULL REFERENCES incidents(id) ON DELETE CASCADE,
  user_id UUID REFERENCES users(id) ON DELETE CASCADE,  -- Nullable: trigger might not find user context

  -- Change tracking
  action TEXT NOT NULL,  -- status_change, assignment_change, severity_change, comment_added, etc.
  field_name TEXT,  -- Field that was changed (status, assignee_id, severity, etc.)
  old_value TEXT,  -- Previous value (JSON serialized if needed)
  new_value TEXT,  -- New value (JSON serialized if needed)

  -- Metadata
  metadata JSONB,  -- Additional context about the change

  -- Timestamp
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Indexes
CREATE INDEX IF NOT EXISTS idx_incident_history_incident ON incident_history (incident_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_incident_history_user ON incident_history (user_id);
CREATE INDEX IF NOT EXISTS idx_incident_history_action ON incident_history (action, created_at DESC);

-- ============================================================================
-- UPDATE DETECTION_EVENTS WITH INCIDENT FK (after incidents table exists)
-- ============================================================================
-- Add foreign key constraint now that incidents table exists
ALTER TABLE detection_events
  ADD CONSTRAINT fk_detection_events_incident
  FOREIGN KEY (incident_id)
  REFERENCES incidents(id)
  ON DELETE SET NULL;

-- ============================================================================
-- TRIGGER: Auto-update incidents.updated_at
-- ============================================================================
CREATE OR REPLACE FUNCTION update_incident_timestamp()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = NOW();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER trigger_incidents_updated_at
  BEFORE UPDATE ON incidents
  FOR EACH ROW
  EXECUTE FUNCTION update_incident_timestamp();

-- ============================================================================
-- TRIGGER: Auto-log incident changes to history
-- ============================================================================
CREATE OR REPLACE FUNCTION log_incident_change()
RETURNS TRIGGER AS $$
BEGIN
  -- Status change
  IF OLD.status IS DISTINCT FROM NEW.status THEN
    INSERT INTO incident_history (incident_id, user_id, action, field_name, old_value, new_value)
    VALUES (NEW.id, COALESCE(NEW.assignee_id, OLD.assignee_id, (SELECT id FROM users WHERE is_admin = true LIMIT 1)),
            'status_change', 'status', OLD.status, NEW.status);
  END IF;

  -- Assignment change
  IF OLD.assignee_id IS DISTINCT FROM NEW.assignee_id THEN
    INSERT INTO incident_history (incident_id, user_id, action, field_name, old_value, new_value)
    VALUES (NEW.id, COALESCE(NEW.assignee_id, OLD.assignee_id, (SELECT id FROM users WHERE is_admin = true LIMIT 1)),
            'assignment_change', 'assignee_id', OLD.assignee_id::TEXT, NEW.assignee_id::TEXT);
  END IF;

  -- Severity change
  IF OLD.severity IS DISTINCT FROM NEW.severity THEN
    INSERT INTO incident_history (incident_id, user_id, action, field_name, old_value, new_value)
    VALUES (NEW.id, COALESCE(NEW.assignee_id, (SELECT id FROM users WHERE is_admin = true LIMIT 1)),
            'severity_change', 'severity', OLD.severity, NEW.severity);
  END IF;

  -- Resolved timestamp
  IF OLD.status != 'resolved' AND NEW.status = 'resolved' THEN
    NEW.resolved_at = NOW();
  END IF;

  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER trigger_log_incident_changes
  BEFORE UPDATE ON incidents
  FOR EACH ROW
  EXECUTE FUNCTION log_incident_change();

-- ============================================================================
-- SUMMARY
-- ============================================================================
-- New Tables:
--   1. detection_events (hypertable) - Sigma rule matches for analytics
--   2. incidents - Main incident tracking
--   3. incident_alerts - Link incidents to alerts/detections
--   4. incident_comments - Comment threads
--   5. incident_history - Audit trail
--
-- New Indexes: ~30
-- New Triggers: 2 (auto-update timestamps, auto-log changes)
-- New Hypertables: 1 (detection_events with compression + retention)
--
-- Features:
--   - TimescaleDB hypertable for detection_events (time-series analytics)
--   - Automatic compression (14 days) and retention (180 days)
--   - MITRE ATT&CK support with GIN indexes
--   - Trace ID correlation
--   - IP reputation and GeoIP enrichment support
--   - Automatic audit trail via triggers
--   - Multi-tenancy (organization + project scoping)
-- ============================================================================
