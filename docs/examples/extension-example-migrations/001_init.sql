-- Runs with search_path set to the extension schema ("example"), so the
-- table below is example.notes. Core tables must be schema-qualified
-- (public.organizations).
CREATE TABLE notes (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  body text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX notes_organization_id_idx ON notes (organization_id);
