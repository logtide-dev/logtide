-- ============================================================================
-- Migration 057: Digest section toggles
-- Adds sections JSONB to digest_configs: a partial map of section key to
-- boolean, merged over code-side defaults. NULL means all defaults (the five
-- original sections enabled, the ten new ones disabled).
-- ============================================================================

ALTER TABLE digest_configs ADD COLUMN IF NOT EXISTS sections JSONB;
