ALTER TABLE conversation_participants ADD COLUMN live_activity TEXT
  CHECK (live_activity IN ('typing', 'recording_voice', 'sending_media'));

ALTER TABLE conversation_participants ADD COLUMN live_activity_expires_at TEXT;

CREATE INDEX idx_conversation_participants_live_activity
  ON conversation_participants(conversation_id, live_activity_expires_at);
