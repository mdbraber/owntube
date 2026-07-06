CREATE TABLE IF NOT EXISTS channel_tags (
  id integer PRIMARY KEY AUTOINCREMENT,
  user_id integer NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  channel_id text NOT NULL,
  tag text NOT NULL,
  created_at integer NOT NULL
);

CREATE UNIQUE INDEX IF NOT EXISTS channel_tags_user_channel_tag_uidx
  ON channel_tags (user_id, channel_id, tag);

CREATE INDEX IF NOT EXISTS channel_tags_user_tag_idx
  ON channel_tags (user_id, tag);
