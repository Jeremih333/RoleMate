import { useId, useMemo, type CSSProperties } from 'react';

/**
 * A gift on its card, built the way Telegram builds one.
 *
 * Three layers, and each is an attribute of the copy with a name of its own. The
 * backdrop is a small palette rather than a colour — a centre, an edge, a colour
 * for the symbols and a colour for the text — so the card is lit from the middle
 * and falls away to its corners. The symbols are scattered around the model in a
 * ring rather than tiled in rows, which is what leaves the middle clear for the
 * thing itself. The model is the whistle, and its silhouette belongs to its rank
 * of the Abyss: a novice's bell, an apprentice's plain whistle, the banded blue,
 * the crescent-marked moon, the angular black, and the sovereign's carved white.
 *
 * It is drawn rather than fetched: a market shows dozens at once, and dozens of
 * pictures would be dozens of requests. Nothing moves until a gift is opened.
 */
export interface GiftAppearance {
  model?: { body?: string; edge?: string; cord?: string } | null;
  pattern?: { tile?: string } | null;
  backdrop?: {
    center?: string;
    edge?: string;
    pattern?: string;
    text?: string;
    /** The older two-colour form, still readable. */
    from?: string;
    to?: string;
    glow?: string;
  } | null;
}

/** One symbol, drawn small and scattered; each has a name of its own. */
const SYMBOLS: Record<string, string> = {
  relic: 'M8 1 L15 8 L8 15 L1 8 Z',
  curse: 'M2 13 C6 5 10 5 14 13 M8 2 L8 7',
  cradle: 'M1 11 C5 3 11 3 15 11 M8 3 L8 12',
  snowflake: 'M8 1 V15 M1 8 H15 M3 3 L13 13 M13 3 L3 13',
  feather: 'M13 2 C6 4 4 9 4 14 M13 2 C12 8 8 12 4 14',
  paw: 'M5 9 a2 2 0 1 0 0.1 0 M11 9 a2 2 0 1 0 0.1 0 M8 12.5 a2.6 2.6 0 1 0 0.1 0 M8 5 a1.7 1.7 0 1 0 0.1 0',
  lantern: 'M6 3 H10 V7 C10 10.5 6 10.5 6 7 Z M8 10.5 V14',
  compass: 'M8 8 L12 4 L9.5 9.5 L4 12 Z M8 1 A7 7 0 1 0 8 15 A7 7 0 1 0 8 1',
  rope: 'M2 5 C6 10 10 2 14 7 M2 10 C6 15 10 7 14 12',
  fern: 'M8 15 V2 M8 5.5 L4.5 3 M8 5.5 L11.5 3 M8 9 L4.5 6.5 M8 9 L11.5 6.5',
  bubble: 'M6 9.5 a3.4 3.4 0 1 0 0.1 0 M11.5 4.5 a1.8 1.8 0 1 0 0.1 0',
  spiral: 'M8 8 m-1 0 a1 1 0 1 0 2 0 a3 3 0 1 0 -5.4 0 a5.4 5.4 0 1 0 10 0',
  starfall: 'M8 1 L9.6 6.4 L15 8 L9.6 9.6 L8 15 L6.4 9.6 L1 8 L6.4 6.4 Z',
  echo: 'M8 8 m-2.2 0 a2.2 2.2 0 1 0 4.4 0 a2.2 2.2 0 1 0 -4.4 0 M8 8 m-5.6 0 a5.6 5.6 0 1 0 11.2 0 a5.6 5.6 0 1 0 -11.2 0',
};

/**
 * Where the symbols sit: a ring around the model, off the straight lines, so the
 * card reads as scattered rather than as wallpaper. Fixed rather than random, so
 * the same gift always looks the same.
 */
const SCATTER: Array<{ x: number; y: number; scale: number; opacity: number; turn: number }> = [
  { x: 14, y: 16, scale: 0.85, opacity: 0.5, turn: -18 },
  { x: 48, y: 8, scale: 0.65, opacity: 0.36, turn: 12 },
  { x: 80, y: 15, scale: 0.9, opacity: 0.52, turn: 22 },
  { x: 6, y: 44, scale: 0.7, opacity: 0.42, turn: 8 },
  { x: 89, y: 42, scale: 0.72, opacity: 0.44, turn: -14 },
  { x: 17, y: 74, scale: 0.95, opacity: 0.5, turn: 16 },
  { x: 50, y: 88, scale: 0.62, opacity: 0.34, turn: -9 },
  { x: 82, y: 76, scale: 0.88, opacity: 0.48, turn: -24 },
  { x: 32, y: 30, scale: 0.5, opacity: 0.24, turn: 30 },
  { x: 68, y: 62, scale: 0.5, opacity: 0.24, turn: -30 },
];

/**
 * The whistles of the Abyss.
 *
 * They are all the same object seen at the same angle — an upright body hanging
 * from its cord, a shouldered cap with the eyelet the cord passes through, the
 * round port cut into the face, ridges across the middle and a stepped foot —
 * and what changes with the rank is the ornament and how heavy the thing is. A
 * bell is the exception: a novice carries a bell, not a whistle, so it is a
 * small round one with a slit.
 *
 * `crest` is drawn behind the body, which is what lets a white whistle grow
 * wings out of its shoulders without them cutting across its face.
 */
const MODELS: Record<string, { body: string; detail: string; crest?: string }> = {
  bell: {
    body: 'M48 32 a15 15 0 0 1 15 15 a15 15 0 0 1 -15 15 a15 15 0 0 1 -15 -15 a15 15 0 0 1 15 -15 z',
    detail:
      'M42 56 h12 M40 47 a8 8 0 0 1 5 -7 M48 62 v4 M44 66 h8 a2 2 0 0 1 0 4 h-8 a2 2 0 0 1 0 -4 z',
    crest: 'M48 32 v-6 M43 26 a5 5 0 0 1 10 0 a5 5 0 0 1 -10 0 z',
  },
  red: {
    body: 'M37 27 h22 a5 5 0 0 1 5 5 v3 h1 a5 5 0 0 1 5 5 v27 a10 10 0 0 1 -10 10 h-24 a10 10 0 0 1 -10 -10 v-27 a5 5 0 0 1 5 -5 h1 v-3 a5 5 0 0 1 5 -5 z',
    detail: 'M31 43 h34 M31 47 h34 M48 57 m-8 0 a8 8 0 1 0 16 0 a8 8 0 1 0 -16 0 M40 71 h16',
    crest: 'M43 21 a5 5 0 0 1 10 0 a5 5 0 0 1 -10 0 z M44 26 h8',
  },
  blue: {
    body: 'M36 26 h24 a5 5 0 0 1 5 5 v4 h2 a5 5 0 0 1 5 5 v28 a10 10 0 0 1 -10 10 h-26 a10 10 0 0 1 -10 -10 v-28 a5 5 0 0 1 5 -5 h2 v-4 a5 5 0 0 1 5 -5 z',
    detail:
      'M30 44 h36 M30 48 h36 M48 58 m-8.5 0 a8.5 8.5 0 1 0 17 0 a8.5 8.5 0 1 0 -17 0 M48 31 l4 4 -4 4 -4 -4 z M39 71 h18',
    crest: 'M43 20 a5 5 0 0 1 10 0 a5 5 0 0 1 -10 0 z M44 25 h8',
  },
  moon: {
    body: 'M36 26 h24 a5 5 0 0 1 5 5 v4 h2 a5 5 0 0 1 5 5 v28 a10 10 0 0 1 -10 10 h-26 a10 10 0 0 1 -10 -10 v-28 a5 5 0 0 1 5 -5 h2 v-4 a5 5 0 0 1 5 -5 z',
    detail:
      'M30 45 h36 M48 58 m-8.5 0 a8.5 8.5 0 1 0 17 0 a8.5 8.5 0 1 0 -17 0 M44 30 a6 6 0 1 0 0 10 a7.5 7.5 0 0 1 0 -10 z M56 33 l1.4 3 3 1.4 -3 1.4 -1.4 3 -1.4 -3 -3 -1.4 3 -1.4 z M39 71 h18',
    crest: 'M43 20 a5 5 0 0 1 10 0 a5 5 0 0 1 -10 0 z M44 25 h8',
  },
  black: {
    body: 'M34 25 h28 a6 6 0 0 1 6 6 v5 h1 a5 5 0 0 1 5 5 v27 a11 11 0 0 1 -11 11 h-30 a11 11 0 0 1 -11 -11 v-27 a5 5 0 0 1 5 -5 h1 v-5 a6 6 0 0 1 6 -6 z',
    detail:
      'M28 44 h40 M28 49 h40 M48 60 m-9 0 a9 9 0 1 0 18 0 a9 9 0 1 0 -18 0 M40 31 h16 M40 36 h16 M37 73 h22',
    crest: 'M42 19 a6 6 0 0 1 12 0 a6 6 0 0 1 -12 0 z M44 25 h8',
  },
  white: {
    body: 'M35 25 h26 a6 6 0 0 1 6 6 v5 h2 a5 5 0 0 1 5 5 v27 a11 11 0 0 1 -11 11 h-28 a11 11 0 0 1 -11 -11 v-27 a5 5 0 0 1 5 -5 h2 v-5 a6 6 0 0 1 6 -6 z',
    detail:
      'M28 44 h40 M48 59 m-9.5 0 a9.5 9.5 0 1 0 19 0 a9.5 9.5 0 1 0 -19 0 M48 59 m-4 0 a4 4 0 1 0 8 0 a4 4 0 1 0 -8 0 M41 31 c4 -4 10 -4 14 0 M38 73 h20',
    // Carved wings off the shoulders and a horned crown: a white whistle is a
    // relic, and no two of them are said to be alike.
    crest:
      'M43 18 a5 5 0 0 1 10 0 a5 5 0 0 1 -10 0 z M44 23 h8 M41 26 l-5 -8 M55 26 l5 -8 M33 38 c-9 -2 -14 2 -16 8 c7 1 12 -1 16 -4 z M63 38 c9 -2 14 2 16 8 c-7 1 -12 -1 -16 -4 z',
  },
};

const STANDARD_EMOJI: Record<string, string> = {
  teddy: '\u{1F9F8}',
  bouquet: '\u{1F490}',
  tulip: '\u{1F337}',
  daisy: '\u{1F33C}',
  heart: '❤️',
  cake: '\u{1F382}',
  poop: '\u{1F4A9}',
  star: '⭐',
};

const STANDARD_MOTION: Record<string, string> = {
  teddy: 'hug',
  bouquet: 'bloom',
  tulip: 'sway',
  daisy: 'spin',
  heart: 'beat',
  cake: 'bounce',
  poop: 'wobble',
  star: 'twinkle',
};

export function GiftCard({
  appearance,
  rank = 'plain',
  seriesCode,
  size = 132,
  playing = false,
  bleed = false,
  label,
}: {
  appearance: GiftAppearance;
  rank?: string;
  seriesCode?: string;
  size?: number;
  playing?: boolean;
  /** Fills the width it is given instead of being a square tile. */
  bleed?: boolean;
  label?: string;
}) {
  const id = useId().replace(/:/g, '');
  const backdrop = appearance.backdrop ?? {};
  const centre = backdrop.center ?? backdrop.to ?? '#2f3746';
  const rim = backdrop.edge ?? backdrop.from ?? '#141821';
  const symbolColor = backdrop.pattern ?? backdrop.glow ?? '#dfe7f5';
  const textColor = backdrop.text ?? '#f4f7ff';
  const model = appearance.model ?? {};
  const symbol = SYMBOLS[appearance.pattern?.tile ?? ''] ?? SYMBOLS.echo!;
  const emoji = seriesCode ? STANDARD_EMOJI[seriesCode] : undefined;
  const shape = MODELS[rank] ?? MODELS.red!;
  const scatter = useMemo(() => SCATTER, []);
  return (
    <div
      className={`gift-card${playing ? ' is-playing' : ''}${bleed ? ' is-bleed' : ''}`}
      data-rank={rank}
      data-motion={emoji ? (STANDARD_MOTION[seriesCode ?? ''] ?? 'sway') : undefined}
      style={
        {
          ...(bleed ? {} : { width: size, height: size }),
          '--gift-center': centre,
          '--gift-edge': rim,
          '--gift-symbol': symbolColor,
          '--gift-text': textColor,
        } as CSSProperties
      }
      role={label ? 'img' : undefined}
      aria-label={label}
    >
      {/* The symbols are scattered around the middle rather than tiled in rows,
          so the model has room and the card reads as a vignette. */}
      <svg className="gift-card-scatter" viewBox="0 0 96 96" aria-hidden>
        <defs>
          <radialGradient id={`fade-${id}`}>
            <stop offset="0.25" stopColor="#000" stopOpacity="0" />
            <stop offset="1" stopColor="#000" stopOpacity="1" />
          </radialGradient>
          <mask id={`vignette-${id}`}>
            <rect width="96" height="96" fill={`url(#fade-${id})`} />
          </mask>
        </defs>
        <g mask={`url(#vignette-${id})`} stroke={symbolColor} fill="none" strokeWidth="1.2">
          {scatter.map((spot, index) => (
            <g
              key={index}
              transform={`translate(${spot.x - 8} ${spot.y - 8}) rotate(${spot.turn} 8 8) scale(${spot.scale})`}
              opacity={spot.opacity}
            >
              <path d={symbol} />
            </g>
          ))}
        </g>
      </svg>
      {emoji ? (
        <span className="gift-card-emoji" style={{ fontSize: (bleed ? size : size) * 0.46 }}>
          {emoji}
        </span>
      ) : (
        <svg className="gift-card-whistle" viewBox="0 0 96 96" aria-hidden>
          <g
            className="gift-card-cord"
            stroke={model.cord ?? '#5f5346'}
            strokeWidth="3"
            fill="none"
          >
            <path d="M48 6 C36 6 34 12 40 17 M48 6 C60 6 62 12 56 17" />
          </g>
          <g className="gift-card-body">
            {/* Behind the body, so wings and a crown grow out of the shoulders
                rather than across the face. */}
            {shape.crest ? (
              <path
                d={shape.crest}
                fill={model.body ?? '#cbb9a4'}
                stroke={model.edge ?? '#9b8a76'}
                strokeWidth="2.2"
                strokeLinejoin="round"
                strokeLinecap="round"
              />
            ) : null}
            <path
              d={shape.body}
              fill={model.body ?? '#cbb9a4'}
              stroke={model.edge ?? '#9b8a76'}
              strokeWidth="2.5"
              strokeLinejoin="round"
            />
            <path
              d={shape.detail}
              fill="none"
              stroke={model.edge ?? '#9b8a76'}
              strokeWidth="2"
              strokeLinecap="round"
              strokeLinejoin="round"
              opacity="0.85"
            />
          </g>
        </svg>
      )}
    </div>
  );
}
