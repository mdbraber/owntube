CREATE TABLE IF NOT EXISTS channel_meta (
  channel_id text PRIMARY KEY NOT NULL,
  channel_name text NOT NULL,
  avatar_url text,
  updated_at integer NOT NULL
);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS channel_meta_updated_idx ON channel_meta (updated_at);
