CREATE TABLE IF NOT EXISTS shorts_seen (
  id integer PRIMARY KEY AUTOINCREMENT NOT NULL,
  user_id integer NOT NULL,
  video_id text NOT NULL,
  channel_id text NOT NULL,
  seen_at integer NOT NULL,
  FOREIGN KEY (user_id) REFERENCES users(id) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS shorts_seen_user_video_uidx ON shorts_seen (user_id, video_id);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS shorts_seen_user_seen_idx ON shorts_seen (user_id, seen_at);
