-- ============================================================================
-- Migration 072: bound confirmation resends of status page subscribers
-- The public subscribe endpoint mails a confirmation link. These columns let
-- the service cap how many confirmation mails one address gets per window, so
-- a stranger cannot use a status page to flood somebody's mailbox.
-- Additive, with a constant default: no table rewrite.
-- ============================================================================

ALTER TABLE status_page_subscribers
  ADD COLUMN IF NOT EXISTS confirmation_send_count INTEGER NOT NULL DEFAULT 1,
  ADD COLUMN IF NOT EXISTS confirmation_window_started_at TIMESTAMPTZ;
