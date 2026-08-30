-- Backdrops become palettes, the way Telegram stores them.
--
-- A backdrop there is not one colour: it is a centre colour, an edge colour, a
-- colour for the pattern and a colour for the text on it
-- (core.telegram.org's starGiftAttributeBackdrop). That is what lets a card be
-- lit from the middle and fade to its edges, with the symbols scattered over it
-- in a colour of their own, instead of a flat rectangle.
--
-- The names stay as they were, because a backdrop is named and its name is part
-- of what a collectible is.

UPDATE gift_attributes SET appearance = '{"center":"#182238","edge":"#05070d","pattern":"#c9d6ff","text":"#eaf0ff"}' WHERE kind = 'backdrop' AND code = 'abyss';
UPDATE gift_attributes SET appearance = '{"center":"#20242f","edge":"#07080c","pattern":"#e8ecff","text":"#f4f6ff"}' WHERE kind = 'backdrop' AND code = 'obsidian';
UPDATE gift_attributes SET appearance = '{"center":"#2c2617","edge":"#0a0a0d","pattern":"#ffd479","text":"#fff3d6"}' WHERE kind = 'backdrop' AND code = 'onyx';
UPDATE gift_attributes SET appearance = '{"center":"#1c2c56","edge":"#080d1c","pattern":"#8fb6ff","text":"#e6efff"}' WHERE kind = 'backdrop' AND code = 'midnight';
UPDATE gift_attributes SET appearance = '{"center":"#31204a","edge":"#0d0812","pattern":"#c79bff","text":"#f1e8ff"}' WHERE kind = 'backdrop' AND code = 'eclipse';
UPDATE gift_attributes SET appearance = '{"center":"#4a1c18","edge":"#160a0a","pattern":"#ff9b7a","text":"#ffe8e0"}' WHERE kind = 'backdrop' AND code = 'ember';
UPDATE gift_attributes SET appearance = '{"center":"#1a3c33","edge":"#07130f","pattern":"#7fe0c0","text":"#e2fff5"}' WHERE kind = 'backdrop' AND code = 'verdigris';
UPDATE gift_attributes SET appearance = '{"center":"#2c3a58","edge":"#0f1420","pattern":"#d5e2ff","text":"#f2f6ff"}' WHERE kind = 'backdrop' AND code = 'moonlit';
UPDATE gift_attributes SET appearance = '{"center":"#392c63","edge":"#140f22","pattern":"#b79bff","text":"#f0eaff"}' WHERE kind = 'backdrop' AND code = 'amethyst';
UPDATE gift_attributes SET appearance = '{"center":"#1c3c66","edge":"#0a1424","pattern":"#7fb2ff","text":"#e8f1ff"}' WHERE kind = 'backdrop' AND code = 'cobalt';
UPDATE gift_attributes SET appearance = '{"center":"#164049","edge":"#08171c","pattern":"#7fd9e8","text":"#e6fbff"}' WHERE kind = 'backdrop' AND code = 'teal';
UPDATE gift_attributes SET appearance = '{"center":"#4a2839","edge":"#1c1016","pattern":"#ffb3cc","text":"#ffeaf3"}' WHERE kind = 'backdrop' AND code = 'rose';
UPDATE gift_attributes SET appearance = '{"center":"#4a3915","edge":"#1b1408","pattern":"#ffcf80","text":"#fff2da"}' WHERE kind = 'backdrop' AND code = 'amber';
UPDATE gift_attributes SET appearance = '{"center":"#463e2f","edge":"#1a1712","pattern":"#ffe7bd","text":"#fff6e6"}' WHERE kind = 'backdrop' AND code = 'sand';
UPDATE gift_attributes SET appearance = '{"center":"#3a4353","edge":"#141821","pattern":"#dfe7f5","text":"#f4f7ff"}' WHERE kind = 'backdrop' AND code = 'mist';
UPDATE gift_attributes SET appearance = '{"center":"#453552","edge":"#181320","pattern":"#ffd9ec","text":"#fff0f8"}' WHERE kind = 'backdrop' AND code = 'dawn';

-- The whistle of each rank is a shape, not a colour scheme: the material stays
-- an attribute of the copy, and the silhouette belongs to the rank.
UPDATE gift_series SET lore = NULL;
