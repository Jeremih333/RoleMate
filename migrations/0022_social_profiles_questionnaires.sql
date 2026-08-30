-- Separate the stable public user identity from roleplay questionnaires.
-- Existing profile tables stay intact as a rollback source; data is copied, never deleted.

ALTER TABLE telegram_posts ADD COLUMN media_telegram_file_id TEXT;
ALTER TABLE telegram_posts ADD COLUMN media_thumbnail_file_id TEXT;
ALTER TABLE telegram_posts ADD COLUMN track_title TEXT;
ALTER TABLE telegram_posts ADD COLUMN track_performer TEXT;

CREATE TABLE user_profiles (
  user_id TEXT PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
  display_name TEXT NOT NULL,
  bio TEXT NOT NULL DEFAULT '',
  avatar_media_id TEXT,
  avatar_render_mode TEXT
    CHECK (avatar_render_mode IS NULL OR avatar_render_mode IN ('photo', 'animation')),
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);

INSERT INTO user_profiles (
  user_id, display_name, bio, avatar_media_id, avatar_render_mode, created_at, updated_at
)
SELECT
  u.id,
  COALESCE(p.display_name, u.telegram_first_name),
  COALESCE(p.about, ''),
  p.avatar_media_id,
  p.avatar_render_mode,
  COALESCE(p.created_at, u.created_at),
  COALESCE(p.updated_at, u.updated_at)
FROM users u
LEFT JOIN profiles p ON p.user_id = u.id;

CREATE TABLE questionnaires (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  title TEXT NOT NULL DEFAULT '',
  display_name TEXT NOT NULL,
  age_group TEXT NOT NULL,
  short_headline TEXT NOT NULL,
  about TEXT NOT NULL,
  roleplay_experience TEXT NOT NULL,
  preferred_role TEXT NOT NULL DEFAULT '[]',
  writing_style TEXT NOT NULL,
  average_post_length TEXT NOT NULL,
  activity_frequency TEXT NOT NULL,
  timezone TEXT NOT NULL,
  active_hours TEXT NOT NULL DEFAULT '',
  languages TEXT NOT NULL DEFAULT '[]',
  fandoms TEXT NOT NULL DEFAULT '[]',
  genres TEXT NOT NULL DEFAULT '[]',
  tags TEXT NOT NULL DEFAULT '[]',
  settings TEXT NOT NULL DEFAULT '',
  plots TEXT NOT NULL DEFAULT '',
  looking_for TEXT NOT NULL DEFAULT '[]',
  boundaries TEXT NOT NULL DEFAULT '',
  adult_topics_allowed INTEGER NOT NULL DEFAULT 0 CHECK (adult_topics_allowed IN (0, 1)),
  contact_reveal_policy TEXT NOT NULL DEFAULT 'mutual_only',
  gender TEXT NOT NULL DEFAULT 'not_specified'
    CHECK (gender IN ('female', 'male', 'nonbinary', 'not_specified')),
  moderation_status TEXT NOT NULL DEFAULT 'draft'
    CHECK (moderation_status IN ('draft', 'pending', 'approved', 'rejected', 'paused', 'archived')),
  moderation_reason TEXT,
  profile_completion_percent INTEGER NOT NULL DEFAULT 0
    CHECK (profile_completion_percent BETWEEN 0 AND 100),
  is_active INTEGER NOT NULL DEFAULT 0 CHECK (is_active IN (0, 1)),
  is_primary INTEGER NOT NULL DEFAULT 0 CHECK (is_primary IN (0, 1)),
  avatar_media_id TEXT,
  avatar_render_mode TEXT
    CHECK (avatar_render_mode IS NULL OR avatar_render_mode IN ('photo', 'animation')),
  last_boosted_at TEXT,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);

INSERT INTO questionnaires (
  id, user_id, title, display_name, age_group, short_headline, about,
  roleplay_experience, preferred_role, writing_style, average_post_length,
  activity_frequency, timezone, active_hours, languages, fandoms, genres, tags,
  settings, plots, looking_for, boundaries, adult_topics_allowed,
  contact_reveal_policy, gender, moderation_status, moderation_reason,
  profile_completion_percent, is_active, is_primary, avatar_media_id,
  avatar_render_mode, last_boosted_at,
  created_at, updated_at
)
SELECT
  id, user_id, short_headline, display_name, age_group, short_headline, about,
  roleplay_experience, preferred_role, writing_style, average_post_length,
  activity_frequency, timezone, active_hours, languages, fandoms, genres, tags,
  settings, plots, looking_for, boundaries, adult_topics_allowed,
  contact_reveal_policy, gender, moderation_status, moderation_reason,
  profile_completion_percent, is_active, 1, avatar_media_id,
  avatar_render_mode, last_boosted_at, created_at, updated_at
FROM profiles;

CREATE UNIQUE INDEX idx_questionnaires_primary
  ON questionnaires(user_id) WHERE is_primary = 1;
CREATE INDEX idx_questionnaires_owner
  ON questionnaires(user_id, updated_at DESC);
CREATE INDEX idx_questionnaires_discovery
  ON questionnaires(moderation_status, is_active, updated_at DESC);
CREATE INDEX idx_questionnaires_tags ON questionnaires(tags);

CREATE TABLE questionnaire_media (
  id TEXT PRIMARY KEY,
  questionnaire_id TEXT NOT NULL REFERENCES questionnaires(id) ON DELETE CASCADE,
  telegram_file_id TEXT NOT NULL,
  telegram_file_unique_id TEXT NOT NULL,
  media_type TEXT NOT NULL CHECK (
    media_type IN ('photo', 'animation', 'video', 'audio', 'voice', 'document')
  ),
  sort_order INTEGER NOT NULL DEFAULT 0,
  moderation_status TEXT NOT NULL DEFAULT 'approved'
    CHECK (moderation_status IN ('pending', 'approved', 'rejected')),
  file_size_bytes INTEGER,
  duration_seconds INTEGER,
  width INTEGER,
  height INTEGER,
  track_title TEXT,
  track_performer TEXT,
  thumbnail_telegram_file_id TEXT,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  UNIQUE(questionnaire_id, telegram_file_unique_id)
);

INSERT INTO questionnaire_media (
  id, questionnaire_id, telegram_file_id, telegram_file_unique_id, media_type,
  sort_order, moderation_status, file_size_bytes, duration_seconds, width, height,
  track_title, track_performer, thumbnail_telegram_file_id, created_at
)
SELECT
  id, profile_id, telegram_file_id, telegram_file_unique_id, media_type,
  sort_order, moderation_status, file_size_bytes, duration_seconds, width, height,
  track_title, track_performer, thumbnail_telegram_file_id, created_at
FROM profile_media;

CREATE INDEX idx_questionnaire_media_order
  ON questionnaire_media(questionnaire_id, sort_order, created_at);

CREATE TABLE post_comments (
  id TEXT PRIMARY KEY,
  post_id TEXT NOT NULL REFERENCES telegram_posts(id) ON DELETE CASCADE,
  author_user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  body TEXT NOT NULL CHECK (length(body) BETWEEN 1 AND 1000),
  status TEXT NOT NULL DEFAULT 'active'
    CHECK (status IN ('active', 'deleted', 'blocked')),
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX idx_post_comments_post
  ON post_comments(post_id, status, created_at);

CREATE TABLE post_ratings (
  post_id TEXT NOT NULL REFERENCES telegram_posts(id) ON DELETE CASCADE,
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  value INTEGER NOT NULL CHECK (value IN (-1, 1)),
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY(post_id, user_id)
);

CREATE INDEX idx_post_ratings_score
  ON post_ratings(post_id, value);

CREATE TABLE questionnaire_ratings (
  questionnaire_id TEXT NOT NULL REFERENCES questionnaires(id) ON DELETE CASCADE,
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  value INTEGER NOT NULL CHECK (value IN (-1, 1)),
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY(questionnaire_id, user_id)
);

CREATE INDEX idx_questionnaire_ratings_score
  ON questionnaire_ratings(questionnaire_id, value);
