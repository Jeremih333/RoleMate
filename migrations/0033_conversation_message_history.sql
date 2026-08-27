ALTER TABLE conversation_participants ADD COLUMN hidden_at TEXT;

CREATE TABLE conversation_messages (
  id TEXT PRIMARY KEY,
  conversation_id TEXT NOT NULL REFERENCES conversations(id) ON DELETE CASCADE,
  sender_user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  message_type TEXT NOT NULL CHECK (
    message_type IN (
      'text', 'photo', 'animation', 'video', 'audio', 'voice',
      'video_note', 'profile', 'scenario', 'sticker', 'document'
    )
  ),
  encrypted_content TEXT,
  telegram_file_id TEXT,
  mime_type TEXT,
  file_name TEXT,
  telegram_message_id INTEGER,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  deleted_at TEXT,
  CHECK (
    (message_type IN ('text', 'profile', 'scenario') AND encrypted_content IS NOT NULL)
    OR message_type NOT IN ('text', 'profile', 'scenario')
  )
);

CREATE INDEX idx_conversation_messages_history
  ON conversation_messages(conversation_id, created_at DESC, id DESC);

CREATE INDEX idx_conversation_messages_sender
  ON conversation_messages(sender_user_id, created_at DESC);
