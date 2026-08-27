-- Ordered public-profile avatar media. The first item remains mirrored in
-- user_profiles.avatar_media_id for compact and backwards-compatible views.
CREATE TABLE profile_avatar_media (
  profile_user_id TEXT NOT NULL REFERENCES user_profiles(user_id) ON DELETE CASCADE,
  media_id TEXT NOT NULL REFERENCES profile_media(id) ON DELETE CASCADE,
  sort_order INTEGER NOT NULL CHECK (sort_order BETWEEN 0 AND 7),
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (profile_user_id, media_id),
  UNIQUE (profile_user_id, sort_order)
);

INSERT INTO profile_avatar_media (profile_user_id, media_id, sort_order)
SELECT user_id, avatar_media_id, 0
FROM user_profiles
WHERE avatar_media_id IS NOT NULL;

CREATE INDEX idx_profile_avatar_media_order
  ON profile_avatar_media(profile_user_id, sort_order);
