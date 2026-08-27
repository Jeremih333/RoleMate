CREATE TABLE media_upload_intents (
  user_id TEXT PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
  target_type TEXT NOT NULL CHECK (target_type IN ('profile', 'questionnaire')),
  questionnaire_id TEXT REFERENCES questionnaires(id) ON DELETE CASCADE,
  expires_at TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CHECK (
    (target_type = 'profile' AND questionnaire_id IS NULL)
    OR (target_type = 'questionnaire' AND questionnaire_id IS NOT NULL)
  )
);

CREATE INDEX idx_media_upload_intents_expiry
ON media_upload_intents(expires_at);
