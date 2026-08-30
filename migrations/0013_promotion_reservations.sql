-- Promotion activations are permanent; only the invoice reservation is released on expiry.
-- Prevent concurrent requests from reserving one activated discount in multiple live orders.

CREATE UNIQUE INDEX payment_orders_one_live_promo_order
ON payment_orders (user_id, promotion_id)
WHERE promotion_id IS NOT NULL
  AND status IN ('pending', 'precheckout_approved', 'paid');
