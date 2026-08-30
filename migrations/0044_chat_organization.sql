-- Telegram-like per-user chat organization. These flags never alter or duplicate message history.
ALTER TABLE conversation_participants ADD COLUMN archived_at TEXT;
ALTER TABLE conversation_participants ADD COLUMN pinned_order INTEGER;

ALTER TABLE user_settings ADD COLUMN chat_archive_visible INTEGER NOT NULL DEFAULT 1
  CHECK (chat_archive_visible IN (0, 1));
ALTER TABLE user_settings ADD COLUMN auto_archive_new_chats INTEGER NOT NULL DEFAULT 0
  CHECK (auto_archive_new_chats IN (0, 1));
ALTER TABLE user_settings ADD COLUMN quick_reaction TEXT NOT NULL DEFAULT 'heart';
ALTER TABLE user_settings ADD COLUMN follower_post_notifications_enabled INTEGER NOT NULL DEFAULT 1
  CHECK (follower_post_notifications_enabled IN (0, 1));
ALTER TABLE user_settings ADD COLUMN follower_questionnaire_notifications_enabled INTEGER NOT NULL DEFAULT 1
  CHECK (follower_questionnaire_notifications_enabled IN (0, 1));

CREATE INDEX idx_conversation_participants_user_organization
  ON conversation_participants(user_id, archived_at, pinned_order, conversation_id);

-- A chat playlist groups up to 20 existing Telegram-backed audio messages without copying bytes.
CREATE TABLE conversation_media_playlists (
  id TEXT PRIMARY KEY,
  conversation_id TEXT NOT NULL REFERENCES conversations(id) ON DELETE CASCADE,
  owner_user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  title TEXT CHECK (title IS NULL OR length(title) BETWEEN 1 AND 120),
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  UNIQUE(conversation_id, id)
);

CREATE INDEX idx_conversation_media_playlists_chat
  ON conversation_media_playlists(conversation_id, created_at DESC);

ALTER TABLE telegram_posts ADD COLUMN playlist_title TEXT
  CHECK (playlist_title IS NULL OR length(playlist_title) BETWEEN 1 AND 120);

CREATE TABLE content_shares (
  id TEXT PRIMARY KEY,
  actor_user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  entity_type TEXT NOT NULL CHECK (entity_type IN ('post', 'questionnaire', 'playlist')),
  entity_id TEXT NOT NULL,
  conversation_id TEXT NOT NULL REFERENCES conversations(id) ON DELETE CASCADE,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  UNIQUE(actor_user_id, entity_type, entity_id, conversation_id)
);

CREATE INDEX idx_content_shares_entity
  ON content_shares(entity_type, entity_id, created_at DESC);

CREATE TABLE post_reposts (
  source_post_id TEXT NOT NULL REFERENCES telegram_posts(id) ON DELETE CASCADE,
  reposter_user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  repost_post_id TEXT NOT NULL UNIQUE REFERENCES telegram_posts(id) ON DELETE CASCADE,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (source_post_id, reposter_user_id)
);

CREATE INDEX idx_post_reposts_source
  ON post_reposts(source_post_id, created_at DESC);
