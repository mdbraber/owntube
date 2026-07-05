CREATE TABLE IF NOT EXISTS watch_queue (
  id integer PRIMARY KEY AUTOINCREMENT NOT NULL,
  user_id integer NOT NULL,
  video_id text NOT NULL,
  title text NOT NULL,
  channel_id text,
  position integer NOT NULL,
  added_at integer NOT NULL,
  FOREIGN KEY (user_id) REFERENCES users(id) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS watch_queue_user_video_uidx ON watch_queue (user_id, video_id);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS watch_queue_user_pos_idx ON watch_queue (user_id, position);
