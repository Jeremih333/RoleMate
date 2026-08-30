CREATE TABLE conversation_ratings (
  id TEXT PRIMARY KEY,
  conversation_id TEXT NOT NULL REFERENCES conversations(id) ON DELETE CASCADE,
  rater_user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  rated_user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  value INTEGER NOT NULL CHECK (value IN (-1, 1)),
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CHECK(rater_user_id <> rated_user_id),
  UNIQUE(conversation_id, rater_user_id)
);

CREATE INDEX idx_conversation_ratings_rated
  ON conversation_ratings(rated_user_id, value, updated_at);

CREATE TABLE telegram_posts (
  id TEXT PRIMARY KEY,
  author_user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  source_chat_id INTEGER,
  source_message_id INTEGER,
  content_type TEXT CHECK (
    content_type IS NULL OR content_type IN (
      'text', 'photo', 'document', 'animation', 'video', 'video_note', 'voice', 'audio'
    )
  ),
  text_preview TEXT NOT NULL DEFAULT '',
  status TEXT NOT NULL DEFAULT 'draft'
    CHECK (status IN ('draft', 'active', 'deleted', 'blocked')),
  published_at TEXT,
  deleted_at TEXT,
  moderation_reason TEXT,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE UNIQUE INDEX idx_telegram_posts_active_draft
  ON telegram_posts(author_user_id)
  WHERE status = 'draft';
CREATE INDEX idx_telegram_posts_feed
  ON telegram_posts(status, published_at DESC);
CREATE INDEX idx_telegram_posts_author
  ON telegram_posts(author_user_id, status, created_at DESC);

CREATE TABLE telegram_post_views (
  post_id TEXT NOT NULL REFERENCES telegram_posts(id) ON DELETE CASCADE,
  viewer_user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  viewed_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY(post_id, viewer_user_id)
);

ALTER TABLE reports ADD COLUMN post_id TEXT REFERENCES telegram_posts(id);

