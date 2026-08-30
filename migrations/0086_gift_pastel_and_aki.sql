-- Pastel backdrops, and the last of the named White Whistles.
--
-- The reference for this is Telegram's own market: the cards there are muted
-- pastels — sage, dusty blue, mauve, sand — dark enough for a light model to
-- read against and quiet enough that a wall of them is not a wall of noise.
-- Ours were near-black, which made every card look like the same card.
--
-- The pack of artwork carries seven White Whistles, and Aki's had no series of
-- its own, so it gets one here with the same standing as its neighbours.

UPDATE gift_attributes SET appearance = '{"center":"#3f4b63","edge":"#222a3a","pattern":"#cbd6ef","text":"#f2f5ff"}' WHERE kind = 'backdrop' AND code = 'abyss';
UPDATE gift_attributes SET appearance = '{"center":"#464b57","edge":"#272a33","pattern":"#dfe3ef","text":"#f6f7fb"}' WHERE kind = 'backdrop' AND code = 'obsidian';
UPDATE gift_attributes SET appearance = '{"center":"#5b5236","edge":"#332e1f","pattern":"#f3dfa6","text":"#fdf6e3"}' WHERE kind = 'backdrop' AND code = 'onyx';
UPDATE gift_attributes SET appearance = '{"center":"#3c4a70","edge":"#212a43","pattern":"#bccdf3","text":"#eef3ff"}' WHERE kind = 'backdrop' AND code = 'midnight';
UPDATE gift_attributes SET appearance = '{"center":"#4e3f66","edge":"#2b233a","pattern":"#d5c3f2","text":"#f6f0ff"}' WHERE kind = 'backdrop' AND code = 'eclipse';
UPDATE gift_attributes SET appearance = '{"center":"#6a4238","edge":"#3b2520","pattern":"#f4c2ae","text":"#fff0ea"}' WHERE kind = 'backdrop' AND code = 'ember';
UPDATE gift_attributes SET appearance = '{"center":"#37584e","edge":"#1e322c","pattern":"#a9dcc9","text":"#eefaf5"}' WHERE kind = 'backdrop' AND code = 'verdigris';
UPDATE gift_attributes SET appearance = '{"center":"#4c5670","edge":"#2b3140","pattern":"#d4dcf2","text":"#f4f7ff"}' WHERE kind = 'backdrop' AND code = 'moonlit';
UPDATE gift_attributes SET appearance = '{"center":"#564571","edge":"#302740","pattern":"#d9c8f5","text":"#f8f3ff"}' WHERE kind = 'backdrop' AND code = 'amethyst';
UPDATE gift_attributes SET appearance = '{"center":"#3a5273","edge":"#202f43","pattern":"#bad3f2","text":"#eef5ff"}' WHERE kind = 'backdrop' AND code = 'cobalt';
UPDATE gift_attributes SET appearance = '{"center":"#33555c","edge":"#1c3035","pattern":"#a9dbe4","text":"#eefafd"}' WHERE kind = 'backdrop' AND code = 'teal';
UPDATE gift_attributes SET appearance = '{"center":"#6a4356","edge":"#3b2531","pattern":"#f2bed3","text":"#fff0f6"}' WHERE kind = 'backdrop' AND code = 'rose';
UPDATE gift_attributes SET appearance = '{"center":"#6b5533","edge":"#3c301d","pattern":"#f5d59c","text":"#fff6e6"}' WHERE kind = 'backdrop' AND code = 'amber';
UPDATE gift_attributes SET appearance = '{"center":"#635a4a","edge":"#39332a","pattern":"#efe1c8","text":"#fdf8f0"}' WHERE kind = 'backdrop' AND code = 'sand';
UPDATE gift_attributes SET appearance = '{"center":"#525a68","edge":"#2f343d","pattern":"#dee4ee","text":"#f7f9fd"}' WHERE kind = 'backdrop' AND code = 'mist';
UPDATE gift_attributes SET appearance = '{"center":"#5f4a63","edge":"#362a38","pattern":"#eccdea","text":"#fdf3fc"}' WHERE kind = 'backdrop' AND code = 'dawn';

INSERT INTO gift_series
  (id, collection_id, code, title, subtitle, rank, total_supply, star_price, sort_order)
VALUES
  ('gs-aki', 'gc-whistle', 'aki_whistle', 'Aki''s Whistle', 'Sovereign of the Depths',
   'white', 250, 6000, 6);
