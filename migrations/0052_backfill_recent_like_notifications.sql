-- One recovery notification per recipient for sympathies that were persisted
-- while the Telegram outbox enqueue path was failing before the 2026-08-05 fix.
-- The fixed UTC bounds keep this immutable migration deterministic.
INSERT OR IGNORE INTO notifications
  (id, user_id, type, payload, status, scheduled_at, source_key)
SELECT lower(hex(randomblob(16))), target.id, 'telegram_activity',
       json_object('message', '💜 Ты кому-то понравился', 'openPath', '/matches'),
       'pending', CURRENT_TIMESTAMP,
       'backfill-like:' || target.id || ':2026-08-05'
FROM users target
JOIN user_settings settings ON settings.user_id = target.id
WHERE target.is_banned = 0 AND target.deleted_at IS NULL
  AND settings.notifications_enabled = 1
  AND settings.telegram_notifications_enabled = 1
  AND settings.match_notifications_enabled = 1
  AND EXISTS (
    SELECT 1 FROM swipes sympathy
    WHERE sympathy.target_user_id = target.id
      AND sympathy.action IN ('like', 'super_like')
      AND sympathy.created_at >= '2026-08-03 00:00:00'
      AND sympathy.created_at < '2026-08-05 14:39:48'
  )
  AND NOT EXISTS (
    SELECT 1 FROM web_sessions session
    WHERE session.user_id = target.id AND session.revoked_at IS NULL
      AND session.expires_at > CURRENT_TIMESTAMP
      AND session.last_seen_at >= datetime('now', '-2 minutes')
  );
