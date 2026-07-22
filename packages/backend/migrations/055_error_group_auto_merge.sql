-- ============================================================================
-- Migration 055: Auto-merge error groups at ingestion
-- Stack fingerprints split one logical error into several groups when the deep
-- stack varies (source maps, async internal frames, different callers). We add a
-- coarser "merge key" (exception type + normalized message + the top application
-- frame) so a new occurrence folds into an existing group instead of creating a
-- duplicate. The key is computed by ONE Postgres function used by the backfill,
-- the trigger, and the runtime fold lookup, so there is no SQL/JS normalization
-- to keep in sync. See docs/superpowers/specs/2026-07-21-error-group-auto-merge-design.md
-- ============================================================================

-- Single source of truth for the merge key. IMMUTABLE so it can be used in a
-- WHERE clause against the merge_key index. Returns NULL when there is no app
-- frame, so library-only errors are never auto-merged. md5 (not a security
-- digest, just an internal grouping key) avoids a pgcrypto dependency.
CREATE OR REPLACE FUNCTION logtide_merge_key(p_type TEXT, p_message TEXT, p_top_frame TEXT)
RETURNS TEXT AS $$
DECLARE
  m TEXT;
BEGIN
  IF p_top_frame IS NULL THEN
    RETURN NULL;
  END IF;

  m := COALESCE(p_message, '');
  -- UUIDs first (they contain hex runs the next step would otherwise match).
  m := regexp_replace(m, '[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}', '<uuid>', 'gi');
  -- Long hex runs (request ids, hashes, addresses).
  m := regexp_replace(m, '\y[0-9a-f]{8,}\y', '<hex>', 'gi');
  m := regexp_replace(m, '[a-z0-9._%+-]+@[a-z0-9.-]+\.[a-z]{2,}', '<email>', 'gi');
  m := regexp_replace(m, '''[^'']*''|"[^"]*"', '<str>', 'g');
  m := regexp_replace(m, '\d+(\.\d+)?', '<n>', 'g');
  m := btrim(regexp_replace(m, '\s+', ' ', 'g'));

  RETURN md5(p_type || E'\n' || m || E'\n' || p_top_frame);
END;
$$ LANGUAGE plpgsql IMMUTABLE;

ALTER TABLE error_groups ADD COLUMN IF NOT EXISTS merge_key TEXT;
CREATE INDEX IF NOT EXISTS idx_error_groups_merge_key ON error_groups (organization_id, merge_key);

-- Raw "file:function" of the first app frame, carried from the app (which has the
-- parsed frames) so the trigger can compute the group's merge key.
ALTER TABLE exceptions ADD COLUMN IF NOT EXISTS top_frame TEXT;

CREATE OR REPLACE FUNCTION update_error_group_on_exception()
RETURNS TRIGGER AS $$
DECLARE
  v_service TEXT;
  v_merge_key TEXT;
BEGIN
  -- Service: prefer the value carried on the exception (works on every storage
  -- engine), fall back to the Postgres logs table (TimescaleDB), then 'unknown'.
  v_service := NEW.service;
  IF v_service IS NULL THEN
    SELECT service INTO v_service
    FROM logs
    WHERE id = NEW.log_id
    LIMIT 1;
  END IF;
  v_service := COALESCE(v_service, 'unknown');

  v_merge_key := logtide_merge_key(NEW.exception_type, NEW.exception_message, NEW.top_frame);

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
    sample_log_id,
    merge_key
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
    ARRAY[v_service],
    NEW.log_id,
    v_merge_key
  )
  ON CONFLICT (organization_id, COALESCE(project_id, '00000000-0000-0000-0000-000000000000'::UUID), fingerprint)
  DO UPDATE SET
    occurrence_count = error_groups.occurrence_count + 1,
    last_seen = NEW.created_at,
    affected_services = (
      SELECT ARRAY(SELECT DISTINCT unnest(array_cat(error_groups.affected_services, ARRAY[v_service])))
    ),
    merge_key = COALESCE(error_groups.merge_key, v_merge_key),
    updated_at = NOW();

  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

-- Backfill existing groups so historical duplicates can fold forward.
UPDATE error_groups g
SET merge_key = logtide_merge_key(g.exception_type, g.exception_message, tf.top_frame)
FROM (
  SELECT
    eg.id AS group_id,
    (
      SELECT sf.file_path || ':' || COALESCE(sf.function_name, '<anonymous>')
      FROM exceptions e
      JOIN stack_frames sf ON sf.exception_id = e.id
      WHERE e.log_id = eg.sample_log_id AND sf.is_app_code = TRUE
      ORDER BY sf.frame_index ASC
      LIMIT 1
    ) AS top_frame
  FROM error_groups eg
) tf
WHERE g.id = tf.group_id;
