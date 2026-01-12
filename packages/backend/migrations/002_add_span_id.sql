-- ============================================================================
-- LogTide - Add span_id Column for OpenTelemetry Support
-- ============================================================================
-- This migration adds the span_id column to the logs table for trace correlation
-- with OpenTelemetry distributed tracing (Phase 2: OTLP Traces).
--
-- Version: 1.0.0
-- Date: 2025-11-28
-- Related Issue: #2 (OTLP Logs Collector)
-- ============================================================================

-- Add span_id column to logs table
-- span_id is stored as TEXT (16 hex characters = 8 bytes) for OpenTelemetry compatibility
ALTER TABLE logs ADD COLUMN IF NOT EXISTS span_id TEXT;

-- Index for querying logs by span_id
-- Partial index: only index rows where span_id is not null (saves space)
CREATE INDEX IF NOT EXISTS idx_logs_span_id
  ON logs (span_id, time DESC)
  WHERE span_id IS NOT NULL;

-- Composite index for trace correlation queries (trace_id + span_id)
-- Used when querying all logs for a specific span within a trace
CREATE INDEX IF NOT EXISTS idx_logs_trace_span
  ON logs (trace_id, span_id, time DESC)
  WHERE trace_id IS NOT NULL AND span_id IS NOT NULL;
