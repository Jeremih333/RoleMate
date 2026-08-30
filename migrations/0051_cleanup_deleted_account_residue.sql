-- Remove legacy public identity rows left by account deletions performed before
-- users.delete gained complete profile/social cleanup. Current deletion performs
-- the same cleanup transactionally before anonymising the users row.
DELETE FROM profile_follows
WHERE follower_user_id IN (SELECT id FROM users WHERE deleted_at IS NOT NULL)
   OR followed_user_id IN (SELECT id FROM users WHERE deleted_at IS NOT NULL);

DELETE FROM profile_usernames
WHERE user_id IN (SELECT id FROM users WHERE deleted_at IS NOT NULL);

DELETE FROM user_profiles
WHERE user_id IN (SELECT id FROM users WHERE deleted_at IS NOT NULL);
