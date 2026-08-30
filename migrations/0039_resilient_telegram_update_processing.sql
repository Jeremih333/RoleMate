ALTER TABLE processed_telegram_updates
ADD COLUMN state TEXT NOT NULL DEFAULT 'completed'
CHECK (state IN ('processing', 'completed'));

ALTER TABLE processed_telegram_updates
ADD COLUMN claim_token TEXT;

ALTER TABLE processed_telegram_updates
ADD COLUMN claim_expires_at TEXT;

ALTER TABLE processed_telegram_updates
ADD COLUMN completed_at TEXT;

UPDATE processed_telegram_updates
SET completed_at = processed_at
WHERE completed_at IS NULL;

CREATE INDEX idx_processed_telegram_updates_processing_lease
ON processed_telegram_updates(state, claim_expires_at);
