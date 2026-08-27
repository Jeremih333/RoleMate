-- "Готов общаться сейчас": a self-declared window during which the user wants to
-- be approached. It expires on its own so nobody is left permanently marked as
-- available after they close the app.
ALTER TABLE users ADD COLUMN ready_to_chat_until TEXT;

-- Discovery orders by this before comparing interests, so the lookup has to be
-- indexable rather than a scan over every candidate.
CREATE INDEX IF NOT EXISTS idx_users_ready_to_chat ON users(ready_to_chat_until);

-- A match where neither side ever wrote is closed automatically, and the closing
-- pass records the reason so the sweep can tell its own work from a user closing
-- a chat by hand and never re-notifies about the same conversation.
ALTER TABLE conversations ADD COLUMN closed_reason TEXT;

-- The sweep looks for old conversations that are still open; this is the shape of
-- that query.
CREATE INDEX IF NOT EXISTS idx_conversations_status_created
  ON conversations(status, created_at);
