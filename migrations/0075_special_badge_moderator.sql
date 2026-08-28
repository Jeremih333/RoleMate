-- The custom mark replaces the standard blue check for this moderator. The
-- badge is resolved ahead of the moderator assignment, so the two do not fight
-- over the same spot next to the name.
INSERT OR IGNORE INTO profile_badges (user_id, badge)
SELECT id, 'special' FROM users WHERE telegram_user_id = 1003817394;
