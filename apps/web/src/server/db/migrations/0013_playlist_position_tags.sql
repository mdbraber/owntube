ALTER TABLE playlist_items ADD COLUMN position INTEGER NOT NULL DEFAULT 0;
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS playlist_tags (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  playlist_id INTEGER NOT NULL REFERENCES playlists(id) ON DELETE CASCADE,
  tag TEXT NOT NULL,
  created_at INTEGER NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS playlist_tags_user_playlist_tag_uidx ON playlist_tags (user_id, playlist_id, tag);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS playlist_tags_user_tag_idx ON playlist_tags (user_id, tag);
