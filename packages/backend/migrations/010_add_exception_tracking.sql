-- ============================================================================
-- LogWard - Exception & Stack Trace Tracking Tables
-- ============================================================================
-- Migration: 010_add_exception_tracking.sql
-- Created: 2025-12-22
-- Description: Add tables for exception tracking, stack trace parsing,
--              and error fingerprinting for grouping similar exceptions.
-- ============================================================================

-- ============================================================================
-- EXCEPTIONS TABLE
-- ============================================================================
-- Stores parsed exception metadata for error/critical logs
CREATE TABLE IF NOT EXISTS exceptions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),

  -- References
  organization_id UUID NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  project_id UUID REFERENCES projects(id) ON DELETE CASCADE,
  log_id UUID NOT NULL,  -- Reference to logs.id (no FK due to hypertable)

  -- Exception metadata
  exception_type VARCHAR(255) NOT NULL,  -- e.g., "TypeError", "NullPointerException"
  exception_message TEXT NOT NULL,
  language VARCHAR(50) NOT NULL,  -- nodejs, python, java, go, php

  -- Error fingerprint (for grouping similar exceptions)
  fingerprint VARCHAR(64) NOT NULL,  -- SHA-256 hash of normalized stack trace

  -- Stack trace (raw)
  raw_stack_trace TEXT NOT NULL,

  -- Parsed stack frames count
  frame_count INT NOT NULL DEFAULT 0,

  -- Timestamp
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Unique constraint: one exception per log
CREATE UNIQUE INDEX IF NOT EXISTS idx_exceptions_log_id ON exceptions(log_id);

-- Indexes for efficient queries
CREATE INDEX IF NOT EXISTS idx_exceptions_org_project ON exceptions(organization_id, project_id);
CREATE INDEX IF NOT EXISTS idx_exceptions_fingerprint ON exceptions(fingerprint);
CREATE INDEX IF NOT EXISTS idx_exceptions_created_at ON exceptions(created_at DESC);
CREATE INDEX IF NOT EXISTS idx_exceptions_language ON exceptions(language);
CREATE INDEX IF NOT EXISTS idx_exceptions_type ON exceptions(exception_type);

-- ============================================================================
-- STACK FRAMES TABLE
-- ============================================================================
-- Stores individual stack frames for detailed visualization
CREATE TABLE IF NOT EXISTS stack_frames (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),

  exception_id UUID NOT NULL REFERENCES exceptions(id) ON DELETE CASCADE,

  -- Frame metadata
  frame_index INT NOT NULL,  -- Position in stack (0 = top of stack)
  file_path TEXT NOT NULL,
  function_name TEXT,
  line_number INT,
  column_number INT,

  -- Whether this is application code (vs library/vendor code)
  is_app_code BOOLEAN NOT NULL DEFAULT true,

  -- Code context (optional, for future inline preview)
  code_context JSONB,  -- { "pre": ["line1", "line2"], "line": "error line", "post": ["line3", "line4"] }

  -- Language-specific metadata
  metadata JSONB,  -- e.g., { "package": "express", "class": "Router" }

  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Composite unique constraint: one frame per index per exception
CREATE UNIQUE INDEX IF NOT EXISTS idx_stack_frames_exception_frame ON stack_frames(exception_id, frame_index);

-- Index for querying frames by exception
CREATE INDEX IF NOT EXISTS idx_stack_frames_exception_id ON stack_frames(exception_id);

-- ============================================================================
-- ERROR GROUPS TABLE
-- ============================================================================
-- Groups similar exceptions by fingerprint for dashboard aggregation
CREATE TABLE IF NOT EXISTS error_groups (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),

  organization_id UUID NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  project_id UUID REFERENCES projects(id) ON DELETE CASCADE,

  -- Group identity
  fingerprint VARCHAR(64) NOT NULL,  -- Matches exceptions.fingerprint

  -- Representative exception (first occurrence)
  exception_type VARCHAR(255) NOT NULL,
  exception_message TEXT NOT NULL,
  language VARCHAR(50) NOT NULL,

  -- Aggregated stats
  occurrence_count INT NOT NULL DEFAULT 1,
  first_seen TIMESTAMPTZ NOT NULL,
  last_seen TIMESTAMPTZ NOT NULL,

  -- Status tracking
  status VARCHAR(50) NOT NULL DEFAULT 'open',  -- open, resolved, ignored
  resolved_at TIMESTAMPTZ,
  resolved_by UUID REFERENCES users(id) ON DELETE SET NULL,

  -- Affected services (aggregated from logs)
  affected_services TEXT[] NOT NULL DEFAULT '{}',

  -- Sample log ID for quick access to an example
  sample_log_id UUID,

  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),

  -- Status constraint
  CONSTRAINT error_groups_valid_status CHECK (status IN ('open', 'resolved', 'ignored'))
);

-- Composite unique constraint: one group per fingerprint per organization/project
CREATE UNIQUE INDEX IF NOT EXISTS idx_error_groups_fingerprint_unique
  ON error_groups(organization_id, COALESCE(project_id, '00000000-0000-0000-0000-000000000000'::UUID), fingerprint);

-- Indexes for efficient queries
CREATE INDEX IF NOT EXISTS idx_error_groups_org_project ON error_groups(organization_id, project_id);
CREATE INDEX IF NOT EXISTS idx_error_groups_fingerprint ON error_groups(fingerprint);
CREATE INDEX IF NOT EXISTS idx_error_groups_last_seen ON error_groups(last_seen DESC);
CREATE INDEX IF NOT EXISTS idx_error_groups_status ON error_groups(status);
CREATE INDEX IF NOT EXISTS idx_error_groups_occurrence_count ON error_groups(occurrence_count DESC);
CREATE INDEX IF NOT EXISTS idx_error_groups_language ON error_groups(language);

-- GIN index for affected services array
CREATE INDEX IF NOT EXISTS idx_error_groups_affected_services ON error_groups USING GIN (affected_services);

-- ============================================================================
-- TRIGGER: Auto-update error_groups.updated_at
-- ============================================================================
CREATE OR REPLACE FUNCTION update_error_group_timestamp()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = NOW();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER trigger_error_groups_updated_at
  BEFORE UPDATE ON error_groups
  FOR EACH ROW
  EXECUTE FUNCTION update_error_group_timestamp();

-- ============================================================================
-- TRIGGER: Auto-update error_groups when new exception is inserted
-- ============================================================================
CREATE OR REPLACE FUNCTION update_error_group_on_exception()
RETURNS TRIGGER AS $$
DECLARE
  v_service TEXT;
BEGIN
  -- Get service from the log
  SELECT service INTO v_service
  FROM logs
  WHERE id = NEW.log_id
  LIMIT 1;

  -- Insert or update error group
  INSERT INTO error_groups (
    organization_id,
    project_id,
    fingerprint,
    exception_type,
    exception_message,
    language,
    occurrence_count,
    first_seen,
    last_seen,
    affected_services,
    sample_log_id
  )
  VALUES (
    NEW.organization_id,
    NEW.project_id,
    NEW.fingerprint,
    NEW.exception_type,
    NEW.exception_message,
    NEW.language,
    1,
    NEW.created_at,
    NEW.created_at,
    ARRAY[COALESCE(v_service, 'unknown')],
    NEW.log_id
  )
  ON CONFLICT (organization_id, COALESCE(project_id, '00000000-0000-0000-0000-000000000000'::UUID), fingerprint)
  DO UPDATE SET
    occurrence_count = error_groups.occurrence_count + 1,
    last_seen = NEW.created_at,
    affected_services = (
      SELECT ARRAY(SELECT DISTINCT unnest(array_cat(error_groups.affected_services, ARRAY[COALESCE(v_service, 'unknown')])))
    ),
    updated_at = NOW();

  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER trigger_update_error_group
AFTER INSERT ON exceptions
FOR EACH ROW
EXECUTE FUNCTION update_error_group_on_exception();

-- ============================================================================
-- SUMMARY
-- ============================================================================
-- New Tables:
--   1. exceptions - Parsed exception metadata linked to logs
--   2. stack_frames - Individual stack frames for each exception
--   3. error_groups - Aggregated groups of similar exceptions by fingerprint
--
-- New Indexes: ~15
-- New Triggers: 2 (auto-update timestamps, auto-aggregate error groups)
--
-- Features:
--   - SHA-256 fingerprinting for error grouping (like Sentry)
--   - Multi-language support (nodejs, python, java, go, php)
--   - Stack frame normalization with app code detection
--   - Automatic error group aggregation via trigger
--   - Status workflow (open, resolved, ignored)
--   - Affected services tracking
--   - Multi-tenancy (organization + project scoping)
-- ============================================================================
