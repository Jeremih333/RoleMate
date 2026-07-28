PRAGMA foreign_keys = ON;

CREATE TABLE users (
  id TEXT PRIMARY KEY,
  telegram_user_id INTEGER NOT NULL UNIQUE,
  telegram_username TEXT,
  telegram_first_name TEXT NOT NULL,
  telegram_language_code TEXT,
  status TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'paused', 'deleted')),
  role TEXT NOT NULL DEFAULT 'user' CHECK (role IN ('user', 'admin')),
  is_bot INTEGER NOT NULL DEFAULT 0 CHECK (is_bot IN (0, 1)),
  is_verified INTEGER NOT NULL DEFAULT 0 CHECK (is_verified IN (0, 1)),
  is_onboarding_completed INTEGER NOT NULL DEFAULT 0 CHECK (is_onboarding_completed IN (0, 1)),
  is_age_confirmed INTEGER NOT NULL DEFAULT 0 CHECK (is_age_confirmed IN (0, 1)),
  is_rules_accepted INTEGER NOT NULL DEFAULT 0 CHECK (is_rules_accepted IN (0, 1)),
  is_search_enabled INTEGER NOT NULL DEFAULT 0 CHECK (is_search_enabled IN (0, 1)),
  is_banned INTEGER NOT NULL DEFAULT 0 CHECK (is_banned IN (0, 1)),
  ban_reason TEXT,
  banned_until TEXT,
  risk_score INTEGER NOT NULL DEFAULT 0 CHECK (risk_score BETWEEN 0 AND 100),
  last_activity_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  last_seen_at TEXT,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  deleted_at TEXT
);

CREATE TABLE user_settings (
  user_id TEXT PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
  language TEXT NOT NULL DEFAULT 'ru',
  notifications_enabled INTEGER NOT NULL DEFAULT 1,
  match_notifications_enabled INTEGER NOT NULL DEFAULT 1,
  message_notifications_enabled INTEGER NOT NULL DEFAULT 1,
  referral_notifications_enabled INTEGER NOT NULL DEFAULT 1,
  premium_notifications_enabled INTEGER NOT NULL DEFAULT 1,
  anonymous_mode INTEGER NOT NULL DEFAULT 1,
  privacy_shield_enabled INTEGER NOT NULL DEFAULT 1,
  show_online_status INTEGER NOT NULL DEFAULT 1,
  show_premium_badge INTEGER NOT NULL DEFAULT 1,
  theme TEXT NOT NULL DEFAULT 'telegram',
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE processed_telegram_updates (
  update_id INTEGER PRIMARY KEY,
  processed_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE notifications (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  type TEXT NOT NULL,
  payload TEXT NOT NULL DEFAULT '{}',
  status TEXT NOT NULL DEFAULT 'pending',
  scheduled_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  sent_at TEXT,
  attempts INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE feature_flags (
  key TEXT PRIMARY KEY,
  enabled INTEGER NOT NULL DEFAULT 0 CHECK (enabled IN (0, 1)),
  payload TEXT NOT NULL DEFAULT '{}',
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE app_config (
  key TEXT PRIMARY KEY,
  value TEXT NOT NULL,
  is_public INTEGER NOT NULL DEFAULT 0,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE admin_audit_logs (
  id TEXT PRIMARY KEY,
  admin_user_id TEXT REFERENCES users(id),
  target_user_id TEXT REFERENCES users(id),
  action TEXT NOT NULL,
  reason TEXT,
  old_state TEXT,
  new_state TEXT,
  request_id TEXT NOT NULL,
  ip_signal_hash TEXT,
  user_agent TEXT,
  result TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE background_jobs (
  id TEXT PRIMARY KEY,
  type TEXT NOT NULL,
  payload TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'pending',
  attempts INTEGER NOT NULL DEFAULT 0,
  run_after TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  locked_at TEXT,
  completed_at TEXT,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE job_failures (
  id TEXT PRIMARY KEY,
  job_id TEXT NOT NULL REFERENCES background_jobs(id),
  error_code TEXT NOT NULL,
  safe_message TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE web_sessions (
  id_hash TEXT PRIMARY KEY,
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  csrf_hash TEXT NOT NULL,
  expires_at TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  last_seen_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  revoked_at TEXT
);

CREATE TABLE refresh_tokens (
  id_hash TEXT PRIMARY KEY,
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  expires_at TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  revoked_at TEXT
);

CREATE TABLE api_nonces (
  nonce_hash TEXT PRIMARY KEY,
  service_id TEXT NOT NULL,
  expires_at TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE schema_migrations (
  version TEXT PRIMARY KEY,
  checksum TEXT NOT NULL,
  applied_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX idx_users_status_search ON users(status, is_banned, is_search_enabled);
CREATE INDEX idx_users_activity ON users(last_activity_at);
CREATE INDEX idx_notifications_delivery ON notifications(status, scheduled_at);
CREATE INDEX idx_jobs_delivery ON background_jobs(status, run_after);
CREATE INDEX idx_sessions_user_expiry ON web_sessions(user_id, expires_at);
CREATE INDEX idx_nonces_expiry ON api_nonces(expires_at);

INSERT INTO feature_flags (key, enabled) VALUES
  ('yookassa', 0),
  ('yookassa_digital_premium', 0),
  ('maintenance_mode', 0);

