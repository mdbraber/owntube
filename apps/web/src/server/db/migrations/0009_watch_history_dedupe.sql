-- Collapse duplicate watch_history rows so each (user, video) keeps a single
-- active row. Fold aggregates into the newest surviving row (largest id): the
-- latest timestamp, furthest progress, known length, any completion, and any
-- denormalized title/channel.
UPDATE watch_history
SET
  started_at = (
    SELECT MAX(w2.started_at) FROM watch_history w2
    WHERE w2.user_id = watch_history.user_id
      AND w2.video_id = watch_history.video_id
      AND w2.is_deleted = 0
  ),
  duration_watched = (
    SELECT MAX(w2.duration_watched) FROM watch_history w2
    WHERE w2.user_id = watch_history.user_id
      AND w2.video_id = watch_history.video_id
      AND w2.is_deleted = 0
  ),
  video_duration_seconds = (
    SELECT MAX(w2.video_duration_seconds) FROM watch_history w2
    WHERE w2.user_id = watch_history.user_id
      AND w2.video_id = watch_history.video_id
      AND w2.is_deleted = 0
  ),
  completed = (
    SELECT MAX(w2.completed) FROM watch_history w2
    WHERE w2.user_id = watch_history.user_id
      AND w2.video_id = watch_history.video_id
      AND w2.is_deleted = 0
  ),
  video_title = COALESCE(video_title, (
    SELECT MAX(w2.video_title) FROM watch_history w2
    WHERE w2.user_id = watch_history.user_id
      AND w2.video_id = watch_history.video_id
      AND w2.is_deleted = 0
      AND w2.video_title IS NOT NULL
  )),
  channel_name = COALESCE(channel_name, (
    SELECT MAX(w2.channel_name) FROM watch_history w2
    WHERE w2.user_id = watch_history.user_id
      AND w2.video_id = watch_history.video_id
      AND w2.is_deleted = 0
      AND w2.channel_name IS NOT NULL
  ))
WHERE id IN (
  SELECT MAX(id) FROM watch_history WHERE is_deleted = 0 GROUP BY user_id, video_id
);
--> statement-breakpoint
-- Soft-delete the superseded duplicate rows.
UPDATE watch_history
SET is_deleted = 1
WHERE is_deleted = 0
  AND id NOT IN (
    SELECT MAX(id) FROM watch_history WHERE is_deleted = 0 GROUP BY user_id, video_id
  );
--> statement-breakpoint
-- Enforce one active row per (user, video) from now on.
CREATE UNIQUE INDEX IF NOT EXISTS watch_history_user_video_active_uidx
  ON watch_history (user_id, video_id) WHERE is_deleted = 0;
