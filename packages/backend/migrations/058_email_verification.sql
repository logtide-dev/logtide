-- ============================================================================
-- Migration 058: Optional email verification
-- Adds users.email_verified_at and a single-use token table. Every existing
-- user is backfilled as verified (email_verified_at = created_at) so turning on
-- REQUIRE_EMAIL_VERIFICATION never locks anyone out. The column default is
-- NOW(): every user-creation path (admin, LDAP, bootstrap, local registration
-- with the flag off) counts as verified unless the code explicitly inserts
-- NULL (local registration or an unverified OIDC identity with the flag on).
-- Tokens are stored only as a sha256 hash.
-- ============================================================================

ALTER TABLE users ADD COLUMN IF NOT EXISTS email_verified_at TIMESTAMPTZ NULL;

UPDATE users SET email_verified_at = created_at WHERE email_verified_at IS NULL;

ALTER TABLE users ALTER COLUMN email_verified_at SET DEFAULT NOW();

CREATE TABLE IF NOT EXISTS email_verification_tokens (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  token_hash TEXT NOT NULL UNIQUE,
  expires_at TIMESTAMPTZ NOT NULL,
  used_at TIMESTAMPTZ NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_email_verification_tokens_user
  ON email_verification_tokens (user_id, created_at DESC);
