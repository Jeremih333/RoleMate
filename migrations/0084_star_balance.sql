-- A balance of Telegram Stars inside the app.
--
-- Everything here is bought and sold in Stars, and Stars arrive one way: a
-- person tops their balance up through Telegram's own payment. What the balance
-- then does is instant and internal — buying a listed gift, settling an offer —
-- so a trade between two people does not need a payment between them, only a
-- move from one balance to the other.
--
-- Balances are the kind of thing that must add up, so:
--
--   * a balance can never go below zero, and the database says so rather than
--     the code that spends it;
--   * every movement is written into a ledger that is appended to and never
--     rewritten, each entry signed over the one before it, the same way the gift
--     ledger is - so the balance can always be recomputed from its history and
--     checked against what is stored;
--   * a top-up is settled once, by its payment's charge id, so a webhook
--     delivered twice credits nothing twice.
--
-- Withdrawal is a refund of that person's own top-ups. A bot cannot send Stars
-- to somebody; what Telegram allows is returning a payment to whoever made it,
-- which is exactly what taking your own Stars back out means here. Nothing else
-- would be safe: paying out of a shared pot would let one person withdraw
-- another person's money.

CREATE TABLE star_balances (
  user_id TEXT PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
  balance INTEGER NOT NULL DEFAULT 0 CHECK (balance >= 0),
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE star_ledger (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  -- Positive when stars come in, negative when they go out.
  delta INTEGER NOT NULL CHECK (delta <> 0),
  reason TEXT NOT NULL CHECK (reason IN ('topup', 'purchase', 'sale', 'withdrawal', 'offer')),
  ref_id TEXT,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  prev_hash TEXT NOT NULL,
  hash TEXT NOT NULL UNIQUE
);

CREATE INDEX idx_star_ledger_user ON star_ledger(user_id, created_at DESC);

CREATE TRIGGER star_ledger_is_final
BEFORE UPDATE ON star_ledger
BEGIN
  SELECT RAISE(ABORT, 'the star ledger cannot be rewritten');
END;

CREATE TRIGGER star_ledger_is_permanent
BEFORE DELETE ON star_ledger
BEGIN
  SELECT RAISE(ABORT, 'the star ledger cannot be erased');
END;

CREATE TABLE star_topups (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  stars INTEGER NOT NULL CHECK (stars > 0),
  invoice_payload TEXT NOT NULL UNIQUE,
  telegram_payment_charge_id TEXT UNIQUE,
  status TEXT NOT NULL DEFAULT 'pending'
    CHECK (status IN ('pending', 'paid', 'refunded', 'cancelled')),
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  paid_at TEXT,
  refunded_at TEXT
);

CREATE INDEX idx_star_topups_user ON star_topups(user_id, status, paid_at);

-- Taking stars back out: a request, and the top-ups it returns.
CREATE TABLE star_withdrawals (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  stars INTEGER NOT NULL CHECK (stars > 0),
  status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'sent', 'failed')),
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  completed_at TEXT
);

CREATE TABLE star_withdrawal_items (
  withdrawal_id TEXT NOT NULL REFERENCES star_withdrawals(id) ON DELETE CASCADE,
  topup_id TEXT NOT NULL REFERENCES star_topups(id) ON DELETE CASCADE,
  stars INTEGER NOT NULL CHECK (stars > 0),
  PRIMARY KEY (withdrawal_id, topup_id)
);

CREATE INDEX idx_star_withdrawals_user ON star_withdrawals(user_id, status, created_at DESC);
