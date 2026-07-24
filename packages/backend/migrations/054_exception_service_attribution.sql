-- ============================================================================
-- Migration 054: Engine-independent service attribution for error groups
-- The error-group trigger resolved a group's affected service with
-- `SELECT service FROM logs WHERE id = NEW.log_id`, but on ClickHouse and
-- MongoDB reservoir backends the ingested logs never land in the Postgres
-- `logs` table, so the lookup always returned NULL and every error group was
-- attributed to 'unknown'. The ingestion path already knows the service, so we
-- carry it on the exception row and have the trigger prefer it, falling back to
-- the logs lookup (TimescaleDB) and only then to 'unknown'.
-- ============================================================================

ALTER TABLE exceptions ADD COLUMN IF NOT EXISTS service TEXT;

CREATE OR REPLACE FUNCTION update_error_group_on_exception()
RETURNS TRIGGER AS $$
DECLARE
  v_service TEXT;
BEGIN
  -- Prefer the service carried on the exception (known at ingestion, works on
  -- every storage engine); fall back to the Postgres logs table (TimescaleDB)
  -- and finally to 'unknown'.
  v_service := NEW.service;

  IF v_service IS NULL THEN
    SELECT service INTO v_service
    FROM logs
    WHERE id = NEW.log_id
    LIMIT 1;
  END IF;

  v_service := COALESCE(v_service, 'unknown');

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
    ARRAY[v_service],
    NEW.log_id
  )
  ON CONFLICT (organization_id, COALESCE(project_id, '00000000-0000-0000-0000-000000000000'::UUID), fingerprint)
  DO UPDATE SET
    occurrence_count = error_groups.occurrence_count + 1,
    last_seen = NEW.created_at,
    affected_services = (
      SELECT ARRAY(SELECT DISTINCT unnest(array_cat(error_groups.affected_services, ARRAY[v_service])))
    ),
    updated_at = NOW();

  RETURN NEW;
END;
$$ LANGUAGE plpgsql;
