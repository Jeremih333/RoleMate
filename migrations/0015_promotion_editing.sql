ALTER TABLE promotions ADD COLUMN deleted_at TEXT;

ALTER TABLE promo_redemptions
ADD COLUMN discount_stars_snapshot INTEGER NOT NULL DEFAULT 0;
ALTER TABLE promo_redemptions
ADD COLUMN discount_rubles_snapshot INTEGER NOT NULL DEFAULT 0;
ALTER TABLE promo_redemptions
ADD COLUMN eligible_product_ids_snapshot TEXT NOT NULL DEFAULT '[]';

UPDATE promo_redemptions
SET discount_stars_snapshot = (
      SELECT discount_stars FROM promotions
      WHERE promotions.id = promo_redemptions.promotion_id
    ),
    discount_rubles_snapshot = (
      SELECT discount_rubles FROM promotions
      WHERE promotions.id = promo_redemptions.promotion_id
    ),
    eligible_product_ids_snapshot = (
      SELECT eligible_product_ids FROM promotions
      WHERE promotions.id = promo_redemptions.promotion_id
    )
WHERE kind = 'discount';

CREATE INDEX idx_promotions_visible
ON promotions (deleted_at, created_at);
