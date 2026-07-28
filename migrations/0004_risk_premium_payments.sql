CREATE TABLE captcha_challenges (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  type TEXT NOT NULL,
  challenge_hash TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'passed', 'failed', 'expired')),
  attempts INTEGER NOT NULL DEFAULT 0,
  expires_at TEXT NOT NULL,
  completed_at TEXT,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE risk_events (
  id TEXT PRIMARY KEY,
  user_id TEXT REFERENCES users(id) ON DELETE SET NULL,
  type TEXT NOT NULL,
  score_delta INTEGER NOT NULL,
  metadata TEXT NOT NULL DEFAULT '{}',
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE products (
  id TEXT PRIMARY KEY,
  code TEXT NOT NULL UNIQUE,
  name TEXT NOT NULL,
  description TEXT NOT NULL,
  billing_type TEXT NOT NULL CHECK (billing_type IN ('one_time', 'subscription')),
  duration_days INTEGER NOT NULL,
  stars_amount INTEGER NOT NULL CHECK (stars_amount > 0),
  rub_amount INTEGER,
  is_active INTEGER NOT NULL DEFAULT 1,
  sort_order INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE payment_orders (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL REFERENCES users(id),
  provider TEXT NOT NULL CHECK (provider IN ('telegram_stars', 'yookassa')),
  product_id TEXT NOT NULL REFERENCES products(id),
  currency TEXT NOT NULL,
  amount INTEGER NOT NULL,
  status TEXT NOT NULL DEFAULT 'pending'
    CHECK (status IN ('pending', 'precheckout_approved', 'paid', 'refunded', 'failed', 'expired')),
  invoice_payload TEXT NOT NULL UNIQUE,
  provider_payment_id TEXT,
  telegram_payment_charge_id TEXT UNIQUE,
  provider_payment_charge_id TEXT,
  idempotency_key TEXT NOT NULL UNIQUE,
  expires_at TEXT NOT NULL,
  paid_at TEXT,
  refunded_at TEXT,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE payment_events (
  id TEXT PRIMARY KEY,
  payment_order_id TEXT NOT NULL REFERENCES payment_orders(id),
  provider TEXT NOT NULL,
  event_type TEXT NOT NULL,
  provider_event_id TEXT NOT NULL,
  payload_hash TEXT NOT NULL,
  processing_status TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  UNIQUE(provider, provider_event_id)
);

CREATE TABLE star_transactions (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL REFERENCES users(id),
  payment_order_id TEXT NOT NULL UNIQUE REFERENCES payment_orders(id),
  telegram_payment_charge_id TEXT NOT NULL UNIQUE,
  amount INTEGER NOT NULL,
  currency TEXT NOT NULL CHECK(currency = 'XTR'),
  subscription_expiration_date INTEGER,
  is_recurring INTEGER NOT NULL DEFAULT 0,
  is_first_recurring INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE yookassa_payments (
  id TEXT PRIMARY KEY,
  payment_order_id TEXT NOT NULL UNIQUE REFERENCES payment_orders(id),
  yookassa_payment_id TEXT UNIQUE,
  status TEXT NOT NULL,
  confirmation_url TEXT,
  idempotency_key TEXT NOT NULL UNIQUE,
  metadata TEXT NOT NULL DEFAULT '{}',
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE premium_entitlements (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL REFERENCES users(id),
  source TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'revoked', 'expired')),
  starts_at TEXT NOT NULL,
  ends_at TEXT NOT NULL,
  auto_renew INTEGER NOT NULL DEFAULT 0,
  product_id TEXT REFERENCES products(id),
  payment_order_id TEXT REFERENCES payment_orders(id),
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE premium_grants (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL REFERENCES users(id),
  source TEXT NOT NULL,
  duration_seconds INTEGER NOT NULL CHECK(duration_seconds > 0),
  reference_id TEXT NOT NULL UNIQUE,
  granted_by_user_id TEXT REFERENCES users(id),
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX idx_captcha_user_status ON captcha_challenges(user_id, status, expires_at);
CREATE INDEX idx_risk_user_created ON risk_events(user_id, created_at);
CREATE INDEX idx_products_active_sort ON products(is_active, sort_order);
CREATE INDEX idx_payment_user_status ON payment_orders(user_id, status, created_at);
CREATE INDEX idx_entitlements_user_active ON premium_entitlements(user_id, status, ends_at);

INSERT INTO products
  (id, code, name, description, billing_type, duration_days, stars_amount, sort_order)
VALUES
  ('00000000-0000-4000-8000-000000000007', 'premium_7d', 'Premium на 7 дней', 'Все Premium-возможности на 7 дней', 'one_time', 7, 75, 10),
  ('00000000-0000-4000-8000-000000000030', 'premium_30d', 'Premium на 30 дней', 'Все Premium-возможности на 30 дней', 'one_time', 30, 199, 20),
  ('00000000-0000-4000-8000-000000000090', 'premium_90d', 'Premium на 90 дней', 'Все Premium-возможности на 90 дней', 'one_time', 90, 499, 30),
  ('00000000-0000-4000-8000-000000003000', 'premium_subscription_30d', 'Premium ежемесячно', 'Возобновляемая подписка на 30 дней', 'subscription', 30, 179, 40);

