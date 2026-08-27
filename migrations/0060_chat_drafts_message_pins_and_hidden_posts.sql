-- Persistent Telegram-like chat drafts, per-user message pins, media captions and feed hides.
-- All user-owned rows are removed automatically when their parent user, chat, message or post is deleted.

CREATE TABLE conversation_drafts (
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  conversation_id TEXT NOT NULL REFERENCES conversations(id) ON DELETE CASCADE,
  encrypted_content TEXT NOT NULL,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (user_id, conversation_id)
);

CREATE INDEX idx_conversation_drafts_updated
  ON conversation_drafts(user_id, updated_at DESC);

CREATE TABLE conversation_message_pins (
  conversation_id TEXT NOT NULL REFERENCES conversations(id) ON DELETE CASCADE,
  message_id TEXT NOT NULL REFERENCES conversation_messages(id) ON DELETE CASCADE,
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  pinned_by_user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  pinned_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (user_id, message_id)
);

CREATE INDEX idx_conversation_message_pins_chat
  ON conversation_message_pins(user_id, conversation_id, pinned_at DESC);

ALTER TABLE conversation_messages
  ADD COLUMN caption_position TEXT
    CHECK (caption_position IS NULL OR caption_position IN ('top', 'bottom'));

CREATE TABLE hidden_posts (
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  post_id TEXT NOT NULL REFERENCES telegram_posts(id) ON DELETE CASCADE,
  hidden_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (user_id, post_id)
);

CREATE INDEX idx_hidden_posts_user
  ON hidden_posts(user_id, hidden_at DESC);
