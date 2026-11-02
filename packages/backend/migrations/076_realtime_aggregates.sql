-- ============================================================================
-- Migration 076: real-time continuous aggregates, refreshed more often
-- ============================================================================
-- The hourly and daily aggregates were materialized-only, refreshed every
-- hour (hourly) or every day (daily) with an end_offset of one bucket. The
-- newest buckets therefore stayed empty for 1 to 3 hours (hourly) or up to
-- 2 days (daily). Readers that used the aggregate alone (metrics overview and
-- rollups, admin timelines) never showed the newest data, and readers that
-- split "aggregate before a cutoff, raw data after" lost the buckets between
-- the last refresh and the cutoff (dashboard charts, today counters, top
-- services).
--
-- Real-time aggregation makes every read complete up to now: the part not
-- materialized yet is computed from the raw table at query time. To keep that
-- part small on large projects, the policies now refresh every 10 minutes
-- (hourly aggregates) and every hour (daily aggregates) with a short
-- end_offset, so only the open bucket is aggregated on the fly.
--
-- Readers that add their own raw tail split at a bucket boundary, so the
-- aggregate and the tail never cover the same rows.

DO $$
DECLARE
  agg record;
BEGIN
  FOR agg IN
    SELECT * FROM (VALUES
      ('logs_hourly_stats',              INTERVAL '3 hours', INTERVAL '10 minutes', INTERVAL '10 minutes'),
      ('spans_hourly_stats',             INTERVAL '3 hours', INTERVAL '10 minutes', INTERVAL '10 minutes'),
      ('metrics_hourly_stats',           INTERVAL '3 hours', INTERVAL '10 minutes', INTERVAL '10 minutes'),
      ('detection_events_hourly_stats',  INTERVAL '6 hours', INTERVAL '10 minutes', INTERVAL '10 minutes'),
      ('logs_daily_stats',               INTERVAL '3 days',  INTERVAL '1 hour',     INTERVAL '1 hour'),
      ('spans_daily_stats',              INTERVAL '3 days',  INTERVAL '1 hour',     INTERVAL '1 hour'),
      ('metrics_daily_stats',            INTERVAL '3 days',  INTERVAL '1 hour',     INTERVAL '1 hour'),
      ('detection_events_daily_stats',   INTERVAL '7 days',  INTERVAL '1 hour',     INTERVAL '1 hour'),
      ('detection_events_rule_stats',    INTERVAL '3 days',  INTERVAL '1 hour',     INTERVAL '1 hour')
    ) AS t(name, start_offset, end_offset, schedule_interval)
  LOOP
    -- Skip aggregates an older or partial install does not have.
    IF NOT EXISTS (
      SELECT 1 FROM timescaledb_information.continuous_aggregates
      WHERE view_name = agg.name AND view_schema = current_schema()
    ) THEN
      CONTINUE;
    END IF;

    EXECUTE format('ALTER MATERIALIZED VIEW %I SET (timescaledb.materialized_only = false)', agg.name);

    PERFORM remove_continuous_aggregate_policy(agg.name::regclass, if_exists => TRUE);
    PERFORM add_continuous_aggregate_policy(agg.name::regclass,
      start_offset => agg.start_offset,
      end_offset => agg.end_offset,
      schedule_interval => agg.schedule_interval);
  END LOOP;
END $$;
