ALTER TABLE conversation_messages ADD COLUMN delivered_at TEXT;
ALTER TABLE conversation_messages ADD COLUMN read_at TEXT;
ALTER TABLE conversation_participants ADD COLUMN active_in_chat_at TEXT;

UPDATE conversation_messages SET delivered_at = created_at WHERE delivered_at IS NULL;

CREATE INDEX idx_conversation_messages_receipts
  ON conversation_messages(conversation_id, sender_user_id, read_at, created_at);
