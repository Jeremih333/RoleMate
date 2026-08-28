-- A one-off cosmetic badge with its own artwork, granted by hand. Like every
-- profile badge it decorates the profile and grants nothing else.
INSERT OR IGNORE INTO profile_badges (user_id, badge)
SELECT id, 'special' FROM users WHERE id = 'c1415635-ff24-44db-aeb9-e6f0e2959da9';
