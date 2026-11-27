-- One message can share several videos: a source memo is unique per
-- (user, source URL, video), not per source URL. 0025 creates the new index
-- (every migration file runs at each start, so it must never recreate the
-- old one); this drops the old one where 0025 already made it.
DROP INDEX IF EXISTS video_memos_user_source_url_uidx;
