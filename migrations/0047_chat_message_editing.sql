ALTER TABLE conversation_messages ADD COLUMN edited_at TEXT;
ALTER TABLE conversation_messages ADD COLUMN sort_order INTEGER NOT NULL DEFAULT 0;

CREATE INDEX idx_conversation_messages_media_order
  ON conversation_messages(conversation_id, media_group_id, sort_order, created_at);
