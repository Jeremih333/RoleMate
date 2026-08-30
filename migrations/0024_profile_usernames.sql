-- Telegram-like aliases for stable public profiles.
-- The migration is additive and does not rewrite existing profile data.

CREATE TABLE profile_usernames (
  username TEXT COLLATE NOCASE PRIMARY KEY,
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  created_by_user_id TEXT NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
  is_primary INTEGER NOT NULL DEFAULT 0 CHECK (is_primary IN (0, 1)),
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CHECK (
    length(username) BETWEEN 4 AND 32
    AND username NOT GLOB '*[^A-Za-z0-9_]*'
    AND substr(username, 1, 1) GLOB '[A-Za-z]'
  )
);

CREATE UNIQUE INDEX idx_profile_usernames_primary
  ON profile_usernames(user_id) WHERE is_primary = 1;

CREATE INDEX idx_profile_usernames_user
  ON profile_usernames(user_id, created_at);
