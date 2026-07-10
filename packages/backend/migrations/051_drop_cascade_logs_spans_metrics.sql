-- ============================================================================
-- Migration 051: Drop ON DELETE CASCADE from logs / spans / metrics project FK
-- ============================================================================
-- CAUTION: This migration swaps FK constraints on TimescaleDB hypertables.
-- On large deployments (50M+ rows) the constraint rebuild can take considerable
-- time. Apply during a low-traffic window and verify the query plan beforehand.
--
-- Rationale: with soft-delete in place (migration 050), the projects row is
-- never immediately removed — it stays in the DB throughout the 30-day grace
-- window. The hard-delete purge worker explicitly calls reservoir.purgeProject()
-- (which deletes logs/spans/metrics by project_id) *before* removing the
-- projects row, making the cascade redundant.
-- Dropping it prevents an accidental bulk data-loss if a projects row is
-- ever hard-deleted outside the controlled purge path.
-- ============================================================================

-- logs (TimescaleDB hypertable)
ALTER TABLE logs DROP CONSTRAINT IF EXISTS logs_project_id_fkey;
ALTER TABLE logs ADD CONSTRAINT logs_project_id_fkey
  FOREIGN KEY (project_id) REFERENCES projects(id);

-- spans (TimescaleDB hypertable)
ALTER TABLE spans DROP CONSTRAINT IF EXISTS spans_project_id_fkey;
ALTER TABLE spans ADD CONSTRAINT spans_project_id_fkey
  FOREIGN KEY (project_id) REFERENCES projects(id);

-- metrics (TimescaleDB hypertable)
ALTER TABLE metrics DROP CONSTRAINT IF EXISTS metrics_project_id_fkey;
ALTER TABLE metrics ADD CONSTRAINT metrics_project_id_fkey
  FOREIGN KEY (project_id) REFERENCES projects(id);
