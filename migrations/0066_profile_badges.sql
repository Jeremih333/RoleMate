-- Cosmetic profile badges. A badge only decorates a profile: it grants no
-- moderation powers and is never consulted for authorisation, which is why it
-- lives apart from users.role and moderator_assignments.
CREATE TABLE IF NOT EXISTS profile_badges (
  user_id TEXT NOT NULL,
  badge TEXT NOT NULL,
  granted_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (user_id, badge),
  FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
);

-- The badge is resolved next to every profile, comment and post render, so the
-- lookup has to be a point read.
CREATE INDEX IF NOT EXISTS idx_profile_badges_user ON profile_badges(user_id);

-- The RoleMate tester who reported this release's bugs.
INSERT OR IGNORE INTO profile_badges (user_id, badge)
SELECT id, 'tester' FROM users WHERE id = '67fffacd-d6d9-4a68-8505-44d0e42c2867';
