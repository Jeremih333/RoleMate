CREATE TABLE taxonomy_suggestion_selections (
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  kind TEXT NOT NULL CHECK (kind IN (
    'language', 'fandom', 'genre', 'tag', 'hashtag',
    'plot', 'setting', 'looking_for', 'boundary'
  )),
  normalized_value TEXT NOT NULL,
  selected_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (user_id, kind, normalized_value),
  FOREIGN KEY (kind, normalized_value)
    REFERENCES taxonomy_suggestions(kind, normalized_value) ON DELETE CASCADE
);

CREATE INDEX idx_taxonomy_suggestion_selections_rank
  ON taxonomy_suggestion_selections(kind, normalized_value, selected_at DESC);

-- Seed the popularity model from distinct choices in active, published questionnaires.
INSERT OR IGNORE INTO taxonomy_suggestion_selections (user_id, kind, normalized_value)
SELECT q.user_id, 'language', suggestion.normalized_value
FROM questionnaires q
JOIN json_each(q.languages) choice
JOIN taxonomy_suggestions suggestion
  ON suggestion.kind = 'language'
 AND suggestion.normalized_value = lower(trim(choice.value))
WHERE q.is_active = 1 AND q.moderation_status = 'approved';

INSERT OR IGNORE INTO taxonomy_suggestion_selections (user_id, kind, normalized_value)
SELECT q.user_id, 'fandom', suggestion.normalized_value
FROM questionnaires q
JOIN json_each(q.fandoms) choice
JOIN taxonomy_suggestions suggestion
  ON suggestion.kind = 'fandom'
 AND suggestion.normalized_value = lower(trim(choice.value))
WHERE q.is_active = 1 AND q.moderation_status = 'approved';

INSERT OR IGNORE INTO taxonomy_suggestion_selections (user_id, kind, normalized_value)
SELECT q.user_id, 'genre', suggestion.normalized_value
FROM questionnaires q
JOIN json_each(q.genres) choice
JOIN taxonomy_suggestions suggestion
  ON suggestion.kind = 'genre'
 AND suggestion.normalized_value = lower(trim(choice.value))
WHERE q.is_active = 1 AND q.moderation_status = 'approved';

INSERT OR IGNORE INTO taxonomy_suggestion_selections (user_id, kind, normalized_value)
SELECT q.user_id, 'tag', suggestion.normalized_value
FROM questionnaires q
JOIN json_each(q.tags) choice
JOIN taxonomy_suggestions suggestion
  ON suggestion.kind = 'tag'
 AND suggestion.normalized_value = lower(trim(choice.value))
WHERE q.is_active = 1 AND q.moderation_status = 'approved';

INSERT OR IGNORE INTO taxonomy_suggestion_selections (user_id, kind, normalized_value)
SELECT q.user_id, 'looking_for', suggestion.normalized_value
FROM questionnaires q
JOIN json_each(q.looking_for) choice
JOIN taxonomy_suggestions suggestion
  ON suggestion.kind = 'looking_for'
 AND suggestion.normalized_value = lower(trim(choice.value))
WHERE q.is_active = 1 AND q.moderation_status = 'approved';

-- Active posts also represent deliberate taxonomy choices made by their authors.
INSERT OR IGNORE INTO taxonomy_suggestion_selections (user_id, kind, normalized_value)
SELECT post.author_user_id, 'fandom', suggestion.normalized_value
FROM telegram_posts post
JOIN json_each(post.fandoms) choice
JOIN taxonomy_suggestions suggestion
  ON suggestion.kind = 'fandom'
 AND suggestion.normalized_value = lower(trim(choice.value))
WHERE post.status = 'active';

INSERT OR IGNORE INTO taxonomy_suggestion_selections (user_id, kind, normalized_value)
SELECT post.author_user_id, 'tag', suggestion.normalized_value
FROM telegram_posts post
JOIN json_each(post.tags) choice
JOIN taxonomy_suggestions suggestion
  ON suggestion.kind = 'tag'
 AND suggestion.normalized_value = lower(trim(choice.value))
WHERE post.status = 'active';

INSERT OR IGNORE INTO taxonomy_suggestion_selections (user_id, kind, normalized_value)
SELECT post.author_user_id, 'hashtag', suggestion.normalized_value
FROM telegram_posts post
JOIN json_each(post.hashtags) choice
JOIN taxonomy_suggestions suggestion
  ON suggestion.kind = 'hashtag'
 AND suggestion.normalized_value = lower(trim(choice.value, '# '))
WHERE post.status = 'active';
