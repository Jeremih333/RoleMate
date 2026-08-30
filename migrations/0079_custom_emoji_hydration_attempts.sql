-- Bookkeeping for fetching an emoji's picture.
--
-- The queue of emoji whose bytes are not cached yet was walked at random, and a
-- file Telegram refuses to give us stayed in it for ever: it was picked again on
-- every run, spent a getFile and a download, and left its cell in the picker
-- empty anyway. Counting the attempts lets the queue prefer what has never been
-- tried, and lets a file that keeps failing rest instead of being asked for
-- again every minute, which is both why some emoji never appeared and a steady
-- drain on a daily request allowance.
ALTER TABLE custom_emoji ADD COLUMN hydration_attempts INTEGER NOT NULL DEFAULT 0;
ALTER TABLE custom_emoji ADD COLUMN hydration_attempted_at TEXT;

-- Emoji met in the wild rather than imported.
--
-- Telegram lets a client ask about any custom emoji it sees by id, whether or
-- not the reader has the set: that is how an emoji sent by somebody else shows
-- up at all, and how tapping it can offer the set. We do the same — such a set
-- is recorded so its glyphs can be drawn and looked at, but it is not part of
-- the shared library until somebody actually adds it.
ALTER TABLE custom_emoji_packs ADD COLUMN discovered INTEGER NOT NULL DEFAULT 0;
