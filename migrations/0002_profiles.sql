CREATE TABLE profiles (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL UNIQUE REFERENCES users(id) ON DELETE CASCADE,
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
  settings TEXT NOT NULL DEFAULT '',
  plots TEXT NOT NULL DEFAULT '',
  looking_for TEXT NOT NULL DEFAULT '[]',
  boundaries TEXT NOT NULL DEFAULT '',
  adult_topics_allowed INTEGER NOT NULL DEFAULT 0,
  contact_reveal_policy TEXT NOT NULL DEFAULT 'mutual_only',
  moderation_status TEXT NOT NULL DEFAULT 'draft'
    CHECK (moderation_status IN ('draft', 'pending', 'approved', 'rejected', 'paused', 'archived')),
  moderation_reason TEXT,
  profile_completion_percent INTEGER NOT NULL DEFAULT 0 CHECK (profile_completion_percent BETWEEN 0 AND 100),
  is_active INTEGER NOT NULL DEFAULT 0,
  last_boosted_at TEXT,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE profile_media (
  id TEXT PRIMARY KEY,
  profile_id TEXT NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
  telegram_file_id TEXT,
  telegram_file_unique_id TEXT,
  media_type TEXT NOT NULL CHECK (media_type IN ('photo', 'animation')),
  storage_url TEXT,
  sort_order INTEGER NOT NULL DEFAULT 0,
  moderation_status TEXT NOT NULL DEFAULT 'pending',
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  UNIQUE(profile_id, telegram_file_unique_id)
);

CREATE TABLE tags (
  id TEXT PRIMARY KEY,
  type TEXT NOT NULL CHECK (type IN ('fandom', 'genre', 'role', 'language')),
  slug TEXT NOT NULL,
  label TEXT NOT NULL,
  is_active INTEGER NOT NULL DEFAULT 1,
  sort_order INTEGER NOT NULL DEFAULT 0,
  UNIQUE(type, slug)
);

CREATE TABLE profile_tags (
  profile_id TEXT NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
  tag_id TEXT NOT NULL REFERENCES tags(id) ON DELETE CASCADE,
  PRIMARY KEY(profile_id, tag_id)
);

CREATE TABLE search_preferences (
  user_id TEXT PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
  age_groups TEXT NOT NULL DEFAULT '[]',
  languages TEXT NOT NULL DEFAULT '[]',
  genres TEXT NOT NULL DEFAULT '[]',
  fandoms TEXT NOT NULL DEFAULT '[]',
  writing_styles TEXT NOT NULL DEFAULT '[]',
  activity_levels TEXT NOT NULL DEFAULT '[]',
  only_online INTEGER NOT NULL DEFAULT 0,
  only_with_photo INTEGER NOT NULL DEFAULT 0,
  adult_topics_filter TEXT NOT NULL DEFAULT 'hidden',
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX idx_profiles_discovery ON profiles(moderation_status, is_active, updated_at);
CREATE INDEX idx_profile_media_profile_sort ON profile_media(profile_id, sort_order);
CREATE INDEX idx_tags_type_active_sort ON tags(type, is_active, sort_order);

