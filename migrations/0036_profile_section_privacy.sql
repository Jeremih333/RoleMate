ALTER TABLE user_profiles ADD COLUMN show_followers INTEGER NOT NULL DEFAULT 1
  CHECK (show_followers IN (0, 1));
ALTER TABLE user_profiles ADD COLUMN show_following INTEGER NOT NULL DEFAULT 1
  CHECK (show_following IN (0, 1));
ALTER TABLE user_profiles ADD COLUMN show_questionnaires INTEGER NOT NULL DEFAULT 1
  CHECK (show_questionnaires IN (0, 1));
ALTER TABLE user_profiles ADD COLUMN show_posts INTEGER NOT NULL DEFAULT 1
  CHECK (show_posts IN (0, 1));
ALTER TABLE user_profiles ADD COLUMN direct_message_policy TEXT NOT NULL DEFAULT 'everyone'
  CHECK (direct_message_policy IN ('everyone', 'following_and_staff'));
ALTER TABLE user_profiles ADD COLUMN show_last_seen INTEGER NOT NULL DEFAULT 1
  CHECK (show_last_seen IN (0, 1));
