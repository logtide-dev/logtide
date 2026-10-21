-- ============================================================================
-- Migration 067: PagerDuty notification channel type
-- Widens the channel type check to allow 'pagerduty' (Events API v2 routing key
-- stored in config). Additive, notification_channels is a small table.
-- ============================================================================

ALTER TABLE notification_channels DROP CONSTRAINT IF EXISTS notification_channels_type_check;
ALTER TABLE notification_channels ADD CONSTRAINT notification_channels_type_check
  CHECK (type IN ('email', 'webhook', 'pagerduty'));
