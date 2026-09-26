CREATE TABLE IF NOT EXISTS websub_pushed (
  video_id text PRIMARY KEY NOT NULL,
  channel_id text NOT NULL,
  deleted integer NOT NULL,
  title text,
  channel_name text,
  published_at integer,
  received_at integer NOT NULL,
  checked_at integer NOT NULL
);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS websub_pushed_channel_idx ON websub_pushed (channel_id);
--> statement-breakpoint
CREATE TRIGGER IF NOT EXISTS feed_dirty_websub_ins AFTER INSERT ON websub_pushed
BEGIN UPDATE feed_publish_state SET dirty_at = unixepoch() WHERE id = 1; END;
--> statement-breakpoint
CREATE TRIGGER IF NOT EXISTS feed_dirty_websub_upd AFTER UPDATE OF deleted, title ON websub_pushed
BEGIN UPDATE feed_publish_state SET dirty_at = unixepoch() WHERE id = 1; END;
