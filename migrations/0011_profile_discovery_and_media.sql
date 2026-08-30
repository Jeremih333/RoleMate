ALTER TABLE profiles ADD COLUMN tags TEXT NOT NULL DEFAULT '[]';

ALTER TABLE profile_media RENAME TO profile_media_legacy;

CREATE TABLE profile_media (
  id TEXT PRIMARY KEY,
  profile_id TEXT NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
  telegram_file_id TEXT NOT NULL,
  telegram_file_unique_id TEXT NOT NULL,
  media_type TEXT NOT NULL CHECK (
    media_type IN ('photo', 'animation', 'video', 'audio', 'voice', 'document')
  ),
  sort_order INTEGER NOT NULL DEFAULT 0,
  moderation_status TEXT NOT NULL DEFAULT 'pending'
    CHECK (moderation_status IN ('pending', 'approved', 'rejected')),
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  UNIQUE(profile_id, telegram_file_unique_id)
);

INSERT INTO profile_media (
  id, profile_id, telegram_file_id, telegram_file_unique_id,
  media_type, sort_order, moderation_status, created_at
)
SELECT
  id, profile_id, telegram_file_id, telegram_file_unique_id,
  media_type, sort_order, moderation_status, created_at
FROM profile_media_legacy;

DROP TABLE profile_media_legacy;

CREATE INDEX idx_profile_media_profile_sort ON profile_media(profile_id, sort_order);
CREATE INDEX idx_profiles_tags ON profiles(tags);
