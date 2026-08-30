import { useId, type CSSProperties } from 'react';

/**
 * A gift on its card.
 *
 * A whistle sits in the same place on every card — that is what makes them one
 * series — while its shape belongs to its rank, and everything around it belongs
 * to the copy: the material, the pattern tiled behind it and the backdrop it
 * sits on. The rarer the rank, the darker the card and the more the whistle does
 * when somebody opens it, which is the rule the ranks of the Abyss already
 * imply. A standard gift is an emoji instead, with a movement of its own.
 *
 * It is drawn rather than fetched: a market shows dozens of these at once, and
 * dozens of pictures would be dozens of requests on a plan that has a hundred
 * thousand a day. Nothing moves until a gift is opened.
 */
export interface GiftAppearance {
  model?: { body?: string; edge?: string; cord?: string } | null;
  pattern?: { tile?: string } | null;
  backdrop?: { from?: string; to?: string; glow?: string } | null;
}

const TILES: Record<string, string> = {
  relic: 'M8 2 L14 8 L8 14 L2 8 Z',
  curse: 'M3 13 C6 6 10 6 13 13 M8 3 L8 7',
  cradle: 'M2 11 C5 4 11 4 14 11 M8 4 L8 12',
  snowflake: 'M8 2 V14 M2 8 H14 M4 4 L12 12 M12 4 L4 12',
  feather: 'M12 3 C6 5 4 9 4 13 M12 3 C11 8 8 11 4 13',
  paw: 'M5 9 a2 2 0 1 0 0.1 0 M11 9 a2 2 0 1 0 0.1 0 M8 12 a2.5 2.5 0 1 0 0.1 0 M8 5 a1.6 1.6 0 1 0 0.1 0',
  lantern: 'M6 4 H10 V7 C10 10 6 10 6 7 Z M8 10 V13',
  compass: 'M8 8 L11 5 L9 9 L5 11 Z M8 2 A6 6 0 1 0 8 14 A6 6 0 1 0 8 2',
  rope: 'M3 5 C6 9 10 3 13 7 M3 9 C6 13 10 7 13 11',
  fern: 'M8 14 V3 M8 6 L5 4 M8 6 L11 4 M8 9 L5 7 M8 9 L11 7',
  bubble: 'M6 9 a3 3 0 1 0 0.1 0 M11 5 a1.6 1.6 0 1 0 0.1 0',
  spiral: 'M8 8 m-1 0 a1 1 0 1 0 2 0 a3 3 0 1 0 -5 0 a5 5 0 1 0 9 0',
  starfall: 'M8 2 L9.5 6.5 L14 8 L9.5 9.5 L8 14 L6.5 9.5 L2 8 L6.5 6.5 Z',
  echo: 'M8 8 m-2 0 a2 2 0 1 0 4 0 a2 2 0 1 0 -4 0 M8 8 m-5 0 a5 5 0 1 0 10 0 a5 5 0 1 0 -10 0',
};

/**
 * One silhouette per rank. A bell is a bell; a red whistle is the plain pea
 * whistle an apprentice is given; the ranks above it grow a band, a crescent,
 * an angular guard and finally the sovereign's winged relic.
 */
const SILHOUETTES: Record<string, string> = {
  bell: 'M48 26 a14 14 0 0 1 14 14 v10 l5 8 h-38 l5 -8 v-10 a14 14 0 0 1 14 -14 z M44 58 a4 4 0 0 0 8 0',
  red: 'M34 36 h20 a12 12 0 0 1 12 12 v2 a12 12 0 0 1 -12 12 h-4 l-5 10 -5 -10 h-6 a12 12 0 0 1 -12 -12 v-2 a12 12 0 0 1 12 -12 z',
  blue: 'M32 34 h24 a13 13 0 0 1 13 13 v3 a13 13 0 0 1 -13 13 h-5 l-5 11 -5 -11 h-9 a13 13 0 0 1 -13 -13 v-3 a13 13 0 0 1 13 -13 z M30 46 h38',
  moon: 'M48 22 a12 12 0 0 0 0 18 a12 12 0 0 1 0 -18 z M32 38 h32 a12 12 0 0 1 12 12 a12 12 0 0 1 -12 12 h-6 l-4 10 -5 -10 h-17 a12 12 0 0 1 -12 -12 a12 12 0 0 1 12 -12 z',
  black:
    'M30 34 l10 -8 h16 l10 8 v8 a14 14 0 0 1 -6 24 h-6 l-6 12 -6 -12 h-6 a14 14 0 0 1 -6 -24 z M38 30 h20',
  white:
    'M48 18 l7 9 h-14 z M30 33 h36 a13 13 0 0 1 13 13 v4 a13 13 0 0 1 -13 13 h-8 l-5 13 -5 -13 h-18 a13 13 0 0 1 -13 -13 v-4 a13 13 0 0 1 13 -13 z M22 44 l-8 -6 M74 44 l8 -6',
};

/** The everyday gifts: an emoji, and the movement that belongs to it. */
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
  label,
}: {
  appearance: GiftAppearance;
  /** Decides the silhouette and how much it does when opened. */
  rank?: string;
  /** For a standard gift, which emoji it is. */
  seriesCode?: string;
  size?: number;
  /** Animation is for a gift somebody opened, not for a shelf full of them. */
  playing?: boolean;
  label?: string;
}) {
  const id = useId().replace(/:/g, '');
  const backdrop = appearance.backdrop ?? {};
  const model = appearance.model ?? {};
  const tile = TILES[appearance.pattern?.tile ?? ''] ?? TILES.echo!;
  const emoji = seriesCode ? STANDARD_EMOJI[seriesCode] : undefined;
  const silhouette = SILHOUETTES[rank] ?? SILHOUETTES.red!;
  return (
    <div
      className={`gift-card${playing ? ' is-playing' : ''}`}
      data-rank={rank}
      data-motion={emoji ? (STANDARD_MOTION[seriesCode ?? ''] ?? 'sway') : undefined}
      style={
        {
          width: size,
          height: size,
          '--gift-from': backdrop.from ?? '#141821',
          '--gift-to': backdrop.to ?? '#2f3746',
          '--gift-glow': backdrop.glow ?? '#dfe7f5',
        } as CSSProperties
      }
      role={label ? 'img' : undefined}
      aria-label={label}
    >
      <svg className="gift-card-pattern" viewBox="0 0 96 96" aria-hidden>
        <defs>
          <pattern id={`tile-${id}`} width="16" height="16" patternUnits="userSpaceOnUse">
            <path d={tile} fill="none" stroke={backdrop.glow ?? '#dfe7f5'} strokeWidth="1" />
          </pattern>
        </defs>
        <rect width="96" height="96" fill={`url(#tile-${id})`} />
      </svg>
      {emoji ? (
        <span className="gift-card-emoji" style={{ fontSize: size * 0.46 }}>
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
              d={silhouette}
              fill={model.body ?? '#cbb9a4'}
              stroke={model.edge ?? '#9b8a76'}
              strokeWidth="2.5"
              strokeLinejoin="round"
            />
            <circle cx="58" cy="49" r="4.5" fill={model.edge ?? '#9b8a76'} opacity="0.75" />
          </g>
        </svg>
      )}
    </div>
  );
}
