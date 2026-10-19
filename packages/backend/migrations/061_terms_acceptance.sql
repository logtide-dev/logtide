-- ============================================================================
-- Migration 061: Terms and Privacy acceptance
-- Records which version of the Terms of Service / Privacy Policy a user
-- accepted and when. Used only when LOGTIDE_TERMS_URL, LOGTIDE_PRIVACY_URL and
-- LOGTIDE_TERMS_VERSION are all set; otherwise both columns stay NULL.
-- No backfill on purpose: existing users have NULL and are asked once, the
-- first time they use the app after the feature is turned on.
-- ============================================================================

ALTER TABLE users ADD COLUMN IF NOT EXISTS terms_accepted_at TIMESTAMPTZ NULL;
ALTER TABLE users ADD COLUMN IF NOT EXISTS terms_version TEXT NULL;
