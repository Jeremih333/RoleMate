CREATE TABLE taxonomy_suggestions_next (
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

-- Keep one deterministic owner for a value that used to occur in several rails.
INSERT INTO taxonomy_suggestions_next
  (kind, normalized_value, display_value, usage_count, last_used_at, created_at)
SELECT source.kind, source.normalized_value, source.display_value,
       source.usage_count, source.last_used_at, source.created_at
FROM taxonomy_suggestions source
WHERE NOT EXISTS (
  SELECT 1 FROM taxonomy_suggestions better
  WHERE better.normalized_value = source.normalized_value
    AND (
      better.usage_count > source.usage_count OR
      (better.usage_count = source.usage_count AND better.kind < source.kind)
    )
)
AND source.normalized_value NOT LIKE '%лоликон%'
AND source.normalized_value NOT LIKE '%шотакон%'
AND source.normalized_value NOT LIKE '%lolicon%'
AND source.normalized_value NOT LIKE '%shotacon%'
AND source.normalized_value NOT LIKE '%педоф%'
AND source.normalized_value NOT LIKE '%child porn%'
AND source.normalized_value NOT LIKE '%csam%';

DROP TABLE taxonomy_suggestions;
ALTER TABLE taxonomy_suggestions_next RENAME TO taxonomy_suggestions;

CREATE INDEX idx_taxonomy_suggestions_rank
  ON taxonomy_suggestions(kind, usage_count DESC, last_used_at DESC);

INSERT INTO taxonomy_suggestions
  (kind, normalized_value, display_value, usage_count, last_used_at)
SELECT 'looking_for', lower(trim(value)), min(trim(value)), COUNT(*), MAX(q.updated_at)
FROM questionnaires q, json_each(q.looking_for)
WHERE length(trim(value)) BETWEEN 2 AND 60
  AND lower(trim(value)) NOT LIKE '%лоликон%'
  AND lower(trim(value)) NOT LIKE '%шотакон%'
  AND lower(trim(value)) NOT LIKE '%lolicon%'
  AND lower(trim(value)) NOT LIKE '%shotacon%'
  AND NOT EXISTS (
    SELECT 1 FROM taxonomy_suggestions existing
    WHERE existing.normalized_value = lower(trim(value))
  )
GROUP BY lower(trim(value));

INSERT INTO taxonomy_suggestions
  (kind, normalized_value, display_value, usage_count, last_used_at)
SELECT 'plot', lower(trim(plots)), min(trim(plots)), COUNT(*), MAX(updated_at)
FROM questionnaires
WHERE length(trim(plots)) BETWEEN 2 AND 120
  AND instr(plots, char(10)) = 0 AND instr(plots, char(13)) = 0
  AND lower(trim(plots)) NOT LIKE '%лоликон%'
  AND lower(trim(plots)) NOT LIKE '%шотакон%'
  AND lower(trim(plots)) NOT LIKE '%lolicon%'
  AND lower(trim(plots)) NOT LIKE '%shotacon%'
  AND NOT EXISTS (
    SELECT 1 FROM taxonomy_suggestions existing
    WHERE existing.normalized_value = lower(trim(questionnaires.plots))
  )
GROUP BY lower(trim(plots));

INSERT INTO taxonomy_suggestions
  (kind, normalized_value, display_value, usage_count, last_used_at)
SELECT 'setting', lower(trim(settings)), min(trim(settings)), COUNT(*), MAX(updated_at)
FROM questionnaires
WHERE length(trim(settings)) BETWEEN 2 AND 120
  AND instr(settings, char(10)) = 0 AND instr(settings, char(13)) = 0
  AND lower(trim(settings)) NOT LIKE '%лоликон%'
  AND lower(trim(settings)) NOT LIKE '%шотакон%'
  AND lower(trim(settings)) NOT LIKE '%lolicon%'
  AND lower(trim(settings)) NOT LIKE '%shotacon%'
  AND NOT EXISTS (
    SELECT 1 FROM taxonomy_suggestions existing
    WHERE existing.normalized_value = lower(trim(questionnaires.settings))
  )
GROUP BY lower(trim(settings));

INSERT INTO taxonomy_suggestions
  (kind, normalized_value, display_value, usage_count, last_used_at)
SELECT 'boundary', lower(trim(boundaries)), min(trim(boundaries)), COUNT(*), MAX(updated_at)
FROM questionnaires
WHERE length(trim(boundaries)) BETWEEN 2 AND 120
  AND instr(boundaries, char(10)) = 0 AND instr(boundaries, char(13)) = 0
  AND lower(trim(boundaries)) NOT LIKE '%лоликон%'
  AND lower(trim(boundaries)) NOT LIKE '%шотакон%'
  AND lower(trim(boundaries)) NOT LIKE '%lolicon%'
  AND lower(trim(boundaries)) NOT LIKE '%shotacon%'
  AND NOT EXISTS (
    SELECT 1 FROM taxonomy_suggestions existing
    WHERE existing.normalized_value = lower(trim(questionnaires.boundaries))
  )
GROUP BY lower(trim(boundaries));
