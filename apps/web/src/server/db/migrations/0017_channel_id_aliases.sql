CREATE TABLE IF NOT EXISTS channel_id_aliases (
  alias text PRIMARY KEY NOT NULL,
  channel_id text NOT NULL,
  updated_at integer NOT NULL
);
