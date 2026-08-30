-- Gift names are English, everywhere.
--
-- A collectible's name is part of the collectible: it is what a card shows, what
-- a market lists and what somebody quotes when they offer for one. Half of them
-- having been written in Russian made the market read as two different products,
-- so every collection, series and epithet is renamed here. The lore under a
-- whistle stays in the language the app speaks, because it is a description
-- rather than a name.

UPDATE gift_collections SET title = 'Whistle Gifts' WHERE code = 'whistle_gifts';
UPDATE gift_collections SET title = 'Standard Gifts' WHERE code = 'standard_gifts';

UPDATE gift_series SET subtitle = 'Sovereign of Annihilation' WHERE code = 'lyza_whistle';
UPDATE gift_series SET subtitle = 'The Immovable Sovereign' WHERE code = 'ozen_whistle';
UPDATE gift_series SET subtitle = 'Sovereign of Dawn' WHERE code = 'bondrewd_whistle';
UPDATE gift_series SET subtitle = 'Sovereign of Mystery' WHERE code = 'srajo_whistle';
UPDATE gift_series SET subtitle = 'Sovereign of Guidance' WHERE code = 'wakuna_whistle';
UPDATE gift_series SET subtitle = 'Lyza''s Legacy' WHERE code = 'riko_whistle';
UPDATE gift_series SET subtitle = 'Black Whistle' WHERE code IN ('habolg_whistle', 'jiruo_whistle');
UPDATE gift_series SET subtitle = 'Master Delver' WHERE code = 'black_whistle';
UPDATE gift_series SET subtitle = 'Moon Whistle' WHERE code = 'marulk_whistle';
UPDATE gift_series SET subtitle = 'Expert Delver' WHERE code = 'moon_whistle';
UPDATE gift_series SET subtitle = 'Full Delver' WHERE code = 'blue_whistle';
UPDATE gift_series SET subtitle = 'Apprentice' WHERE code = 'red_whistle';
UPDATE gift_series SET subtitle = 'Novice' WHERE code = 'bell_whistle';

UPDATE gift_series SET title = 'Teddy Bear', subtitle = 'Standard Gift' WHERE code = 'teddy';
UPDATE gift_series SET title = 'Bouquet', subtitle = 'Standard Gift' WHERE code = 'bouquet';
UPDATE gift_series SET title = 'Tulip', subtitle = 'Standard Gift' WHERE code = 'tulip';
UPDATE gift_series SET title = 'Daisy', subtitle = 'Standard Gift' WHERE code = 'daisy';
UPDATE gift_series SET title = 'Heart', subtitle = 'Standard Gift' WHERE code = 'heart';
UPDATE gift_series SET title = 'Cake', subtitle = 'Standard Gift' WHERE code = 'cake';
UPDATE gift_series SET title = 'Poop', subtitle = 'Standard Gift' WHERE code = 'poop';
UPDATE gift_series SET title = 'Star', subtitle = 'Standard Gift' WHERE code = 'star';
