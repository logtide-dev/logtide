-- System settings table for runtime configuration
-- These settings can be changed via admin UI without restarting the server

CREATE TABLE IF NOT EXISTS system_settings (
  key VARCHAR(255) PRIMARY KEY,
  value JSONB NOT NULL,
  description TEXT,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_by UUID REFERENCES users(id) ON DELETE SET NULL
);

-- Index for audit queries
CREATE INDEX idx_system_settings_updated_at ON system_settings(updated_at DESC);

-- Auto-update timestamp trigger
CREATE OR REPLACE FUNCTION update_system_settings_updated_at()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = NOW();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER trigger_system_settings_updated_at
  BEFORE UPDATE ON system_settings
  FOR EACH ROW
  EXECUTE FUNCTION update_system_settings_updated_at();

-- Insert default settings
INSERT INTO system_settings (key, value, description) VALUES
  ('auth.signup_enabled', 'true'::jsonb, 'Enable user registration'),
  ('auth.mode', '"standard"'::jsonb, 'Authentication mode: "standard" (normal login) or "none" (auth-free mode)'),
  ('auth.default_user_email', '"admin@logward.local"'::jsonb, 'Default user email for auth-free mode'),
  ('auth.default_user_name', '"Admin"'::jsonb, 'Default user name for auth-free mode')
ON CONFLICT (key) DO NOTHING;

-- Comment for documentation
COMMENT ON TABLE system_settings IS 'System-wide runtime configuration settings manageable via admin UI';
