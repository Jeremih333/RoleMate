CREATE TABLE profile_views (
  id TEXT PRIMARY KEY,
  viewer_user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  viewed_user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  viewed_on TEXT NOT NULL DEFAULT (date('now')),
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  UNIQUE(viewer_user_id, viewed_user_id, viewed_on),
  CHECK(viewer_user_id <> viewed_user_id)
);

CREATE INDEX idx_profile_views_viewer_day
  ON profile_views(viewer_user_id, viewed_on, created_at);
CREATE INDEX idx_profile_views_target_day
  ON profile_views(viewed_user_id, viewed_on, created_at);

CREATE TABLE saved_filter_sets (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  filters TEXT NOT NULL DEFAULT '{}',
  is_active INTEGER NOT NULL DEFAULT 0 CHECK (is_active IN (0, 1)),
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  UNIQUE(user_id, name)
);

CREATE INDEX idx_saved_filter_sets_user
  ON saved_filter_sets(user_id, updated_at DESC);

CREATE TABLE profile_variants (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  short_headline TEXT NOT NULL,
  about TEXT NOT NULL,
  plots TEXT NOT NULL DEFAULT '',
  is_active INTEGER NOT NULL DEFAULT 0 CHECK (is_active IN (0, 1)),
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  UNIQUE(user_id, name)
);

CREATE INDEX idx_profile_variants_user
  ON profile_variants(user_id, updated_at DESC);

INSERT OR IGNORE INTO feature_flags (key, enabled, payload)
VALUES ('premium_early_access', 0, '{"label":"Ранний доступ"}');
