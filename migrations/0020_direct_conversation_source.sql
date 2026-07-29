-- Direct chats are active conversations, not false reciprocal matches.
ALTER TABLE matches ADD COLUMN source TEXT NOT NULL DEFAULT 'mutual'
  CHECK (source IN ('mutual', 'direct'));

CREATE INDEX idx_matches_user_source
  ON matches(source, user_a_id, user_b_id, matched_at);
