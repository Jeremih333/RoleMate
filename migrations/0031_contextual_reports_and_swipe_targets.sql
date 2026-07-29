-- Bind questionnaire reactions and moderation reports to the exact visible entity.

ALTER TABLE swipes ADD COLUMN questionnaire_id TEXT REFERENCES questionnaires(id);

ALTER TABLE reports ADD COLUMN questionnaire_id TEXT REFERENCES questionnaires(id);
ALTER TABLE reports ADD COLUMN comment_id TEXT REFERENCES post_comments(id);

UPDATE swipes
SET questionnaire_id = (
  SELECT q.id
  FROM questionnaires q
  WHERE q.user_id = swipes.target_user_id
    AND q.is_primary = 1
  LIMIT 1
)
WHERE questionnaire_id IS NULL;

INSERT INTO questionnaire_ratings (questionnaire_id, user_id, value, created_at, updated_at)
SELECT s.questionnaire_id, s.actor_user_id,
       CASE WHEN s.action = 'skip' THEN -1 ELSE 1 END,
       s.created_at, s.created_at
FROM swipes s
WHERE s.questionnaire_id IS NOT NULL
  AND s.action IN ('skip', 'like', 'super_like')
  AND NOT EXISTS (
    SELECT 1
    FROM swipes newer
    WHERE newer.actor_user_id = s.actor_user_id
      AND newer.target_user_id = s.target_user_id
      AND newer.action IN ('skip', 'like', 'super_like')
      AND (
        newer.created_at > s.created_at
        OR (newer.created_at = s.created_at AND newer.id > s.id)
      )
  )
ON CONFLICT(questionnaire_id, user_id) DO UPDATE SET
  value = excluded.value,
  updated_at = excluded.updated_at;

CREATE INDEX idx_reports_questionnaire ON reports(questionnaire_id, status, created_at);
CREATE INDEX idx_reports_comment ON reports(comment_id, status, created_at);
CREATE INDEX idx_swipes_questionnaire ON swipes(questionnaire_id, actor_user_id);
