-- Buying a listed gift with Telegram Stars.
--
-- Premium orders live in payment_orders, and every one of them points at a row
-- in products: a gift is not a product, it is one numbered copy that belongs to
-- somebody. Bending the premium table to hold it would mean inventing a product
-- per copy, so a gift purchase gets its own small table instead, with the same
-- shape the payment flow needs — a payload Telegram carries, and a status that
-- moves once and only once.
--
-- What the money buys is a transfer, and that transfer goes through the same
-- signed path as any other, so the chain of ownership stays whole.

CREATE TABLE gift_purchases (
  id TEXT PRIMARY KEY,
  listing_id TEXT NOT NULL REFERENCES gift_listings(id) ON DELETE CASCADE,
  item_id TEXT NOT NULL REFERENCES gift_items(id) ON DELETE CASCADE,
  buyer_user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  seller_user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  star_amount INTEGER NOT NULL CHECK (star_amount > 0),
  invoice_payload TEXT NOT NULL UNIQUE,
  telegram_payment_charge_id TEXT UNIQUE,
  status TEXT NOT NULL DEFAULT 'pending'
    CHECK (status IN ('pending', 'paid', 'cancelled', 'failed')),
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  paid_at TEXT
);

CREATE INDEX idx_gift_purchases_buyer ON gift_purchases(buyer_user_id, status, created_at DESC);
CREATE INDEX idx_gift_purchases_listing ON gift_purchases(listing_id, status);
