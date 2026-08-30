-- Voice replies under posts. The audio itself lives in Telegram, exactly like
-- every other media file in the product; this table only keeps the file id and
-- what is needed to render the player.
--
-- The comment row itself is untouched: post_comments.body carries a CHECK that
-- demands at least one character, so a voice comment stores a short caption
-- describing itself rather than forcing a rebuild of a production table.
CREATE TABLE IF NOT EXISTS post_comment_media (
  comment_id TEXT PRIMARY KEY REFERENCES post_comments(id) ON DELETE CASCADE,
  telegram_file_id TEXT NOT NULL,
  media_type TEXT NOT NULL DEFAULT 'voice' CHECK (media_type IN ('voice')),
  duration_seconds INTEGER,
  file_size_bytes INTEGER,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);
