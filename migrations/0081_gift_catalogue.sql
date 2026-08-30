-- The first two collections.
--
-- Whistle Gifts follows the ranks of the Abyss — bell, red, blue, moon, black,
-- white — and the rule the ranks already imply: the higher the rank, the fewer
-- there ever are, and the darker the card behind them. The named White Whistles
-- are the sovereigns, so their issues are the smallest of all.
--
-- The circulations written here are final. The trigger in the previous migration
-- refuses to change them afterwards, which is the point of a limited series.

INSERT INTO gift_collections (id, code, title, kind, description, sort_order) VALUES
  ('gc-whistle', 'whistle_gifts', 'Whistle Gifts', 'unique',
   'Свистки Бездны: чем выше ранг, тем меньше тираж и темнее фон.', 0),
  ('gc-standard', 'standard_gifts', 'Обычные подарки', 'standard',
   'Анимированные подарки, которые можно дарить сколько угодно раз.', 1);

-- Backdrops, darkest for the rarest ranks.
INSERT INTO gift_attributes (id, kind, code, title, rarity_permille, appearance, sort_order) VALUES
  ('bd-abyss',     'backdrop', 'abyss',      'Abyss',        8,  '{"from":"#05070d","to":"#101726","glow":"#c9d6ff"}', 0),
  ('bd-obsidian',  'backdrop', 'obsidian',   'Obsidian',     10, '{"from":"#07080c","to":"#171a24","glow":"#e8ecff"}', 1),
  ('bd-onyx',      'backdrop', 'onyx',       'Onyx Gold',    12, '{"from":"#0a0a0d","to":"#1d1a12","glow":"#ffd479"}', 2),
  ('bd-midnight',  'backdrop', 'midnight',   'Midnight',     15, '{"from":"#080d1c","to":"#152040","glow":"#8fb6ff"}', 3),
  ('bd-eclipse',   'backdrop', 'eclipse',    'Eclipse',      18, '{"from":"#0d0812","to":"#241634","glow":"#c79bff"}', 4),
  ('bd-ember',     'backdrop', 'ember',      'Ember',        24, '{"from":"#160a0a","to":"#3a1414","glow":"#ff9b7a"}', 5),
  ('bd-verdigris', 'backdrop', 'verdigris',  'Verdigris',    30, '{"from":"#07130f","to":"#153028","glow":"#7fe0c0"}', 6),
  ('bd-moonlit',   'backdrop', 'moonlit',    'Moonlit',      36, '{"from":"#0f1420","to":"#25304a","glow":"#d5e2ff"}', 7),
  ('bd-amethyst',  'backdrop', 'amethyst',   'Amethyst',     44, '{"from":"#140f22","to":"#2e2350","glow":"#b79bff"}', 8),
  ('bd-cobalt',    'backdrop', 'cobalt',     'Cobalt',       55, '{"from":"#0a1424","to":"#173154","glow":"#7fb2ff"}', 9),
  ('bd-teal',      'backdrop', 'teal',       'Teal',         66, '{"from":"#08171c","to":"#12333d","glow":"#7fd9e8"}', 10),
  ('bd-rose',      'backdrop', 'rose',       'Rose Quartz',  80, '{"from":"#1c1016","to":"#3d2130","glow":"#ffb3cc"}', 11),
  ('bd-amber',     'backdrop', 'amber',      'Amber',        95, '{"from":"#1b1408","to":"#3d2f11","glow":"#ffcf80"}', 12),
  ('bd-sand',      'backdrop', 'sand',       'Sand',        120, '{"from":"#1a1712","to":"#3a3427","glow":"#ffe7bd"}', 13),
  ('bd-mist',      'backdrop', 'mist',       'Mist',        150, '{"from":"#141821","to":"#2f3746","glow":"#dfe7f5"}', 14),
  ('bd-dawn',      'backdrop', 'dawn',       'Dawn',        237, '{"from":"#181320","to":"#3a2c46","glow":"#ffd9ec"}', 15);

-- Patterns tiled behind the whistle, one of the things that tells our gifts
-- apart from anybody else's.
INSERT INTO gift_attributes (id, kind, code, title, rarity_permille, appearance, sort_order) VALUES
  ('pt-relic',    'pattern', 'relic',      'Relic',        9,   '{"tile":"relic"}', 0),
  ('pt-curse',    'pattern', 'curse',      'Curse',        12,  '{"tile":"curse"}', 1),
  ('pt-cradle',   'pattern', 'cradle',     'Cradle',       16,  '{"tile":"cradle"}', 2),
  ('pt-snowflake','pattern', 'snowflake',  'Snowflake',    20,  '{"tile":"snowflake"}', 3),
  ('pt-feather',  'pattern', 'feather',    'Feather',      26,  '{"tile":"feather"}', 4),
  ('pt-paw',      'pattern', 'paw',        'Paw',          34,  '{"tile":"paw"}', 5),
  ('pt-lantern',  'pattern', 'lantern',    'Lantern',      44,  '{"tile":"lantern"}', 6),
  ('pt-compass',  'pattern', 'compass',    'Compass',      56,  '{"tile":"compass"}', 7),
  ('pt-rope',     'pattern', 'rope',       'Rope',         70,  '{"tile":"rope"}', 8),
  ('pt-fern',     'pattern', 'fern',       'Fern',         88,  '{"tile":"fern"}', 9),
  ('pt-bubble',   'pattern', 'bubble',     'Bubble',       110, '{"tile":"bubble"}', 10),
  ('pt-spiral',   'pattern', 'spiral',     'Spiral',       140, '{"tile":"spiral"}', 11),
  ('pt-star',     'pattern', 'starfall',   'Starfall',     175, '{"tile":"starfall"}', 12),
  ('pt-echo',     'pattern', 'echo',       'Echo',         200, '{"tile":"echo"}', 13);

-- The whistle itself: the same silhouette on every card, in different materials.
INSERT INTO gift_attributes (id, kind, code, title, rarity_permille, appearance, sort_order) VALUES
  ('md-white',     'model', 'white_bone',   'White Bone',    9,   '{"body":"#f4f1ea","edge":"#cfc7b4","cord":"#8d8574"}', 0),
  ('md-pearl',     'model', 'pearl',        'Pearl',         14,  '{"body":"#fbf7ff","edge":"#d3c9e8","cord":"#8f86a8"}', 1),
  ('md-golden',    'model', 'golden',       'Golden Gun',    18,  '{"body":"#ffd479","edge":"#b8862c","cord":"#6d5019"}', 2),
  ('md-obsidian',  'model', 'obsidian',     'Obsidian',      26,  '{"body":"#1b1c22","edge":"#3c3f4c","cord":"#0e0f13"}', 3),
  ('md-silver',    'model', 'silver',       'Silver',        40,  '{"body":"#d8dee9","edge":"#9aa3b1","cord":"#5b6472"}', 4),
  ('md-amethyst',  'model', 'amethyst',     'Amethyst',      60,  '{"body":"#b79bff","edge":"#7f63c6","cord":"#4a3a76"}', 5),
  ('md-cobalt',    'model', 'cobalt',       'Cobalt',        90,  '{"body":"#7fb2ff","edge":"#4e79bd","cord":"#2f4a75"}', 6),
  ('md-copper',    'model', 'copper',       'Copper',        140, '{"body":"#e2a071","edge":"#a86a3f","cord":"#6b4126"}', 7),
  ('md-crimson',   'model', 'crimson',      'Crimson',       200, '{"body":"#ff8f80","edge":"#bc4f43","cord":"#742d26"}', 8),
  ('md-clay',      'model', 'clay',         'Clay',          403, '{"body":"#cbb9a4","edge":"#9b8a76","cord":"#5f5346"}', 9);

-- The series. The named White Whistles are the sovereigns of the Abyss, and
-- their issues are the smallest; a bell, which every novice carries, is the
-- largest. Prices in stars follow the same slope.
INSERT INTO gift_series
  (id, collection_id, code, title, subtitle, lore, rank, total_supply, star_price, sort_order)
VALUES
  ('gs-lyza', 'gc-whistle', 'lyza_whistle', 'Lyza''s Whistle', 'Владычица истребления',
   'Белый свисток Лизы Истребительницы, матери Рико. Второй по значимости артефакт, который слушается только своего владельца.',
   'white', 100, 12000, 0),
  ('gs-ozen', 'gc-whistle', 'ozen_whistle', 'Ozen''s Whistle', 'Непоколебимая владычица',
   'Белый свисток Одзен Непоколебимой, хозяйки Идофронта на втором слое.',
   'white', 150, 9000, 1),
  ('gs-bondrewd', 'gc-whistle', 'bondrewd_whistle', 'Bondrewd''s Whistle', 'Владыка рассвета',
   'Белый свисток Бондрудо Новатора — самый спорный из всех белых свистков.',
   'white', 150, 9000, 2),
  ('gs-srajo', 'gc-whistle', 'srajo_whistle', 'Srajo''s Whistle', 'Владыка тайны',
   'Белый свисток Сражо Загадочного, ушедшего на шестой слой во главе «Града воедино».',
   'white', 200, 7000, 3),
  ('gs-wakuna', 'gc-whistle', 'wakuna_whistle', 'Wakuna''s Whistle', 'Владыка наставления',
   'Белый свисток Вакуны Избранного, старейшего из ныне живущих белых свистков.',
   'white', 200, 7000, 4),
  ('gs-riko', 'gc-whistle', 'riko_whistle', 'Riko''s Whistle', 'Наследие Лизы',
   'Белый свисток, доставшийся Рико от матери вместе с её последним письмом.',
   'white', 250, 6000, 5),
  ('gs-habolg', 'gc-whistle', 'habolg_whistle', 'Habolg''s Whistle', 'Чёрный свисток',
   'Чёрный свисток Хаболга, мастера-искателя, знающего первые слои как свои руки.',
   'black', 1500, 1200, 6),
  ('gs-jiruo', 'gc-whistle', 'jiruo_whistle', 'Leader''s Whistle', 'Чёрный свисток',
   'Чёрный свисток Дзируо, Лидера сиротского приюта Белчеро.',
   'black', 1500, 1200, 7),
  ('gs-black', 'gc-whistle', 'black_whistle', 'Black Whistle', 'Мастер-искатель',
   'Чёрный свисток: знак мастера, которому открыт путь глубже четвёртого слоя.',
   'black', 3000, 700, 8),
  ('gs-marulk', 'gc-whistle', 'marulk_whistle', 'Marulk''s Whistle', 'Лунный свисток',
   'Лунный свисток Марулка, ученика Одзен, хранителя Идофронта.',
   'moon', 4000, 400, 9),
  ('gs-moon', 'gc-whistle', 'moon_whistle', 'Moon Whistle', 'Эксперт',
   'Лунный свисток: знак наставника, которому позволено спускаться до 12 000 метров.',
   'moon', 6000, 300, 10),
  ('gs-blue', 'gc-whistle', 'blue_whistle', 'Blue Whistle', 'Полноправный искатель',
   'Синий свисток: полноправный искатель, спускающийся до второго слоя.',
   'blue', 12000, 150, 11),
  ('gs-red', 'gc-whistle', 'red_whistle', 'Red Whistle', 'Ученик',
   'Красный свисток: ученик, которому открыт первый слой до 450 метров.',
   'red', 25000, 75, 12),
  ('gs-bell', 'gc-whistle', 'bell_whistle', 'Bell', 'Новичок',
   'Колокольчик: знак новичка, ещё не совершившего первый спуск.',
   'bell', 50000, 25, 13);

-- Standard gifts: animated, unlimited, the everyday ones.
INSERT INTO gift_series
  (id, collection_id, code, title, subtitle, lore, rank, total_supply, star_price, sort_order)
VALUES
  ('gs-teddy', 'gc-standard', 'teddy', 'Мишка', 'Обычный подарок', NULL, 'plain', NULL, 15, 0),
  ('gs-bouquet', 'gc-standard', 'bouquet', 'Букет', 'Обычный подарок', NULL, 'plain', NULL, 25, 1),
  ('gs-tulip', 'gc-standard', 'tulip', 'Тюльпан', 'Обычный подарок', NULL, 'plain', NULL, 15, 2),
  ('gs-daisy', 'gc-standard', 'daisy', 'Ромашка', 'Обычный подарок', NULL, 'plain', NULL, 15, 3),
  ('gs-heart', 'gc-standard', 'heart', 'Сердце', 'Обычный подарок', NULL, 'plain', NULL, 50, 4),
  ('gs-cake', 'gc-standard', 'cake', 'Торт', 'Обычный подарок', NULL, 'plain', NULL, 50, 5),
  ('gs-poop', 'gc-standard', 'poop', 'Какашка', 'Обычный подарок', NULL, 'plain', NULL, 5, 6),
  ('gs-star', 'gc-standard', 'star', 'Звезда', 'Обычный подарок', NULL, 'plain', NULL, 100, 7);
