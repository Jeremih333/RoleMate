ALTER TABLE user_notifications ADD COLUMN dismissed_at TEXT;
ALTER TABLE conversation_messages ADD COLUMN media_group_id TEXT;

CREATE INDEX IF NOT EXISTS idx_user_notifications_visible
  ON user_notifications(user_id, dismissed_at, created_at DESC);

CREATE TABLE conversation_message_reactions (
  message_id TEXT NOT NULL REFERENCES conversation_messages(id) ON DELETE CASCADE,
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  reaction TEXT NOT NULL CHECK (reaction IN ('heart', 'thumbs_up', 'fire', 'laugh', 'sad')),
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (message_id, user_id)
);

CREATE INDEX idx_conversation_message_reactions_message
  ON conversation_message_reactions(message_id, reaction);

CREATE INDEX idx_conversation_messages_media_group
  ON conversation_messages(conversation_id, media_group_id, created_at);
