CREATE TABLE migration_0064_taxonomy_map (
  old_kind TEXT NOT NULL,
  old_normalized_value TEXT NOT NULL,
  canonical_value TEXT NOT NULL,
  display_value TEXT NOT NULL,
  usage_count INTEGER NOT NULL,
  last_used_at TEXT NOT NULL,
  created_at TEXT NOT NULL,
  PRIMARY KEY (old_kind, old_normalized_value)
);

WITH RECURSIVE
  pairs(step, upper_char, lower_char) AS (
    VALUES
      (1, 'А', 'а'), (2, 'Б', 'б'), (3, 'В', 'в'), (4, 'Г', 'г'),
      (5, 'Д', 'д'), (6, 'Е', 'е'), (7, 'Ё', 'ё'), (8, 'Ж', 'ж'),
      (9, 'З', 'з'), (10, 'И', 'и'), (11, 'Й', 'й'), (12, 'К', 'к'),
      (13, 'Л', 'л'), (14, 'М', 'м'), (15, 'Н', 'н'), (16, 'О', 'о'),
      (17, 'П', 'п'), (18, 'Р', 'р'), (19, 'С', 'с'), (20, 'Т', 'т'),
      (21, 'У', 'у'), (22, 'Ф', 'ф'), (23, 'Х', 'х'), (24, 'Ц', 'ц'),
      (25, 'Ч', 'ч'), (26, 'Ш', 'ш'), (27, 'Щ', 'щ'), (28, 'Ъ', 'ъ'),
      (29, 'Ы', 'ы'), (30, 'Ь', 'ь'), (31, 'Э', 'э'), (32, 'Ю', 'ю'),
      (33, 'Я', 'я')
  ),
  normalized(
    old_kind, old_normalized_value, display_value, usage_count,
    last_used_at, created_at, step, canonical_value
  ) AS (
    SELECT kind, normalized_value, display_value, usage_count,
           last_used_at, created_at, 0, lower(trim(normalized_value))
    FROM taxonomy_suggestions
    UNION ALL
    SELECT normalized.old_kind, normalized.old_normalized_value,
           normalized.display_value, normalized.usage_count,
           normalized.last_used_at, normalized.created_at, pairs.step,
           replace(normalized.canonical_value, pairs.upper_char, pairs.lower_char)
    FROM normalized
    JOIN pairs ON pairs.step = normalized.step + 1
  )
INSERT INTO migration_0064_taxonomy_map
  (old_kind, old_normalized_value, canonical_value, display_value,
   usage_count, last_used_at, created_at)
SELECT old_kind, old_normalized_value, canonical_value, display_value,
       usage_count, last_used_at, created_at
FROM normalized
WHERE step = 33;

CREATE TABLE taxonomy_suggestions_canonical (
  kind TEXT NOT NULL CHECK (kind IN (
    'language', 'fandom', 'genre', 'tag', 'hashtag',
    'plot', 'setting', 'looking_for', 'boundary'
  )),
  normalized_value TEXT NOT NULL UNIQUE,
  display_value TEXT NOT NULL,
  usage_count INTEGER NOT NULL DEFAULT 1 CHECK (usage_count >= 1),
  last_used_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (kind, normalized_value)
);

WITH ranked AS (
  SELECT source.*,
         ROW_NUMBER() OVER (
           PARTITION BY source.canonical_value
           ORDER BY (
             SELECT COUNT(*)
             FROM taxonomy_suggestion_selections selection
             WHERE selection.kind = source.old_kind
               AND selection.normalized_value = source.old_normalized_value
           ) DESC,
           source.usage_count DESC,
           source.last_used_at DESC,
           source.old_kind,
           source.old_normalized_value
         ) AS canonical_rank
  FROM migration_0064_taxonomy_map source
)
INSERT INTO taxonomy_suggestions_canonical
  (kind, normalized_value, display_value, usage_count, last_used_at, created_at)
SELECT winner.old_kind,
       winner.canonical_value,
       winner.display_value,
       (SELECT SUM(peer.usage_count)
        FROM migration_0064_taxonomy_map peer
        WHERE peer.canonical_value = winner.canonical_value),
       (SELECT MAX(peer.last_used_at)
        FROM migration_0064_taxonomy_map peer
        WHERE peer.canonical_value = winner.canonical_value),
       (SELECT MIN(peer.created_at)
        FROM migration_0064_taxonomy_map peer
        WHERE peer.canonical_value = winner.canonical_value)
FROM ranked winner
WHERE winner.canonical_rank = 1;

CREATE TABLE taxonomy_suggestion_selections_canonical (
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  kind TEXT NOT NULL CHECK (kind IN (
    'language', 'fandom', 'genre', 'tag', 'hashtag',
    'plot', 'setting', 'looking_for', 'boundary'
  )),
  normalized_value TEXT NOT NULL,
  selected_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (user_id, kind, normalized_value),
  FOREIGN KEY (kind, normalized_value)
    REFERENCES taxonomy_suggestions_canonical(kind, normalized_value) ON DELETE CASCADE
);

INSERT OR IGNORE INTO taxonomy_suggestion_selections_canonical
  (user_id, kind, normalized_value, selected_at)
SELECT selection.user_id,
       canonical.kind,
       mapping.canonical_value,
       MIN(selection.selected_at)
FROM taxonomy_suggestion_selections selection
JOIN migration_0064_taxonomy_map mapping
  ON mapping.old_kind = selection.kind
 AND mapping.old_normalized_value = selection.normalized_value
JOIN taxonomy_suggestions_canonical canonical
  ON canonical.normalized_value = mapping.canonical_value
GROUP BY selection.user_id, canonical.kind, mapping.canonical_value;

DROP TABLE taxonomy_suggestion_selections;
DROP TABLE taxonomy_suggestions;
ALTER TABLE taxonomy_suggestions_canonical RENAME TO taxonomy_suggestions;
ALTER TABLE taxonomy_suggestion_selections_canonical
  RENAME TO taxonomy_suggestion_selections;

CREATE INDEX idx_taxonomy_suggestions_rank
  ON taxonomy_suggestions(kind, usage_count DESC, last_used_at DESC);

CREATE INDEX idx_taxonomy_suggestion_selections_rank
  ON taxonomy_suggestion_selections(kind, normalized_value, selected_at DESC);

DROP TABLE migration_0064_taxonomy_map;
