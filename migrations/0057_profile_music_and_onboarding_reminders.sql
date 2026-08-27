-- Track an explicit profile setup action separately from the automatically created identity row.
ALTER TABLE user_profiles ADD COLUMN configured_at TEXT;

-- Preserve meaningful legacy profiles as configured. Empty Telegram-name placeholders remain unset.
UPDATE user_profiles
SET configured_at = updated_at
WHERE trim(bio) <> ''
   OR avatar_media_id IS NOT NULL
   OR EXISTS (
     SELECT 1 FROM profile_usernames username
     WHERE username.user_id = user_profiles.user_id
   );

-- A missing settings row must never silently exclude an old Telegram user from notifications.
INSERT OR IGNORE INTO user_settings (user_id)
SELECT id FROM users
WHERE deleted_at IS NULL;

CREATE TABLE onboarding_reminder_state (
  user_id TEXT PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
  reminder_count INTEGER NOT NULL DEFAULT 0 CHECK (reminder_count BETWEEN 0 AND 8),
  next_scheduled_at TEXT NOT NULL,
  last_sent_at TEXT,
  last_kind TEXT CHECK (last_kind IS NULL OR last_kind IN ('profile', 'questionnaire', 'both')),
  last_variant INTEGER,
  completed_at TEXT,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX idx_onboarding_reminder_due
  ON onboarding_reminder_state(completed_at, next_scheduled_at, reminder_count);

-- Roll old incomplete accounts out gradually over seven days instead of creating a notification wave.
INSERT OR IGNORE INTO onboarding_reminder_state (user_id, next_scheduled_at)
SELECT
  user.id,
  datetime(
    date('now', '+' || CAST(1 + (abs(random()) % 7) AS TEXT) || ' days') || ' 12:00:00'
  )
FROM users user
LEFT JOIN user_profiles profile ON profile.user_id = user.id
WHERE user.deleted_at IS NULL
  AND user.is_banned = 0
  AND user.is_bot = 0
  AND user.telegram_user_id > 0
  AND user.created_at <= datetime('now', '-2 days')
  AND (
    profile.configured_at IS NULL
    OR NOT EXISTS (
      SELECT 1 FROM questionnaires questionnaire
      WHERE questionnaire.user_id = user.id
        AND questionnaire.moderation_status = 'approved'
    )
  );
