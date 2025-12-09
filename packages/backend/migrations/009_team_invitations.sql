-- ============================================================================
-- Team Member Invitations & Role Management
-- ============================================================================
-- Migration: 005
-- Description: Add support for inviting team members via email tokens
-- and enhanced role management (owner, admin, member)
-- ============================================================================

-- Create invitations table
CREATE TABLE IF NOT EXISTS organization_invitations (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id UUID NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  email VARCHAR(255) NOT NULL,
  role VARCHAR(50) NOT NULL DEFAULT 'member',
  token VARCHAR(255) NOT NULL UNIQUE,
  invited_by UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  expires_at TIMESTAMPTZ NOT NULL,
  accepted_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Indexes for efficient queries
CREATE INDEX IF NOT EXISTS idx_invitations_org ON organization_invitations(organization_id);
CREATE INDEX IF NOT EXISTS idx_invitations_email ON organization_invitations(email);
CREATE INDEX IF NOT EXISTS idx_invitations_token ON organization_invitations(token) WHERE accepted_at IS NULL;
CREATE INDEX IF NOT EXISTS idx_invitations_expires ON organization_invitations(expires_at) WHERE accepted_at IS NULL;

-- Add index for role-based queries on organization_members
CREATE INDEX IF NOT EXISTS idx_organization_members_role ON organization_members(organization_id, role);

-- ============================================================================
-- CLEANUP FUNCTION (Optional - can be run via cron or manual script)
-- ============================================================================
-- Delete expired invitations (older than expiry time)
-- Call this periodically: SELECT cleanup_expired_invitations();

CREATE OR REPLACE FUNCTION cleanup_expired_invitations()
RETURNS INTEGER AS $$
DECLARE
  deleted_count INTEGER;
BEGIN
  DELETE FROM organization_invitations
  WHERE accepted_at IS NULL
    AND expires_at < NOW();

  GET DIAGNOSTICS deleted_count = ROW_COUNT;
  RETURN deleted_count;
END;
$$ LANGUAGE plpgsql;
