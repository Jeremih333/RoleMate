-- Preserve the actual Telegram MIME type so animations and document uploads render correctly.
-- Existing rows keep a conservative format hint; legacy animations remain nullable because
-- Telegram may store them as either image/gif or video/mp4.

ALTER TABLE telegram_posts ADD COLUMN media_mime_type TEXT;
ALTER TABLE telegram_post_media ADD COLUMN mime_type TEXT;

UPDATE telegram_posts
SET media_mime_type = CASE content_type
  WHEN 'photo' THEN 'image/jpeg'
  WHEN 'video' THEN 'video/mp4'
  WHEN 'video_note' THEN 'video/mp4'
  WHEN 'audio' THEN 'audio/mpeg'
  WHEN 'voice' THEN 'audio/ogg'
  ELSE NULL
END
WHERE media_telegram_file_id IS NOT NULL AND media_mime_type IS NULL;

UPDATE telegram_post_media
SET mime_type = CASE media_type
  WHEN 'photo' THEN 'image/jpeg'
  WHEN 'video' THEN 'video/mp4'
  WHEN 'video_note' THEN 'video/mp4'
  WHEN 'audio' THEN 'audio/mpeg'
  WHEN 'voice' THEN 'audio/ogg'
  ELSE NULL
END
WHERE mime_type IS NULL;
