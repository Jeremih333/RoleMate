ALTER TABLE user_profiles ADD COLUMN visibility_mode TEXT NOT NULL DEFAULT 'public'
  CHECK (visibility_mode IN ('public', 'following_only'));

ALTER TABLE reports ADD COLUMN public_profile_user_id TEXT REFERENCES users(id);

CREATE TABLE profile_follows (
  follower_user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  followed_user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (follower_user_id, followed_user_id),
  CHECK (follower_user_id <> followed_user_id)
);

CREATE INDEX idx_profile_follows_followed
  ON profile_follows(followed_user_id, created_at DESC);

CREATE INDEX idx_profile_follows_follower
  ON profile_follows(follower_user_id, created_at DESC);

CREATE INDEX idx_reports_public_profile
  ON reports(public_profile_user_id, status, created_at DESC);

CREATE TABLE questionnaire_views (
  questionnaire_id TEXT NOT NULL REFERENCES questionnaires(id) ON DELETE CASCADE,
  viewer_user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  viewed_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (questionnaire_id, viewer_user_id)
);

CREATE INDEX idx_questionnaire_views_questionnaire
  ON questionnaire_views(questionnaire_id, viewed_at DESC);
