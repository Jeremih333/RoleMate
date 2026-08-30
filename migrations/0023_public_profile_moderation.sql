-- Public identities are moderated independently from roleplay questionnaires.
-- This migration is additive and does not remove or rewrite user content.

ALTER TABLE user_profiles ADD COLUMN moderation_status TEXT NOT NULL DEFAULT 'active'
  CHECK (moderation_status IN ('active', 'blocked'));
ALTER TABLE user_profiles ADD COLUMN moderation_reason TEXT;

CREATE INDEX idx_user_profiles_moderation
  ON user_profiles(moderation_status, updated_at DESC);
