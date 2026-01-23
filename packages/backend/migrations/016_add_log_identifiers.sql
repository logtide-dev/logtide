-- ============================================================================
-- Migration: 016_add_log_identifiers
-- Description: Add log_identifiers table for event correlation feature
-- ============================================================================

-- Log identifiers table for event correlation
-- Stores extracted identifiers (request_id, user_id, etc.) for fast correlation queries
CREATE TABLE IF NOT EXISTS log_identifiers (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  log_id UUID NOT NULL,
  log_time TIMESTAMPTZ NOT NULL,
  project_id UUID NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  organization_id UUID NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,

  -- Identifier details
  identifier_type VARCHAR(50) NOT NULL,  -- 'uuid', 'request_id', 'user_id', 'session_id', etc.
  identifier_value TEXT NOT NULL,

  -- Context (where the identifier was found)
  source_field VARCHAR(100) NOT NULL,  -- 'message', 'metadata.request_id', etc.

  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- ============================================================================
-- INDEXES
-- ============================================================================

-- Primary correlation lookup: identifier value -> logs
-- Used when user clicks an identifier to see all related logs
CREATE INDEX IF NOT EXISTS idx_log_identifiers_lookup
  ON log_identifiers (identifier_value, project_id, log_time DESC);

-- Reverse lookup: log -> identifiers
-- Used to display all identifiers for a specific log entry
CREATE INDEX IF NOT EXISTS idx_log_identifiers_log_id
  ON log_identifiers (log_id);

-- Time-based queries and cleanup
CREATE INDEX IF NOT EXISTS idx_log_identifiers_time
  ON log_identifiers (project_id, log_time DESC);

-- Organization-scoped queries (for multi-tenant isolation)
CREATE INDEX IF NOT EXISTS idx_log_identifiers_org
  ON log_identifiers (organization_id, identifier_value);

-- Type-specific queries (e.g., show all user_ids)
CREATE INDEX IF NOT EXISTS idx_log_identifiers_type
  ON log_identifiers (project_id, identifier_type, log_time DESC);

-- ============================================================================
-- CUSTOM IDENTIFIER PATTERNS (per organization)
-- ============================================================================

-- Custom patterns table for organization-specific identifier extraction
CREATE TABLE IF NOT EXISTS identifier_patterns (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id UUID NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,

  -- Pattern configuration
  name VARCHAR(50) NOT NULL,              -- e.g., 'order_id', 'customer_id'
  display_name VARCHAR(100) NOT NULL,     -- e.g., 'Order ID', 'Customer ID'
  description TEXT,                        -- Optional description

  -- Matching configuration
  pattern TEXT NOT NULL,                   -- Regex pattern (e.g., 'ORD-[A-Z0-9]{8}')
  field_names TEXT[] DEFAULT '{}',         -- Field names to match (e.g., {'order_id', 'orderId'})

  -- Behavior
  enabled BOOLEAN NOT NULL DEFAULT true,
  priority INT NOT NULL DEFAULT 100,       -- Lower = higher priority (for pattern ordering)

  -- Metadata
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),

  -- Unique constraint: one pattern name per organization
  CONSTRAINT unique_pattern_name_per_org UNIQUE (organization_id, name)
);

-- Index for loading patterns by organization
CREATE INDEX IF NOT EXISTS idx_identifier_patterns_org
  ON identifier_patterns (organization_id, enabled, priority);

-- ============================================================================
-- DEFAULT PATTERNS (seeded for new organizations)
-- ============================================================================

-- Insert default patterns (will be copied to new orgs or used as fallback)
-- These are inserted into a special 'system' context and can be overridden per-org
