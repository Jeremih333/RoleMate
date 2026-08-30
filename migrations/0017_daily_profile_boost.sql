-- A free Premium boost is available once per day and remains prioritized for that period.
INSERT INTO app_config (key, value, updated_at)
VALUES ('boost_cooldown_days', '1', CURRENT_TIMESTAMP)
ON CONFLICT(key) DO UPDATE SET
  value = excluded.value,
  updated_at = CURRENT_TIMESTAMP;
