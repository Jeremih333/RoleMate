-- Author-owned post editing and a short-lived Telegram media replacement flow.
-- Existing post content is preserved and copied into the Markdown body.

ALTER TABLE telegram_posts ADD COLUMN title TEXT NOT NULL DEFAULT '';
ALTER TABLE telegram_posts ADD COLUMN body_markdown TEXT NOT NULL DEFAULT '';

UPDATE telegram_posts
SET body_markdown = text_preview
WHERE body_markdown = '';

CREATE TABLE telegram_post_edit_sessions (
  user_id TEXT PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
  post_id TEXT NOT NULL REFERENCES telegram_posts(id) ON DELETE CASCADE,
  expires_at TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX idx_telegram_post_edit_sessions_expiry
  ON telegram_post_edit_sessions(expires_at);
