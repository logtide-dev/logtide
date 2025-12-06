-- Add enabled field to sigma_rules table
-- This allows users to enable/disable Sigma rules for detection

ALTER TABLE sigma_rules ADD COLUMN IF NOT EXISTS enabled BOOLEAN NOT NULL DEFAULT true;

-- Create index for faster filtering of enabled rules
CREATE INDEX IF NOT EXISTS idx_sigma_rules_enabled ON sigma_rules(organization_id, enabled) WHERE enabled = true;

-- Update existing rules to be enabled by default
UPDATE sigma_rules SET enabled = true WHERE enabled IS NULL;
