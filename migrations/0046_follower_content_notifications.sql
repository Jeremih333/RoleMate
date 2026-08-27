CREATE TABLE user_notifications_v2 (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  actor_user_id TEXT REFERENCES users(id) ON DELETE SET NULL,
  kind TEXT NOT NULL CHECK (kind IN ('mention', 'comment', 'message', 'followed_content')),
  context TEXT NOT NULL CHECK (context IN ('chat', 'questionnaire', 'post', 'comment')),
  entity_id TEXT,
  message TEXT NOT NULL CHECK (length(message) BETWEEN 1 AND 300),
  open_path TEXT NOT NULL CHECK (length(open_path) BETWEEN 1 AND 300),
  source_key TEXT NOT NULL UNIQUE,
  read_at TEXT,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  dismissed_at TEXT
);

INSERT INTO user_notifications_v2
  (id, user_id, actor_user_id, kind, context, entity_id, message, open_path,
   source_key, read_at, created_at, dismissed_at)
SELECT id, user_id, actor_user_id, kind, context, entity_id, message, open_path,
       source_key, read_at, created_at, dismissed_at
FROM user_notifications;

DROP TABLE user_notifications;
ALTER TABLE user_notifications_v2 RENAME TO user_notifications;

CREATE INDEX idx_user_notifications_inbox
  ON user_notifications(user_id, read_at, created_at DESC);
CREATE INDEX idx_user_notifications_visible
  ON user_notifications(user_id, dismissed_at, created_at DESC);
