import { useId, type CSSProperties } from 'react';

/**
 * A whistle on its card.
 *
 * Every gift in the series shows the same silhouette in the same place — that is
 * what makes them one series — and everything around it is what makes a
 * particular copy itself: the whistle's material, the pattern tiled behind it
 * and the backdrop it sits on. The rarer the rank, the darker the card, which is
 * the rule the ranks of the Abyss already imply.
 *
 * It is drawn rather than fetched: a marketplace shows dozens of these at once,
 * and dozens of pictures would be dozens of requests on a plan that has a
 * hundred thousand a day. The whistle only moves once somebody opens it.
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

export function GiftCard({
  appearance,
  size = 132,
  playing = false,
  label,
}: {
  appearance: GiftAppearance;
  size?: number;
  /** Animation is for a gift somebody opened, not for a shelf full of them. */
  playing?: boolean;
  label?: string;
}) {
  const id = useId().replace(/:/g, '');
  const backdrop = appearance.backdrop ?? {};
  const model = appearance.model ?? {};
  const tile = TILES[appearance.pattern?.tile ?? ''] ?? TILES.echo!;
  return (
    <div
      className={`gift-card${playing ? ' is-playing' : ''}`}
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
      <svg className="gift-card-whistle" viewBox="0 0 96 96" aria-hidden>
        <g className="gift-card-cord" stroke={model.cord ?? '#5f5346'} strokeWidth="3" fill="none">
          <path d="M30 22 C40 10 56 10 66 22" />
        </g>
        <g className="gift-card-body">
          {/* The same silhouette on every card in the series; only the material
              and the light on it change from copy to copy. */}
          <path
            d="M34 34 h22 a10 10 0 0 1 10 10 v6 a10 10 0 0 1 -10 10 h-6 l-4 12 -6 -12 h-6 a10 10 0 0 1 -10 -10 v-6 a10 10 0 0 1 10 -10 z"
            fill={model.body ?? '#cbb9a4'}
            stroke={model.edge ?? '#9b8a76'}
            strokeWidth="2.5"
          />
          <circle cx="58" cy="47" r="4.5" fill={model.edge ?? '#9b8a76'} opacity="0.75" />
        </g>
      </svg>
    </div>
  );
}
