-- Telegram lets you clear a message from your own copy of a chat without taking
-- it away from the other person. deleted_at is global, so per-user removal needs
-- its own record.
CREATE TABLE IF NOT EXISTS conversation_message_hides (
  message_id TEXT NOT NULL REFERENCES conversation_messages(id) ON DELETE CASCADE,
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  hidden_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (message_id, user_id)
);

-- Every message read path filters on this, so the lookup must be a point read.
CREATE INDEX IF NOT EXISTS idx_conversation_message_hides_user
  ON conversation_message_hides(user_id, message_id);

-- The scheduled payment sweep filters by status and expiry; the existing index
-- leads with user_id and cannot serve it, so the sweep scanned the table.
CREATE INDEX IF NOT EXISTS idx_payment_orders_expiry
  ON payment_orders(status, expires_at);

-- Counting post views was a full scan: nothing indexed post_id on its own.
CREATE INDEX IF NOT EXISTS idx_telegram_post_views_post
  ON telegram_post_views(post_id);

-- The feed joins reposts by the reposting post five times over.
CREATE INDEX IF NOT EXISTS idx_post_reposts_repost
  ON post_reposts(repost_post_id);
