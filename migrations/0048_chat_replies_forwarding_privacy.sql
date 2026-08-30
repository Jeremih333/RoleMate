ALTER TABLE user_settings
  ADD COLUMN hide_forward_author INTEGER NOT NULL DEFAULT 0
    CHECK (hide_forward_author IN (0, 1));

ALTER TABLE conversation_messages
  ADD COLUMN reply_to_message_id TEXT REFERENCES conversation_messages(id);

ALTER TABLE conversation_messages
  ADD COLUMN forwarded_from_message_id TEXT REFERENCES conversation_messages(id);

ALTER TABLE conversation_messages
  ADD COLUMN forwarded_author_user_id TEXT REFERENCES users(id);

CREATE INDEX idx_conversation_messages_reply
  ON conversation_messages(conversation_id, reply_to_message_id);

CREATE INDEX idx_conversation_messages_forward_source
  ON conversation_messages(forwarded_from_message_id);
