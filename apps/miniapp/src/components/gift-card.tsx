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
 * The whistles of the Abyss, in rank order. A bell is a small round bell on a
 * cord; a red whistle is the plain pea whistle an apprentice is given; a blue
 * one carries a band; a moon one is marked with a crescent; a black one is
 * angular and heavy; and a white one is a carved relic, each of which is said to
 * be impossible to reproduce.
 */
const MODELS: Record<string, { body: string; detail: string }> = {
  bell: {
    body: 'M48 30 a13 13 0 0 1 13 13 v9 l4 6 h-34 l4 -6 v-9 a13 13 0 0 1 13 -13 z',
    detail: 'M44 58 a4 4 0 0 0 8 0 M48 24 v6 M44 26 a4 4 0 0 1 8 0',
  },
  red: {
    body: 'M32 38 h22 a13 13 0 0 1 13 13 a13 13 0 0 1 -13 13 h-6 l-5 9 -5 -9 h-6 a13 13 0 0 1 -13 -13 a13 13 0 0 1 13 -13 z',
    detail: 'M57 51 a4 4 0 1 0 0.1 0',
  },
  blue: {
    body: 'M30 36 h26 a14 14 0 0 1 14 14 a14 14 0 0 1 -14 14 h-7 l-5 10 -5 -10 h-9 a14 14 0 0 1 -14 -14 a14 14 0 0 1 14 -14 z',
    detail: 'M38 36 v28 M58 50 a4 4 0 1 0 0.1 0',
  },
  moon: {
    body: 'M30 36 h26 a14 14 0 0 1 14 14 a14 14 0 0 1 -14 14 h-7 l-5 10 -5 -10 h-9 a14 14 0 0 1 -14 -14 a14 14 0 0 1 14 -14 z',
    detail:
      'M44 44 a8 8 0 1 0 0 14 a10 10 0 0 1 0 -14 z M60 46 l2 4 4 1 -3 3 1 4 -4 -2 -4 2 1 -4 -3 -3 4 -1 z',
  },
  black: {
    body: 'M30 34 l9 -7 h18 l9 7 v10 a15 15 0 0 1 -7 20 h-7 l-5 11 -5 -11 h-7 a15 15 0 0 1 -7 -20 z',
    detail: 'M39 32 h18 M36 46 h24 M58 54 a4 4 0 1 0 0.1 0',
  },
  white: {
    body: 'M28 34 h32 a16 16 0 0 1 16 16 a16 16 0 0 1 -16 16 h-8 l-5 12 -5 -12 h-14 a16 16 0 0 1 -16 -16 a16 16 0 0 1 16 -16 z',
    detail:
      'M48 20 l6 8 h-12 z M20 44 l-9 -7 M76 44 l9 -7 M34 44 c6 -6 20 -6 26 0 M62 52 a4 4 0 1 0 0.1 0',
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
            <path d="M30 22 C40 10 56 10 66 22" />
          </g>
          <g className="gift-card-body">
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
              opacity="0.85"
            />
          </g>
        </svg>
      )}
    </div>
  );
}
