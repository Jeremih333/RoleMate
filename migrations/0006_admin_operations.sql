CREATE TABLE broadcasts (
  id TEXT PRIMARY KEY,
  created_by_user_id TEXT NOT NULL REFERENCES users(id),
  title TEXT NOT NULL,
  message TEXT NOT NULL,
  segment TEXT NOT NULL CHECK (segment IN ('all', 'active', 'premium', 'nonpremium')),
  status TEXT NOT NULL DEFAULT 'draft'
    CHECK (status IN ('draft', 'queued', 'running', 'paused', 'completed', 'cancelled')),
  rate_limit_per_second INTEGER NOT NULL DEFAULT 20 CHECK (rate_limit_per_second BETWEEN 1 AND 30),
  estimated_recipients INTEGER NOT NULL DEFAULT 0,
  sent_count INTEGER NOT NULL DEFAULT 0,
  failed_count INTEGER NOT NULL DEFAULT 0,
  dry_run_at TEXT,
  queued_at TEXT,
  started_at TEXT,
  paused_at TEXT,
  completed_at TEXT,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE broadcast_deliveries (
  id TEXT PRIMARY KEY,
  broadcast_id TEXT NOT NULL REFERENCES broadcasts(id) ON DELETE CASCADE,
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  status TEXT NOT NULL DEFAULT 'pending'
    CHECK (status IN ('pending', 'sending', 'sent', 'failed', 'skipped')),
  attempts INTEGER NOT NULL DEFAULT 0,
  error_code TEXT,
  safe_message TEXT,
  sent_at TEXT,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  UNIQUE(broadcast_id, user_id)
);

CREATE INDEX idx_broadcasts_status_created ON broadcasts(status, created_at);
CREATE INDEX idx_broadcast_deliveries_queue
  ON broadcast_deliveries(broadcast_id, status, created_at);
