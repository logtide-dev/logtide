-- W12: SSL and DNS monitor types, display fields and last-check detail.
-- Additive and idempotent. No hypertable DDL.

ALTER TABLE monitors DROP CONSTRAINT IF EXISTS monitors_type_check;
ALTER TABLE monitors ADD CONSTRAINT monitors_type_check
  CHECK (type IN ('http', 'tcp', 'heartbeat', 'log_heartbeat', 'ssl', 'dns'));

ALTER TABLE monitors ADD COLUMN IF NOT EXISTS display_name VARCHAR(255);
ALTER TABLE monitors ADD COLUMN IF NOT EXISTS group_name VARCHAR(100);
ALTER TABLE monitors ADD COLUMN IF NOT EXISTS display_order INTEGER NOT NULL DEFAULT 0;
-- ssl: { warnDays }, dns: { recordType, expectedValue? }
ALTER TABLE monitors ADD COLUMN IF NOT EXISTS check_config JSONB;

-- last check detail: ssl { expiresAt, daysRemaining, issuer, subject }, dns { records }
ALTER TABLE monitor_status ADD COLUMN IF NOT EXISTS detail JSONB;
