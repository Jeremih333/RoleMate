CREATE TABLE conversation_message_reactions_v2 (
  message_id TEXT NOT NULL REFERENCES conversation_messages(id) ON DELETE CASCADE,
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  reaction TEXT NOT NULL CHECK (length(reaction) BETWEEN 1 AND 16),
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (message_id, user_id)
);

INSERT INTO conversation_message_reactions_v2
  (message_id, user_id, reaction, created_at, updated_at)
SELECT message_id, user_id, reaction, created_at, updated_at
FROM conversation_message_reactions;

DROP TABLE conversation_message_reactions;
ALTER TABLE conversation_message_reactions_v2 RENAME TO conversation_message_reactions;

CREATE INDEX idx_conversation_message_reactions_message
  ON conversation_message_reactions(message_id, reaction);
