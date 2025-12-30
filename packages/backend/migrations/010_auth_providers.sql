-- Migration: External Authentication Providers (LDAP/OIDC)
-- Description: Add support for external authentication via LDAP and OpenID Connect

-- Make password_hash nullable (OIDC/LDAP users may not have local passwords)
ALTER TABLE users
  ALTER COLUMN password_hash DROP NOT NULL;

-- Auth providers configuration table
-- Stores configuration for each authentication provider (local, OIDC, LDAP)
CREATE TABLE IF NOT EXISTS auth_providers (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  type VARCHAR(50) NOT NULL, -- 'local', 'oidc', 'ldap'
  name VARCHAR(255) NOT NULL, -- Display name (e.g., "Authentik SSO", "Company LDAP")
  slug VARCHAR(255) NOT NULL UNIQUE, -- URL-safe identifier for API routes
  enabled BOOLEAN NOT NULL DEFAULT true,
  is_default BOOLEAN NOT NULL DEFAULT false, -- Show prominently on login page
  display_order INT NOT NULL DEFAULT 0, -- Order on login page
  icon VARCHAR(100), -- Icon identifier (e.g., 'authentik', 'keycloak', 'ldap')
  config JSONB NOT NULL DEFAULT '{}', -- Provider-specific configuration
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Indexes for auth_providers
CREATE INDEX idx_auth_providers_enabled ON auth_providers(enabled);
CREATE INDEX idx_auth_providers_type ON auth_providers(type);

-- User identities table
-- Links users to their external authentication identities (one user can have multiple identities)
CREATE TABLE IF NOT EXISTS user_identities (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  provider_id UUID NOT NULL REFERENCES auth_providers(id) ON DELETE CASCADE,
  provider_user_id VARCHAR(500) NOT NULL, -- External user ID (OIDC 'sub' claim, LDAP DN, email for local)
  metadata JSONB, -- Provider-specific metadata (OIDC claims, LDAP attributes)
  last_login_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE(provider_id, provider_user_id) -- Each external ID can only be linked to one user per provider
);

-- Indexes for user_identities
CREATE INDEX idx_user_identities_user_id ON user_identities(user_id);
CREATE INDEX idx_user_identities_provider_lookup ON user_identities(provider_id, provider_user_id);

-- OIDC state table for CSRF protection during OAuth flows
-- States are short-lived (5 minutes) and cleaned up automatically
CREATE TABLE IF NOT EXISTS oidc_states (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  state VARCHAR(255) NOT NULL UNIQUE,
  nonce VARCHAR(255) NOT NULL,
  code_verifier VARCHAR(128) NOT NULL, -- PKCE code verifier for token exchange
  provider_id UUID NOT NULL REFERENCES auth_providers(id) ON DELETE CASCADE,
  redirect_uri TEXT NOT NULL, -- Where to redirect after successful auth (required for token exchange)
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Index for state lookup and cleanup
CREATE INDEX idx_oidc_states_state ON oidc_states(state);
CREATE INDEX idx_oidc_states_created_at ON oidc_states(created_at);

-- Insert default local auth provider
-- This represents the existing email/password authentication
INSERT INTO auth_providers (type, name, slug, enabled, is_default, display_order, icon, config)
VALUES (
  'local',
  'Email & Password',
  'local',
  true,
  true,
  0,
  'mail',
  '{}'::jsonb
)
ON CONFLICT (slug) DO NOTHING;

-- Migrate existing users to have a local identity
-- This links all existing users to the local provider using their email as provider_user_id
INSERT INTO user_identities (user_id, provider_id, provider_user_id, created_at, updated_at)
SELECT
  u.id,
  (SELECT id FROM auth_providers WHERE slug = 'local'),
  u.email,
  u.created_at,
  NOW()
FROM users u
WHERE NOT EXISTS (
  SELECT 1 FROM user_identities ui
  WHERE ui.user_id = u.id
  AND ui.provider_id = (SELECT id FROM auth_providers WHERE slug = 'local')
);

-- Create function to update updated_at timestamp
CREATE OR REPLACE FUNCTION update_auth_providers_updated_at()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = NOW();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

-- Trigger for auth_providers updated_at
DROP TRIGGER IF EXISTS trigger_auth_providers_updated_at ON auth_providers;
CREATE TRIGGER trigger_auth_providers_updated_at
  BEFORE UPDATE ON auth_providers
  FOR EACH ROW
  EXECUTE FUNCTION update_auth_providers_updated_at();

-- Trigger for user_identities updated_at
DROP TRIGGER IF EXISTS trigger_user_identities_updated_at ON user_identities;
CREATE TRIGGER trigger_user_identities_updated_at
  BEFORE UPDATE ON user_identities
  FOR EACH ROW
  EXECUTE FUNCTION update_auth_providers_updated_at();

-- Comment on tables for documentation
COMMENT ON TABLE auth_providers IS 'Configuration for authentication providers (local, OIDC, LDAP)';
COMMENT ON TABLE user_identities IS 'Links users to their authentication identities across multiple providers';
COMMENT ON TABLE oidc_states IS 'Temporary CSRF protection states for OIDC authentication flows';

COMMENT ON COLUMN auth_providers.type IS 'Provider type: local, oidc, ldap';
COMMENT ON COLUMN auth_providers.slug IS 'URL-safe identifier used in API routes';
COMMENT ON COLUMN auth_providers.config IS 'Provider-specific JSON config (issuer URL, client ID, LDAP bind DN, etc.)';
COMMENT ON COLUMN user_identities.provider_user_id IS 'External user identifier (OIDC sub claim, LDAP DN, email for local)';
COMMENT ON COLUMN user_identities.metadata IS 'Cached provider-specific user data (claims, attributes)';
