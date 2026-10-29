-- Unqualified names: the runner sets search_path to the extension schema.
CREATE TABLE widgets (
  id serial PRIMARY KEY,
  label text NOT NULL
);

INSERT INTO widgets (label) VALUES ('first');
