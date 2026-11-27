CREATE TABLE IF NOT EXISTS video_memos (
  id integer PRIMARY KEY AUTOINCREMENT NOT NULL,
  user_id integer NOT NULL REFERENCES users(id) ON DELETE cascade,
  video_id text NOT NULL,
  channel_id text,
  text text NOT NULL,
  occurred_at integer NOT NULL,
  created_at integer NOT NULL,
  updated_at integer NOT NULL,
  source_kind text NOT NULL,
  source_url text,
  source_label text,
  source_author text,
  source_workspace text,
  video_title text,
  channel_name text
);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS video_memos_user_video_idx ON video_memos (user_id, video_id);
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS video_memos_user_source_url_uidx ON video_memos (user_id, source_url) WHERE source_url IS NOT NULL;
