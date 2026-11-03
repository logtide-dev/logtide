-- ============================================================================
-- Migration 075: per-minute log volume for the Logs explorer
-- ============================================================================
-- The explorer histogram and count scanned every log of the range (6 s for
-- 5 million logs). For filters made only of project, level and service they
-- now read this aggregate for the whole minutes of the last 30 days and the
-- raw table only for the edges, the newest minutes and anything older (see
-- modules/query/log-volume.ts).
--
-- Correctness rests on the refresh window: the policy refreshes the last 30
-- days every minute, and a refresh re-materializes only the ranges with
-- changes (new or late logs, retention deletes), so inside that window the
-- aggregate matches the logs table. Older ranges are never read from here.
--
-- WITH NO DATA: the first policy run materializes the window in the
-- background; until then reads fall back to real-time aggregation (the same
-- cost as before, never wrong results).

CREATE MATERIALIZED VIEW IF NOT EXISTS logs_minute_stats
WITH (timescaledb.continuous, timescaledb.materialized_only = false) AS
SELECT
  time_bucket('1 minute', time) AS bucket,
  project_id,
  level,
  service,
  COUNT(*) AS log_count
FROM logs
GROUP BY bucket, project_id, level, service
WITH NO DATA;

SELECT add_continuous_aggregate_policy('logs_minute_stats',
  start_offset => INTERVAL '30 days',
  end_offset => INTERVAL '1 minute',
  schedule_interval => INTERVAL '1 minute',
  if_not_exists => TRUE
);

CREATE INDEX IF NOT EXISTS idx_logs_minute_stats_project_bucket
  ON logs_minute_stats (project_id, bucket DESC);
