-- Telegram lets people tint their profile header and set a background emoji.
-- Both are decoration only and are gated behind Premium in this product, so they
-- live next to the other presentation fields rather than in a separate table.
--
-- accent_color stores an index into a fixed palette rather than a free-form hex
-- value: the palette is chosen to stay readable on both themes, and an arbitrary
-- colour from a user could not guarantee that.
ALTER TABLE user_profiles ADD COLUMN accent_color INTEGER;
ALTER TABLE user_profiles ADD COLUMN header_emoji TEXT;
