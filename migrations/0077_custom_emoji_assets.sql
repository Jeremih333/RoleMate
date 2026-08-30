-- Cached bytes for custom emoji.
--
-- Rendering a picker of a few hundred glyphs used to mean a getFile call and a
-- download per glyph, which is hundreds of Telegram API calls in one burst: the
-- API throttles, and the pictures stop arriving. Each asset is fetched once and
-- kept here, so a glyph costs one small row read afterwards and Telegram is
-- touched once per emoji for the life of the pack.
--
-- Base64 rather than a BLOB: the data crosses a JSON service binding between the
-- workers, and text needs no conversion at either end.
CREATE TABLE IF NOT EXISTS custom_emoji_assets (
  custom_emoji_id TEXT NOT NULL REFERENCES custom_emoji(custom_emoji_id) ON DELETE CASCADE,
  -- 'thumbnail' is the still image every emoji has; 'animation' is the playable
  -- payload (a Lottie document for TGS, the video itself for WEBM).
  kind TEXT NOT NULL CHECK (kind IN ('thumbnail', 'animation')),
  content_type TEXT NOT NULL,
  data_base64 TEXT NOT NULL,
  byte_size INTEGER NOT NULL,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (custom_emoji_id, kind)
);
