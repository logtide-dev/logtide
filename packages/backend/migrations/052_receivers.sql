-- Inbound webhook receivers (#155): external systems POST events that get
-- normalized into log entries by per-receiver adapters.
CREATE TABLE IF NOT EXISTS receivers (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  project_id UUID NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  adapter_type TEXT NOT NULL CHECK (adapter_type IN ('github', 'uptime', 'generic')),
  token_hash TEXT NOT NULL UNIQUE,
  field_mapping JSONB,
  enabled BOOLEAN NOT NULL DEFAULT true,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  last_received_at TIMESTAMPTZ
);

CREATE INDEX IF NOT EXISTS idx_receivers_project ON receivers(project_id);

-- Recent raw/normalized events per receiver, capped at 100 rows per receiver
-- by the worker (pruneEvents). Powers the "recent events" UI.
CREATE TABLE IF NOT EXISTS receiver_events (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  receiver_id UUID NOT NULL REFERENCES receivers(id) ON DELETE CASCADE,
  status TEXT NOT NULL CHECK (status IN ('pending', 'processed', 'skipped', 'failed')),
  raw_payload JSONB NOT NULL,
  normalized JSONB,
  error TEXT,
  received_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_receiver_events_receiver
  ON receiver_events(receiver_id, received_at DESC);
