ALTER TABLE media_upload_intents ADD COLUMN media_kind TEXT NOT NULL DEFAULT 'any'
  CHECK (media_kind IN ('any', 'visual', 'music'));
