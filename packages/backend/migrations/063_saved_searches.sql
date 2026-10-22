-- ============================================================================
-- Migration 063: saved log searches (1.6)
-- A saved search is a named log explorer state (query, projects, time range,
-- view, columns) owned by an organization. Visibility is either private (only
-- the creator sees it) or organization (every member sees it). The creator
-- may be deleted later: the search stays with created_by set to NULL.
-- Additive only: a new table and two indexes, nothing else is touched.
-- ============================================================================

CREATE TABLE IF NOT EXISTS saved_searches (
  id              UUID         PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id UUID         NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  created_by      UUID         REFERENCES users(id) ON DELETE SET NULL,
  name            VARCHAR(200) NOT NULL,
  visibility      TEXT         NOT NULL DEFAULT 'private' CONSTRAINT saved_searches_visibility_check CHECK (visibility IN ('private', 'organization')),
  state           JSONB        NOT NULL,
  created_at      TIMESTAMPTZ  NOT NULL DEFAULT NOW(),
  updated_at      TIMESTAMPTZ  NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_saved_searches_org ON saved_searches (organization_id, visibility);
CREATE INDEX IF NOT EXISTS idx_saved_searches_created_by ON saved_searches (created_by);
