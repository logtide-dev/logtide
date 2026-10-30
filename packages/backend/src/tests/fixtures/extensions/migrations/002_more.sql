CREATE TABLE gadgets (
  id serial PRIMARY KEY,
  widget_id integer NOT NULL REFERENCES widgets(id)
);

ALTER TABLE widgets ADD COLUMN created_at timestamptz NOT NULL DEFAULT now();
