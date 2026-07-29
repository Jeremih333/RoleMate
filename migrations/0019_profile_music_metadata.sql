-- Preserve Telegram audio metadata so profile music looks like a real track card.
ALTER TABLE profile_media ADD COLUMN track_title TEXT;
ALTER TABLE profile_media ADD COLUMN track_performer TEXT;
ALTER TABLE profile_media ADD COLUMN thumbnail_telegram_file_id TEXT;
