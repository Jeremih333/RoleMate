CREATE TABLE referral_codes (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL UNIQUE REFERENCES users(id) ON DELETE CASCADE,
  code TEXT NOT NULL UNIQUE,
  is_active INTEGER NOT NULL DEFAULT 1,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE referrals (
  id TEXT PRIMARY KEY,
  referrer_user_id TEXT NOT NULL REFERENCES users(id),
  referred_user_id TEXT NOT NULL UNIQUE REFERENCES users(id),
  referral_code TEXT NOT NULL REFERENCES referral_codes(code),
  status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'qualified', 'rejected')),
  qualification_reason TEXT,
  qualified_at TEXT,
  reward_grant_id TEXT UNIQUE REFERENCES premium_grants(id),
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  UNIQUE(referrer_user_id, referred_user_id),
  CHECK(referrer_user_id <> referred_user_id)
);

CREATE INDEX idx_referrals_referrer_status ON referrals(referrer_user_id, status, created_at);
CREATE INDEX idx_referrals_code ON referrals(referral_code);

