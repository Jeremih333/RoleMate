-- Privacy-preserving anti-abuse ledger. identity_hash is an HMAC generated in the Worker;
-- raw Telegram IDs are never stored here.
CREATE TABLE referral_identity_claims (
  identity_hash TEXT PRIMARY KEY,
  status TEXT NOT NULL CHECK (status IN ('pending', 'qualified', 'ineligible')),
  referral_id TEXT,
  qualified_at TEXT,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX idx_referral_identity_claims_status
  ON referral_identity_claims(status, created_at);
