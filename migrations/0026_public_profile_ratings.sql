-- Independent ratings for stable public profiles.
-- Additive only: existing users, questionnaires, posts and ratings are preserved.

CREATE TABLE public_profile_ratings (
  profile_user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  rater_user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  value INTEGER NOT NULL CHECK (value IN (-1, 1)),
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (profile_user_id, rater_user_id),
  CHECK (profile_user_id <> rater_user_id)
);

CREATE INDEX idx_public_profile_ratings_profile
  ON public_profile_ratings(profile_user_id, value, updated_at DESC);
