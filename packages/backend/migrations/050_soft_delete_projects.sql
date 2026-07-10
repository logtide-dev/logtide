-- ============================================================================
-- Migration 050: Soft-delete support for projects
-- ============================================================================
-- Adds a deleted_at column so project deletion is reversible during a grace
-- window (default 30 days). A background worker later hard-deletes rows
-- past the grace window (see migration 051 and the purge worker in worker.ts).
--
-- Also replaces hard uniqueness constraints on slug and (org, name) with
-- partial-index variants (WHERE deleted_at IS NULL) so a soft-deleted project
-- no longer "occupies" its name or slug, allowing the same values to be reused
-- for new projects.
-- ============================================================================

-- 1. Add deleted_at column (NULL = active, non-NULL = soft-deleted)
ALTER TABLE projects ADD COLUMN IF NOT EXISTS deleted_at TIMESTAMPTZ NULL;

-- 2. Index to support the purge worker's "find projects past grace window" query
CREATE INDEX IF NOT EXISTS idx_projects_deleted_at
  ON projects (deleted_at)
  WHERE deleted_at IS NOT NULL;

-- 3. Replace the global slug unique index (added in migration 036) with a
--    per-org partial one. Slugs need only be unique within an organization,
--    and soft-deleted projects no longer occupy their slug.
DROP INDEX IF EXISTS idx_projects_slug_unique;
CREATE UNIQUE INDEX IF NOT EXISTS idx_projects_slug_unique
  ON projects (organization_id, slug)
  WHERE deleted_at IS NULL;

-- 4. Replace the (organization_id, name) unique constraint from the original
--    schema with a partial unique index.
ALTER TABLE projects DROP CONSTRAINT IF EXISTS projects_organization_id_name_key;
CREATE UNIQUE INDEX IF NOT EXISTS idx_projects_org_name_unique
  ON projects (organization_id, name)
  WHERE deleted_at IS NULL;
