-- Unified in-app notification center with independently configurable Telegram delivery.

ALTER TABLE user_settings
  ADD COLUMN mention_notifications_enabled INTEGER NOT NULL DEFAULT 1
    CHECK (mention_notifications_enabled IN (0, 1));
ALTER TABLE user_settings
  ADD COLUMN comment_notifications_enabled INTEGER NOT NULL DEFAULT 1
    CHECK (comment_notifications_enabled IN (0, 1));

CREATE TABLE user_notifications (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  actor_user_id TEXT REFERENCES users(id) ON DELETE SET NULL,
  kind TEXT NOT NULL CHECK (kind IN ('mention', 'comment', 'message')),
  context TEXT NOT NULL CHECK (context IN ('chat', 'questionnaire', 'post', 'comment')),
  entity_id TEXT,
  message TEXT NOT NULL CHECK (length(message) BETWEEN 1 AND 300),
  open_path TEXT NOT NULL CHECK (length(open_path) BETWEEN 1 AND 300),
  source_key TEXT NOT NULL UNIQUE,
  read_at TEXT,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX idx_user_notifications_inbox
  ON user_notifications(user_id, read_at, created_at DESC);
