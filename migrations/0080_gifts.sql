-- Gifts: limited series, and the ledger that makes the limit real.
--
-- The product needs what Telegram calls collectible gifts: a gift belongs to a
-- series with a fixed circulation, every copy carries its own number out of that
-- circulation, it has an owner, and it can change hands. Telegram's own model is
-- the one being followed here — a collectible carries a model, a pattern and a
-- backdrop, each with a rarity measured per thousand, plus its number and the
-- size of the issue (core.telegram.org/constructor/starGiftUnique).
--
-- The hard requirement is that nobody can change how many exist. Three things
-- together make that true rather than merely intended:
--
--   * the circulation is written once and a trigger refuses any change to it,
--     so not even an operator with the admin API can quietly print more;
--   * a copy's number is unique within its series and must fall inside the
--     circulation, so the numbers cannot overflow the issue;
--   * every copy and every transfer carries a signature over the record and the
--     signature before it. The chain is what a blockchain is for: a record
--     altered later no longer matches, and the break is visible from the next
--     link onwards. The key lives in the worker's secrets, not in the database.
--
-- Standard gifts — the animated emoji ones — live in the same tables with an
-- unlimited circulation, so one path serves both.

CREATE TABLE gift_collections (
  id TEXT PRIMARY KEY,
  code TEXT NOT NULL UNIQUE,
  title TEXT NOT NULL,
  -- 'unique' gifts are numbered and limited; 'standard' ones are the animated
  -- emoji anybody can send as many times as they like.
  kind TEXT NOT NULL CHECK (kind IN ('unique', 'standard')),
  description TEXT,
  sort_order INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE gift_series (
  id TEXT PRIMARY KEY,
  collection_id TEXT NOT NULL REFERENCES gift_collections(id) ON DELETE RESTRICT,
  code TEXT NOT NULL UNIQUE,
  title TEXT NOT NULL,
  subtitle TEXT,
  lore TEXT,
  -- The whistle ranks of the Abyss, darkest last: the rarer the rank, the
  -- smaller the issue and the darker the card behind it.
  rank TEXT NOT NULL CHECK (rank IN ('bell', 'red', 'blue', 'moon', 'black', 'white', 'plain')),
  -- NULL means unlimited, which is what a standard gift is.
  total_supply INTEGER CHECK (total_supply IS NULL OR total_supply > 0),
  star_price INTEGER NOT NULL DEFAULT 0 CHECK (star_price >= 0),
  sort_order INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);

-- The circulation is the whole promise of a limited series. It is written when
-- the series is created and never again.
CREATE TRIGGER gift_series_supply_is_final
BEFORE UPDATE OF total_supply ON gift_series
WHEN NEW.total_supply IS NOT OLD.total_supply
BEGIN
  SELECT RAISE(ABORT, 'gift series circulation cannot be changed');
END;

-- Nor may a series be deleted while copies of it exist.
CREATE TRIGGER gift_series_stays_while_issued
BEFORE DELETE ON gift_series
WHEN EXISTS (SELECT 1 FROM gift_items WHERE series_id = OLD.id)
BEGIN
  SELECT RAISE(ABORT, 'gift series with issued copies cannot be removed');
END;

-- The three axes a collectible varies along, with rarity per thousand, exactly
-- as Telegram measures it.
CREATE TABLE gift_attributes (
  id TEXT PRIMARY KEY,
  kind TEXT NOT NULL CHECK (kind IN ('model', 'pattern', 'backdrop')),
  code TEXT NOT NULL,
  title TEXT NOT NULL,
  rarity_permille INTEGER NOT NULL CHECK (rarity_permille BETWEEN 1 AND 1000),
  -- How to draw it: colours for a backdrop, the shape for a model, the tile for
  -- a pattern. Read by the app, never interpreted here.
  appearance TEXT NOT NULL DEFAULT '{}',
  sort_order INTEGER NOT NULL DEFAULT 0,
  UNIQUE (kind, code)
);

CREATE TABLE gift_items (
  id TEXT PRIMARY KEY,
  series_id TEXT NOT NULL REFERENCES gift_series(id) ON DELETE RESTRICT,
  -- The copy's number out of the issue, the way a collectible carries #9,474.
  serial INTEGER NOT NULL CHECK (serial > 0),
  model_id TEXT REFERENCES gift_attributes(id) ON DELETE RESTRICT,
  pattern_id TEXT REFERENCES gift_attributes(id) ON DELETE RESTRICT,
  backdrop_id TEXT REFERENCES gift_attributes(id) ON DELETE RESTRICT,
  owner_user_id TEXT REFERENCES users(id) ON DELETE SET NULL,
  -- Where it sits in the owner's own arrangement, and whether they show it on
  -- their profile the way Telegram pins a gift to a header.
  user_collection_id TEXT,
  pinned_order INTEGER,
  minted_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  -- The link before this one, and this one's own signature over it.
  prev_hash TEXT NOT NULL,
  hash TEXT NOT NULL UNIQUE,
  UNIQUE (series_id, serial)
);

CREATE INDEX idx_gift_items_owner ON gift_items(owner_user_id, pinned_order);
CREATE INDEX idx_gift_items_series ON gift_items(series_id, serial);

-- A copy may not be numbered outside its issue.
CREATE TRIGGER gift_items_within_circulation
BEFORE INSERT ON gift_items
WHEN (
  SELECT total_supply FROM gift_series WHERE id = NEW.series_id
) IS NOT NULL AND NEW.serial > (SELECT total_supply FROM gift_series WHERE id = NEW.series_id)
BEGIN
  SELECT RAISE(ABORT, 'gift serial is outside the circulation of its series');
END;

-- Neither the number nor the series of an issued copy may be rewritten.
CREATE TRIGGER gift_items_identity_is_final
BEFORE UPDATE OF series_id, serial, hash, prev_hash ON gift_items
WHEN NEW.series_id <> OLD.series_id
  OR NEW.serial <> OLD.serial
  OR NEW.hash <> OLD.hash
  OR NEW.prev_hash <> OLD.prev_hash
BEGIN
  SELECT RAISE(ABORT, 'an issued gift cannot be renumbered');
END;

-- Every hand a copy passes through, chained the same way.
CREATE TABLE gift_transfers (
  id TEXT PRIMARY KEY,
  item_id TEXT NOT NULL REFERENCES gift_items(id) ON DELETE CASCADE,
  from_user_id TEXT REFERENCES users(id) ON DELETE SET NULL,
  to_user_id TEXT REFERENCES users(id) ON DELETE SET NULL,
  reason TEXT NOT NULL CHECK (reason IN ('mint', 'gift', 'trade', 'purchase')),
  star_amount INTEGER NOT NULL DEFAULT 0 CHECK (star_amount >= 0),
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  prev_hash TEXT NOT NULL,
  hash TEXT NOT NULL UNIQUE
);

CREATE INDEX idx_gift_transfers_item ON gift_transfers(item_id, created_at);

CREATE TRIGGER gift_transfers_are_final
BEFORE UPDATE ON gift_transfers
BEGIN
  SELECT RAISE(ABORT, 'the history of a gift cannot be rewritten');
END;

CREATE TRIGGER gift_transfers_are_permanent
BEFORE DELETE ON gift_transfers
BEGIN
  SELECT RAISE(ABORT, 'the history of a gift cannot be erased');
END;

-- What an owner is asking for a copy, and what somebody else offers for it.
CREATE TABLE gift_listings (
  id TEXT PRIMARY KEY,
  item_id TEXT NOT NULL UNIQUE REFERENCES gift_items(id) ON DELETE CASCADE,
  seller_user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  star_price INTEGER NOT NULL CHECK (star_price > 0),
  status TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'sold', 'cancelled')),
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX idx_gift_listings_open ON gift_listings(status, star_price);

CREATE TABLE gift_offers (
  id TEXT PRIMARY KEY,
  item_id TEXT NOT NULL REFERENCES gift_items(id) ON DELETE CASCADE,
  from_user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  to_user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  star_amount INTEGER NOT NULL CHECK (star_amount >= 0),
  message TEXT,
  status TEXT NOT NULL DEFAULT 'pending'
    CHECK (status IN ('pending', 'accepted', 'declined', 'cancelled')),
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  resolved_at TEXT
);

CREATE INDEX idx_gift_offers_inbox ON gift_offers(to_user_id, status, created_at DESC);

-- The shelves an owner arranges their own copies on, named by them.
CREATE TABLE user_gift_collections (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  title TEXT NOT NULL CHECK (length(title) BETWEEN 1 AND 40),
  sort_order INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX idx_user_gift_collections_owner ON user_gift_collections(user_id, sort_order);
