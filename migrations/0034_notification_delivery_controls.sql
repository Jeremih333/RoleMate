ALTER TABLE user_settings
  ADD COLUMN telegram_notifications_enabled INTEGER NOT NULL DEFAULT 1
    CHECK (telegram_notifications_enabled IN (0, 1));
