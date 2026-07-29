-- Multiple media items belong to one post. Existing single-media posts are backfilled.

CREATE TABLE telegram_post_media (
  id TEXT PRIMARY KEY,
  post_id TEXT NOT NULL REFERENCES telegram_posts(id) ON DELETE CASCADE,
  source_chat_id INTEGER NOT NULL,
  source_message_id INTEGER NOT NULL,
  media_type TEXT NOT NULL CHECK (
    media_type IN ('photo', 'document', 'animation', 'video', 'video_note', 'voice', 'audio')
  ),
  telegram_file_id TEXT NOT NULL,
  thumbnail_telegram_file_id TEXT,
  track_title TEXT,
  track_performer TEXT,
  media_group_id TEXT,
  sort_order INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  UNIQUE(post_id, source_chat_id, source_message_id)
);

CREATE INDEX idx_telegram_post_media_post
  ON telegram_post_media(post_id, sort_order, created_at);

INSERT INTO telegram_post_media (
  id, post_id, source_chat_id, source_message_id, media_type, telegram_file_id,
  thumbnail_telegram_file_id, track_title, track_performer, sort_order, created_at
)
SELECT
  lower(hex(randomblob(4))) || '-' || lower(hex(randomblob(2))) || '-4' ||
  substr(lower(hex(randomblob(2))), 2) || '-a' || substr(lower(hex(randomblob(2))), 2) ||
  '-' || lower(hex(randomblob(6))),
  id, source_chat_id, source_message_id, content_type, media_telegram_file_id,
  media_thumbnail_file_id, track_title, track_performer, 0, created_at
FROM telegram_posts
WHERE media_telegram_file_id IS NOT NULL
  AND source_chat_id IS NOT NULL
  AND source_message_id IS NOT NULL
  AND content_type IN ('photo', 'document', 'animation', 'video', 'video_note', 'voice', 'audio');
