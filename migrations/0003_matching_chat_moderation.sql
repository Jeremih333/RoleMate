CREATE TABLE swipes (
  id TEXT PRIMARY KEY,
  actor_user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  target_user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  action TEXT NOT NULL CHECK (action IN ('like', 'skip', 'super_like', 'rewind')),
  source TEXT NOT NULL CHECK (source IN ('bot', 'miniapp')),
  idempotency_key TEXT NOT NULL UNIQUE,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CHECK(actor_user_id <> target_user_id)
);

CREATE UNIQUE INDEX idx_swipes_latest_action
  ON swipes(actor_user_id, target_user_id, action, date(created_at));

CREATE TABLE matches (
  id TEXT PRIMARY KEY,
  user_a_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  user_b_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  status TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'declined', 'closed')),
  matched_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  closed_at TEXT,
  closed_by_user_id TEXT REFERENCES users(id),
  close_reason TEXT,
  CHECK(user_a_id < user_b_id),
  UNIQUE(user_a_id, user_b_id)
);

CREATE TABLE conversations (
  id TEXT PRIMARY KEY,
  match_id TEXT NOT NULL UNIQUE REFERENCES matches(id) ON DELETE CASCADE,
  status TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'paused', 'closed')),
  contact_reveal_status TEXT NOT NULL DEFAULT 'private',
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  last_message_at TEXT,
  closed_at TEXT
);

CREATE TABLE conversation_participants (
  conversation_id TEXT NOT NULL REFERENCES conversations(id) ON DELETE CASCADE,
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  anonymous_alias TEXT NOT NULL,
  is_muted INTEGER NOT NULL DEFAULT 0,
  is_blocked INTEGER NOT NULL DEFAULT 0,
  contact_reveal_requested INTEGER NOT NULL DEFAULT 0,
  contact_reveal_approved INTEGER NOT NULL DEFAULT 0,
  joined_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  left_at TEXT,
  PRIMARY KEY(conversation_id, user_id)
);

CREATE TABLE relay_messages (
  id TEXT PRIMARY KEY,
  conversation_id TEXT NOT NULL REFERENCES conversations(id) ON DELETE CASCADE,
  sender_user_id TEXT NOT NULL REFERENCES users(id),
  source_chat_id INTEGER NOT NULL,
  source_message_id INTEGER NOT NULL,
  destination_chat_id INTEGER NOT NULL,
  destination_message_id INTEGER NOT NULL,
  message_type TEXT NOT NULL,
  moderation_status TEXT NOT NULL DEFAULT 'unchecked',
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  deleted_at TEXT,
  UNIQUE(source_chat_id, source_message_id, destination_chat_id)
);

CREATE TABLE blocks (
  blocker_user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  blocked_user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  reason TEXT,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY(blocker_user_id, blocked_user_id),
  CHECK(blocker_user_id <> blocked_user_id)
);

CREATE TABLE reports (
  id TEXT PRIMARY KEY,
  reporter_user_id TEXT NOT NULL REFERENCES users(id),
  reported_user_id TEXT NOT NULL REFERENCES users(id),
  profile_id TEXT REFERENCES profiles(id),
  conversation_id TEXT REFERENCES conversations(id),
  category TEXT NOT NULL,
  description TEXT,
  evidence_snapshot TEXT NOT NULL DEFAULT '[]',
  status TEXT NOT NULL DEFAULT 'open' CHECK (status IN ('open', 'reviewing', 'resolved', 'dismissed')),
  assigned_admin_id TEXT REFERENCES users(id),
  resolution TEXT,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  resolved_at TEXT
);

CREATE TABLE moderation_actions (
  id TEXT PRIMARY KEY,
  admin_user_id TEXT NOT NULL REFERENCES users(id),
  target_user_id TEXT NOT NULL REFERENCES users(id),
  action TEXT NOT NULL,
  reason TEXT NOT NULL,
  metadata TEXT NOT NULL DEFAULT '{}',
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX idx_swipes_target_action ON swipes(target_user_id, action, created_at);
CREATE INDEX idx_matches_user_a_status ON matches(user_a_id, status);
CREATE INDEX idx_matches_user_b_status ON matches(user_b_id, status);
CREATE INDEX idx_conversations_status_activity ON conversations(status, last_message_at);
CREATE INDEX idx_relay_conversation_created ON relay_messages(conversation_id, created_at);
CREATE INDEX idx_reports_queue ON reports(status, created_at);

