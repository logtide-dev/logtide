-- migrations/056_webhook_deliveries_dedup_index.sql
-- Enqueue now looks up an in-flight delivery for the same logical event before
-- creating a new row, so (organization_id, event_type, event_id) is on the hot
-- path of every outbound webhook. The existing indexes cover neither event_type
-- nor event_id.

CREATE INDEX IF NOT EXISTS idx_webhook_deliveries_event_lookup
  ON webhook_deliveries(organization_id, event_type, event_id, created_at DESC);
