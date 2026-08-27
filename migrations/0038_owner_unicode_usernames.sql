-- SQLite cannot alter a CHECK constraint in place. Rebuild the table while
-- preserving every existing username, owner, primary flag and timestamp.
ALTER TABLE profile_usernames RENAME TO profile_usernames_legacy_ascii;

CREATE TABLE profile_usernames (
  username TEXT COLLATE NOCASE PRIMARY KEY,
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  created_by_user_id TEXT NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
  is_primary INTEGER NOT NULL DEFAULT 0 CHECK (is_primary IN (0, 1)),
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CHECK (
    length(username) BETWEEN 4 AND 32
    AND (
      (
        username NOT GLOB '*[^A-Za-z0-9_]*'
        AND substr(username, 1, 1) GLOB '[A-Za-z]'
      )
      OR
      (
        username NOT GLOB '*[^А-Яа-яЁё0-9_]*'
        AND substr(username, 1, 1) GLOB '[А-Яа-яЁё]'
      )
    )
  )
);

INSERT INTO profile_usernames (
  username, user_id, created_by_user_id, is_primary, created_at, updated_at
)
SELECT username, user_id, created_by_user_id, is_primary, created_at, updated_at
FROM profile_usernames_legacy_ascii;

DROP TABLE profile_usernames_legacy_ascii;

CREATE UNIQUE INDEX idx_profile_usernames_primary
  ON profile_usernames(user_id) WHERE is_primary = 1;

CREATE INDEX idx_profile_usernames_user
  ON profile_usernames(user_id, created_at);
