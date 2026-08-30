-- Structured discovery metadata and non-destructive reach moderation for posts.

ALTER TABLE telegram_posts ADD COLUMN tags TEXT NOT NULL DEFAULT '[]';
ALTER TABLE telegram_posts ADD COLUMN fandoms TEXT NOT NULL DEFAULT '[]';
ALTER TABLE telegram_posts ADD COLUMN hashtags TEXT NOT NULL DEFAULT '[]';
ALTER TABLE telegram_posts
  ADD COLUMN reach_status TEXT NOT NULL DEFAULT 'normal'
    CHECK (reach_status IN ('normal', 'limited', 'shadow_banned'));

CREATE INDEX idx_telegram_posts_reach
  ON telegram_posts(status, reach_status, published_at DESC);
