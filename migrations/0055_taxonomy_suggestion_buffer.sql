CREATE TABLE taxonomy_suggestions (
  kind TEXT NOT NULL CHECK (kind IN ('language', 'fandom', 'genre', 'tag', 'hashtag')),
  normalized_value TEXT NOT NULL,
  display_value TEXT NOT NULL,
  usage_count INTEGER NOT NULL DEFAULT 1 CHECK (usage_count >= 1),
  last_used_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (kind, normalized_value)
);

CREATE INDEX idx_taxonomy_suggestions_rank
  ON taxonomy_suggestions(kind, usage_count DESC, last_used_at DESC);

INSERT INTO taxonomy_suggestions (kind, normalized_value, display_value, usage_count, last_used_at)
SELECT 'language', lower(trim(value)), min(trim(value)), COUNT(*), MAX(q.updated_at)
FROM questionnaires q, json_each(q.languages)
WHERE length(trim(value)) BETWEEN 1 AND 60
GROUP BY lower(trim(value))
ON CONFLICT(kind, normalized_value) DO UPDATE SET
  usage_count = taxonomy_suggestions.usage_count + excluded.usage_count,
  last_used_at = max(taxonomy_suggestions.last_used_at, excluded.last_used_at);

INSERT INTO taxonomy_suggestions (kind, normalized_value, display_value, usage_count, last_used_at)
SELECT 'fandom', lower(trim(value)), min(trim(value)), COUNT(*), MAX(q.updated_at)
FROM questionnaires q, json_each(q.fandoms)
WHERE length(trim(value)) BETWEEN 1 AND 100
GROUP BY lower(trim(value))
ON CONFLICT(kind, normalized_value) DO UPDATE SET
  usage_count = taxonomy_suggestions.usage_count + excluded.usage_count,
  last_used_at = max(taxonomy_suggestions.last_used_at, excluded.last_used_at);

INSERT INTO taxonomy_suggestions (kind, normalized_value, display_value, usage_count, last_used_at)
SELECT 'genre', lower(trim(value)), min(trim(value)), COUNT(*), MAX(q.updated_at)
FROM questionnaires q, json_each(q.genres)
WHERE length(trim(value)) BETWEEN 1 AND 60
GROUP BY lower(trim(value))
ON CONFLICT(kind, normalized_value) DO UPDATE SET
  usage_count = taxonomy_suggestions.usage_count + excluded.usage_count,
  last_used_at = max(taxonomy_suggestions.last_used_at, excluded.last_used_at);

INSERT INTO taxonomy_suggestions (kind, normalized_value, display_value, usage_count, last_used_at)
SELECT 'tag', lower(trim(value)), min(trim(value)), COUNT(*), MAX(q.updated_at)
FROM questionnaires q, json_each(q.tags)
WHERE length(trim(value)) BETWEEN 1 AND 60
GROUP BY lower(trim(value))
ON CONFLICT(kind, normalized_value) DO UPDATE SET
  usage_count = taxonomy_suggestions.usage_count + excluded.usage_count,
  last_used_at = max(taxonomy_suggestions.last_used_at, excluded.last_used_at);

INSERT INTO taxonomy_suggestions (kind, normalized_value, display_value, usage_count, last_used_at)
SELECT 'fandom', lower(trim(value)), min(trim(value)), COUNT(*), MAX(p.updated_at)
FROM telegram_posts p, json_each(p.fandoms)
WHERE p.status = 'active' AND length(trim(value)) BETWEEN 1 AND 100
GROUP BY lower(trim(value))
ON CONFLICT(kind, normalized_value) DO UPDATE SET
  usage_count = taxonomy_suggestions.usage_count + excluded.usage_count,
  last_used_at = max(taxonomy_suggestions.last_used_at, excluded.last_used_at);

INSERT INTO taxonomy_suggestions (kind, normalized_value, display_value, usage_count, last_used_at)
SELECT 'tag', lower(trim(value)), min(trim(value)), COUNT(*), MAX(p.updated_at)
FROM telegram_posts p, json_each(p.tags)
WHERE p.status = 'active' AND length(trim(value)) BETWEEN 1 AND 60
GROUP BY lower(trim(value))
ON CONFLICT(kind, normalized_value) DO UPDATE SET
  usage_count = taxonomy_suggestions.usage_count + excluded.usage_count,
  last_used_at = max(taxonomy_suggestions.last_used_at, excluded.last_used_at);

INSERT INTO taxonomy_suggestions (kind, normalized_value, display_value, usage_count, last_used_at)
SELECT 'hashtag', lower(trim(value, '# ')), min(trim(value, '# ')), COUNT(*), MAX(p.updated_at)
FROM telegram_posts p, json_each(p.hashtags)
WHERE p.status = 'active' AND length(trim(value, '# ')) BETWEEN 1 AND 60
GROUP BY lower(trim(value, '# '))
ON CONFLICT(kind, normalized_value) DO UPDATE SET
  usage_count = taxonomy_suggestions.usage_count + excluded.usage_count,
  last_used_at = max(taxonomy_suggestions.last_used_at, excluded.last_used_at);
