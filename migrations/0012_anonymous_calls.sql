CREATE TABLE anonymous_calls (
  id TEXT PRIMARY KEY,
  conversation_id TEXT NOT NULL REFERENCES conversations(id) ON DELETE CASCADE,
  initiated_by_user_id TEXT NOT NULL REFERENCES users(id),
  kind TEXT NOT NULL CHECK (kind IN ('audio', 'video')),
  status TEXT NOT NULL DEFAULT 'ringing'
    CHECK (status IN ('ringing', 'active', 'declined', 'ended', 'missed')),
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  answered_at TEXT,
  ended_at TEXT
);

CREATE TABLE anonymous_call_signals (
  sequence INTEGER PRIMARY KEY AUTOINCREMENT,
  call_id TEXT NOT NULL REFERENCES anonymous_calls(id) ON DELETE CASCADE,
  sender_user_id TEXT NOT NULL REFERENCES users(id),
  type TEXT NOT NULL CHECK (type IN ('offer', 'answer', 'ice')),
  payload TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX idx_anonymous_calls_conversation
  ON anonymous_calls(conversation_id, created_at DESC);

CREATE INDEX idx_anonymous_call_signals_poll
  ON anonymous_call_signals(call_id, sequence);
