-- ============================================================================
-- Migration 081: Metric catalog (1.8)
-- Metadata of every metric a project sends (type, unit, description, first and
-- last seen), kept in Postgres whatever the storage engine. Written by the
-- metrics ingest path (throttled, fire-and-forget), read by the Metrics
-- catalog and the query service (unit lookup). Additive only.
-- ============================================================================

CREATE TABLE IF NOT EXISTS metric_catalog (
  project_id uuid NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  metric_name text NOT NULL,
  metric_type text NOT NULL,
  unit text,
  description text,
  is_monotonic boolean,
  -- OTLP aggregation temporality of sums and histograms: cumulative | delta | null
  temporality text,
  first_seen_at timestamptz NOT NULL,
  last_seen_at timestamptz NOT NULL,
  PRIMARY KEY (project_id, metric_name, metric_type)
);

CREATE INDEX IF NOT EXISTS idx_metric_catalog_project_last_seen
  ON metric_catalog (project_id, last_seen_at DESC);
