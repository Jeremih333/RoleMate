-- One-level YouTube-like replies and independent comment ratings.

ALTER TABLE post_comments
  ADD COLUMN parent_comment_id TEXT REFERENCES post_comments(id) ON DELETE CASCADE;

CREATE INDEX idx_post_comments_parent
  ON post_comments(parent_comment_id, status, created_at);

CREATE TABLE post_comment_ratings (
  comment_id TEXT NOT NULL REFERENCES post_comments(id) ON DELETE CASCADE,
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  value INTEGER NOT NULL CHECK (value IN (-1, 1)),
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (comment_id, user_id)
);

CREATE INDEX idx_post_comment_ratings_score
  ON post_comment_ratings(comment_id, value);
