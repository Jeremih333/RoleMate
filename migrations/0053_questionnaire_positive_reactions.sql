CREATE TABLE questionnaire_positive_reactions (
  actor_user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  questionnaire_id TEXT NOT NULL REFERENCES questionnaires(id) ON DELETE CASCADE,
  target_user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  action TEXT NOT NULL CHECK (action IN ('like', 'super_like')),
  idempotency_key TEXT NOT NULL UNIQUE,
  first_swipe_id TEXT,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (actor_user_id, questionnaire_id),
  CHECK (actor_user_id <> target_user_id)
);

-- Preserve every historical swipe while establishing one canonical positive
-- reaction per actor/questionnaire for future writes.
INSERT OR IGNORE INTO questionnaire_positive_reactions (
  actor_user_id,
  questionnaire_id,
  target_user_id,
  action,
  idempotency_key,
  first_swipe_id,
  created_at
)
SELECT
  swipe.actor_user_id,
  swipe.questionnaire_id,
  swipe.target_user_id,
  swipe.action,
  swipe.idempotency_key,
  swipe.id,
  swipe.created_at
FROM swipes swipe
WHERE swipe.questionnaire_id IS NOT NULL
  AND swipe.action IN ('like', 'super_like')
ORDER BY swipe.created_at, swipe.id;

CREATE INDEX idx_questionnaire_positive_reactions_target
  ON questionnaire_positive_reactions(target_user_id, created_at DESC);
