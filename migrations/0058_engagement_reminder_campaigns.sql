-- Sparse channel and referral reminders share one per-user state so campaigns cannot spam.
CREATE TABLE engagement_reminder_state (
  user_id TEXT PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
  channel_reminder_count INTEGER NOT NULL DEFAULT 0
    CHECK (channel_reminder_count BETWEEN 0 AND 4),
  channel_next_at TEXT NOT NULL,
  channel_completed_at TEXT,
  referral_reminder_count INTEGER NOT NULL DEFAULT 0
    CHECK (referral_reminder_count BETWEEN 0 AND 4),
  referral_next_at TEXT NOT NULL,
  referral_completed_at TEXT,
  claim_token TEXT,
  claim_kind TEXT CHECK (claim_kind IS NULL OR claim_kind IN ('channel', 'referral')),
  claim_expires_at TEXT,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX idx_engagement_channel_due
  ON engagement_reminder_state(channel_completed_at, channel_next_at, channel_reminder_count);
CREATE INDEX idx_engagement_referral_due
  ON engagement_reminder_state(referral_completed_at, referral_next_at, referral_reminder_count);
CREATE INDEX idx_engagement_claim
  ON engagement_reminder_state(claim_token, claim_expires_at);

-- Every historic Telegram user is initialized, but first contact is spread over several weeks.
INSERT OR IGNORE INTO engagement_reminder_state (
  user_id, channel_next_at, referral_next_at, referral_completed_at
)
SELECT
  user.id,
  datetime(
    date('now', '+' || CAST(10 + (abs(random()) % 21) AS TEXT) || ' days') || ' 12:00:00'
  ),
  datetime(
    date('now', '+' || CAST(15 + (abs(random()) % 21) AS TEXT) || ' days') || ' 16:00:00'
  ),
  CASE WHEN EXISTS (
    SELECT 1 FROM referrals referral WHERE referral.referrer_user_id = user.id
  ) THEN CURRENT_TIMESTAMP ELSE NULL END
FROM users user
WHERE user.deleted_at IS NULL
  AND user.is_banned = 0
  AND user.is_bot = 0
  AND user.telegram_user_id > 0;
