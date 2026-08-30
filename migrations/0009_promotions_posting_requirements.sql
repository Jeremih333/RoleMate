ALTER TABLE profiles ADD COLUMN gender TEXT NOT NULL DEFAULT 'not_specified'
  CHECK (gender IN ('female', 'male', 'nonbinary', 'not_specified'));

ALTER TABLE user_settings ADD COLUMN hide_demographics INTEGER NOT NULL DEFAULT 0
  CHECK (hide_demographics IN (0, 1));

CREATE TABLE promotions (
  id TEXT PRIMARY KEY,
  code TEXT NOT NULL COLLATE NOCASE UNIQUE,
  type TEXT NOT NULL CHECK (type IN ('discount', 'premium_days')),
  discount_stars INTEGER NOT NULL DEFAULT 0 CHECK (discount_stars >= 0),
  discount_rubles INTEGER NOT NULL DEFAULT 0 CHECK (discount_rubles >= 0),
  premium_days INTEGER NOT NULL DEFAULT 0 CHECK (premium_days >= 0),
  eligible_product_ids TEXT NOT NULL DEFAULT '[]',
  expires_at TEXT,
  max_activations INTEGER CHECK (max_activations IS NULL OR max_activations > 0),
  activation_count INTEGER NOT NULL DEFAULT 0 CHECK (activation_count >= 0),
  is_active INTEGER NOT NULL DEFAULT 1 CHECK (is_active IN (0, 1)),
  created_by_user_id TEXT NOT NULL REFERENCES users(id),
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CHECK (
    (type = 'discount' AND (discount_stars > 0 OR discount_rubles > 0) AND premium_days = 0)
    OR (type = 'premium_days' AND premium_days > 0
      AND discount_stars = 0 AND discount_rubles = 0)
  )
);

CREATE TABLE promo_redemptions (
  id TEXT PRIMARY KEY,
  promotion_id TEXT NOT NULL REFERENCES promotions(id),
  user_id TEXT NOT NULL REFERENCES users(id),
  payment_order_id TEXT REFERENCES payment_orders(id),
  kind TEXT NOT NULL CHECK (kind IN ('discount', 'premium_days')),
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  UNIQUE(promotion_id, user_id)
);

CREATE TABLE user_promo_selections (
  user_id TEXT PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
  promotion_id TEXT NOT NULL REFERENCES promotions(id),
  selected_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);

ALTER TABLE payment_orders ADD COLUMN promotion_id TEXT REFERENCES promotions(id);
ALTER TABLE payment_orders ADD COLUMN discount_stars INTEGER NOT NULL DEFAULT 0;
ALTER TABLE payment_orders ADD COLUMN discount_rubles INTEGER NOT NULL DEFAULT 0;

CREATE TABLE posting_requirements (
  id TEXT PRIMARY KEY,
  type TEXT NOT NULL CHECK (type IN ('channel', 'supergroup', 'bot')),
  title TEXT NOT NULL,
  target_chat_id TEXT,
  username TEXT,
  action_url TEXT NOT NULL,
  bot_verification_secret_hash TEXT,
  expires_at TEXT,
  max_conversions INTEGER CHECK (max_conversions IS NULL OR max_conversions > 0),
  conversion_count INTEGER NOT NULL DEFAULT 0 CHECK (conversion_count >= 0),
  is_active INTEGER NOT NULL DEFAULT 1 CHECK (is_active IN (0, 1)),
  created_by_user_id TEXT NOT NULL REFERENCES users(id),
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CHECK (
    (type IN ('channel', 'supergroup') AND target_chat_id IS NOT NULL)
    OR (type = 'bot' AND bot_verification_secret_hash IS NOT NULL)
  )
);

CREATE TABLE posting_requirement_checks (
  requirement_id TEXT NOT NULL REFERENCES posting_requirements(id) ON DELETE CASCADE,
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  status TEXT NOT NULL CHECK (status IN ('verified', 'snoozed')),
  verified_at TEXT,
  snoozed_until TEXT,
  PRIMARY KEY(requirement_id, user_id)
);

CREATE TABLE posting_gate_counters (
  user_id TEXT PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
  posts_viewed INTEGER NOT NULL DEFAULT 0,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX idx_promotions_active_expiry ON promotions(is_active, expires_at);
CREATE INDEX idx_posting_requirements_active ON posting_requirements(is_active, expires_at);

INSERT OR IGNORE INTO app_config (key, value, is_public) VALUES
  ('posting_gate_interval', '3', 0),
  ('posting_gate_snooze_hours', '24', 0),
  ('news_channel_url', 'https://t.me/rolemate', 1);

