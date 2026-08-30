ALTER TABLE payment_orders
ADD COLUMN gift_recipient_user_id TEXT REFERENCES users(id);

CREATE INDEX idx_payment_gift_recipient
ON payment_orders (gift_recipient_user_id, status, created_at);
