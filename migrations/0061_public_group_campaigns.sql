-- Explicitly consented RoleMate presentations in public Telegram supergroups.
-- A group is never activated merely because the bot was added or promoted.

CREATE TABLE public_group_campaigns (
  chat_id INTEGER PRIMARY KEY,
  chat_title TEXT,
  chat_username TEXT,
  status TEXT NOT NULL DEFAULT 'pending_consent'
    CHECK (status IN ('pending_consent', 'active', 'paused', 'removed')),
  added_by_telegram_user_id INTEGER,
  activated_by_telegram_user_id INTEGER,
  next_send_at TEXT,
  last_sent_at TEXT,
  last_variant_index INTEGER NOT NULL DEFAULT -1,
  sent_count INTEGER NOT NULL DEFAULT 0 CHECK (sent_count >= 0),
  consecutive_failures INTEGER NOT NULL DEFAULT 0 CHECK (consecutive_failures >= 0),
  claim_token TEXT,
  claim_expires_at TEXT,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX idx_public_group_campaigns_due
  ON public_group_campaigns(status, next_send_at, claim_expires_at);
