-- Telegram custom (premium) emoji packs imported through a t.me/addemoji link.
--
-- A pack is stored once and shared by everyone: the files live in Telegram and
-- are addressed by file id, so importing the same pack twice costs nothing and
-- every viewer benefits from the same cached assets. Only the membership row is
-- per user, which is what the picker reads.
CREATE TABLE IF NOT EXISTS custom_emoji_packs (
  id TEXT PRIMARY KEY,
  set_name TEXT NOT NULL UNIQUE,
  title TEXT NOT NULL,
  emoji_count INTEGER NOT NULL DEFAULT 0,
  -- Whether every emoji in the pack is repaintable; a pack of mixed emoji is 0.
  monochrome_count INTEGER NOT NULL DEFAULT 0,
  imported_by_user_id TEXT REFERENCES users(id) ON DELETE SET NULL,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS custom_emoji (
  custom_emoji_id TEXT PRIMARY KEY,
  pack_id TEXT NOT NULL REFERENCES custom_emoji_packs(id) ON DELETE CASCADE,
  emoji TEXT NOT NULL DEFAULT '',
  file_id TEXT NOT NULL,
  thumbnail_file_id TEXT,
  -- 'static' renders as an image, 'video' plays as a looping WEBM, 'lottie' is a
  -- TGS whose still thumbnail is shown instead of running a Lottie player.
  render_kind TEXT NOT NULL DEFAULT 'static'
    CHECK (render_kind IN ('static', 'video', 'lottie')),
  -- Telegram's needs_repainting: the emoji is a single-colour glyph meant to be
  -- painted in the surrounding text colour. Only these may decorate a header.
  needs_repainting INTEGER NOT NULL DEFAULT 0 CHECK (needs_repainting IN (0, 1)),
  file_size_bytes INTEGER,
  position INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS idx_custom_emoji_pack ON custom_emoji(pack_id, position);
CREATE INDEX IF NOT EXISTS idx_custom_emoji_repaint ON custom_emoji(needs_repainting, pack_id);

CREATE TABLE IF NOT EXISTS user_custom_emoji_packs (
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  pack_id TEXT NOT NULL REFERENCES custom_emoji_packs(id) ON DELETE CASCADE,
  added_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (user_id, pack_id)
);

-- A reaction is either one of the built-in keys or a custom emoji. The existing
-- CHECK on reaction allows at most sixteen characters, far short of a Telegram
-- custom emoji id, so the id travels in a column of its own and the marker stays
-- inside the constraint.
ALTER TABLE conversation_message_reactions ADD COLUMN custom_emoji_id TEXT;

-- The repaintable emoji chosen for the profile header, when there is one.
ALTER TABLE user_profiles ADD COLUMN header_custom_emoji_id TEXT;
