ALTER TABLE notifications ADD COLUMN source_key TEXT;

ALTER TABLE notifications ADD COLUMN claim_token TEXT;

ALTER TABLE notifications ADD COLUMN last_error_code TEXT;

ALTER TABLE notifications ADD COLUMN last_error_at TEXT;

CREATE UNIQUE INDEX idx_notifications_source_key
ON notifications(source_key)
WHERE source_key IS NOT NULL;

CREATE INDEX idx_notifications_telegram_claim
ON notifications(type, status, scheduled_at, created_at);
