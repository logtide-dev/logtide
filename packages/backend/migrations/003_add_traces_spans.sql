-- ============================================================================
-- Migration 003: Add Traces and Spans Tables for OpenTelemetry
-- ============================================================================
-- This migration adds support for distributed tracing via OTLP.
-- - traces: Aggregate trace information (root span, duration, error status)
-- - spans: Individual span records with parent-child relationships
--
-- Version: 1.0.0
-- Date: 2025-11-28
-- ============================================================================

-- ============================================================================
-- TRACES TABLE
-- ============================================================================
-- Stores aggregated trace information.
-- Each trace is identified by a unique trace_id (32-char hex from OTLP).

CREATE TABLE IF NOT EXISTS traces (
  trace_id TEXT NOT NULL,
  organization_id UUID NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  project_id UUID NOT NULL REFERENCES projects(id) ON DELETE CASCADE,

  -- Service info
  service_name TEXT NOT NULL,
  root_service_name TEXT,
  root_operation_name TEXT,

  -- Timing
  start_time TIMESTAMPTZ NOT NULL,
  end_time TIMESTAMPTZ NOT NULL,
  duration_ms INTEGER NOT NULL,

  -- Metadata
  span_count INTEGER NOT NULL DEFAULT 0,
  error BOOLEAN NOT NULL DEFAULT FALSE,

  -- Timestamps
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),

  PRIMARY KEY (trace_id, project_id)
);

-- Indexes for efficient querying
CREATE INDEX IF NOT EXISTS idx_traces_project_time ON traces (project_id, start_time DESC);
CREATE INDEX IF NOT EXISTS idx_traces_service ON traces (service_name, start_time DESC);
CREATE INDEX IF NOT EXISTS idx_traces_error ON traces (error, start_time DESC) WHERE error = TRUE;
CREATE INDEX IF NOT EXISTS idx_traces_duration ON traces (duration_ms DESC);
CREATE INDEX IF NOT EXISTS idx_traces_org ON traces (organization_id, start_time DESC);

-- ============================================================================
-- SPANS TABLE (TimescaleDB Hypertable)
-- ============================================================================
-- Stores individual spans with parent-child relationships.
-- Uses TimescaleDB hypertable for efficient time-series storage.

CREATE TABLE IF NOT EXISTS spans (
  -- Primary identification
  time TIMESTAMPTZ NOT NULL,
  span_id TEXT NOT NULL,
  trace_id TEXT NOT NULL,
  parent_span_id TEXT,

  -- Organization/project context
  organization_id UUID NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  project_id UUID NOT NULL REFERENCES projects(id) ON DELETE CASCADE,

  -- Span details
  service_name TEXT NOT NULL,
  operation_name TEXT NOT NULL,

  -- Timing
  start_time TIMESTAMPTZ NOT NULL,
  end_time TIMESTAMPTZ NOT NULL,
  duration_ms INTEGER NOT NULL,

  -- OpenTelemetry span metadata
  kind TEXT,  -- INTERNAL, SERVER, CLIENT, PRODUCER, CONSUMER
  status_code TEXT,  -- UNSET, OK, ERROR
  status_message TEXT,

  -- Structured data (JSONB for flexibility)
  attributes JSONB,
  events JSONB,
  links JSONB,

  -- Resource attributes (service info, host, etc.)
  resource_attributes JSONB,

  -- Timestamps
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),

  PRIMARY KEY (time, span_id)
);

-- Convert to TimescaleDB hypertable
SELECT create_hypertable('spans', 'time', if_not_exists => TRUE);

-- Indexes for efficient querying
CREATE INDEX IF NOT EXISTS idx_spans_trace_id ON spans (trace_id, time DESC);
CREATE INDEX IF NOT EXISTS idx_spans_parent ON spans (parent_span_id, time DESC) WHERE parent_span_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_spans_project_time ON spans (project_id, time DESC);
CREATE INDEX IF NOT EXISTS idx_spans_service ON spans (service_name, time DESC);
CREATE INDEX IF NOT EXISTS idx_spans_operation ON spans (operation_name, time DESC);
CREATE INDEX IF NOT EXISTS idx_spans_status ON spans (status_code, time DESC) WHERE status_code = 'ERROR';
CREATE INDEX IF NOT EXISTS idx_spans_org ON spans (organization_id, time DESC);

-- Composite index for trace detail queries
CREATE INDEX IF NOT EXISTS idx_spans_trace_service ON spans (trace_id, service_name, start_time);

-- ============================================================================
-- RETENTION POLICY
-- ============================================================================
-- Keep spans for 30 days (configurable via TimescaleDB)

SELECT add_retention_policy('spans', INTERVAL '30 days', if_not_exists => TRUE);

-- ============================================================================
-- COMPRESSION POLICY
-- ============================================================================
-- Enable compression on spans hypertable for storage efficiency

ALTER TABLE spans SET (
  timescaledb.compress,
  timescaledb.compress_segmentby = 'project_id, trace_id',
  timescaledb.compress_orderby = 'time DESC'
);

-- Compress chunks older than 7 days
SELECT add_compression_policy('spans', INTERVAL '7 days', if_not_exists => TRUE);

-- ============================================================================
-- UPDATE LOGS TABLE: trace_id UUID -> TEXT
-- ============================================================================
-- TimescaleDB requires disabling compression before ALTER TABLE on hypertables.

-- Step 1: Remove compression policy
SELECT remove_compression_policy('logs', if_exists => TRUE);

-- Step 2: Decompress all compressed chunks
DO $$
DECLARE
    chunk_full_name TEXT;
BEGIN
    FOR chunk_full_name IN
        SELECT c.chunk_schema || '.' || c.chunk_name
        FROM timescaledb_information.chunks c
        WHERE c.hypertable_name = 'logs'
        AND c.is_compressed = true
    LOOP
        EXECUTE format('SELECT decompress_chunk(%L)', chunk_full_name);
    END LOOP;
END $$;

-- Step 3: Disable compression on the hypertable
ALTER TABLE logs SET (timescaledb.compress = false);

-- Step 4: Drop the existing index
DROP INDEX IF EXISTS idx_logs_trace_id;

-- Step 5: Alter column type from UUID to TEXT
ALTER TABLE logs ALTER COLUMN trace_id TYPE TEXT;

-- Step 6: Recreate the index
CREATE INDEX IF NOT EXISTS idx_logs_trace_id ON logs (trace_id, time DESC) WHERE trace_id IS NOT NULL;

-- Step 7: Re-enable compression with updated settings
ALTER TABLE logs SET (
  timescaledb.compress,
  timescaledb.compress_segmentby = 'project_id',
  timescaledb.compress_orderby = 'time DESC'
);

-- Step 8: Re-add compression policy (compress chunks older than 7 days)
SELECT add_compression_policy('logs', INTERVAL '7 days', if_not_exists => TRUE);

-- ============================================================================
-- SUMMARY
-- ============================================================================
-- New Tables:
--   - traces: Aggregate trace records
--   - spans: Individual span records (hypertable)
--
-- Changes:
--   - logs.trace_id: UUID -> TEXT (for OTLP compatibility)
--
-- Indexes: 14 new indexes
-- Retention: spans - 30 days
-- Compression: spans - after 7 days
-- ============================================================================
