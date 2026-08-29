import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
} from 'react';
import { useQuery } from '@tanstack/react-query';
import { api, type CustomEmojiDescriptor } from '../api.js';
import { useCustomEmojiArchives } from './use-custom-emoji-archives.js';
import type { CustomEmojiRenderKind } from './custom-emoji-glyph.js';

export interface CustomEmojiInfo {
  renderKind: CustomEmojiRenderKind;
  packId: string | null;
  emoji: string;
  src?: string;
  sourceType?: string;
}

interface LibraryValue {
  lookup: (customEmojiId: string) => CustomEmojiInfo | undefined;
  want: (customEmojiId: string) => void;
}

const LibraryContext = createContext<LibraryValue>({
  lookup: () => undefined,
  want: () => undefined,
});

/**
 * Everything the app knows about custom emoji, in one place.
 *
 * Two things live here. The imported packs arrive as archives — one request per
 * pack instead of one per glyph, which is the whole reason a picker of hundreds
 * of emoji is affordable at all. And an emoji met in text that belongs to nobody
 * here is collected and asked about in batches, the way a Telegram client
 * resolves an unknown emoji by id, so a message written with somebody else's set
 * still draws instead of showing a gap.
 */
export function CustomEmojiLibraryProvider({ children }: { children: React.ReactNode }) {
  const library = useQuery({
    queryKey: ['custom-emoji-packs'],
    queryFn: api.customEmojiPacks,
    staleTime: 30 * 60_000,
  });
  // Only the packs this person actually has: the library is shared, and pulling
  // an archive for every pack in it would be the very burst we are avoiding.
  const ownPackIds = useMemo(
    () => (library.data?.packs ?? []).filter((pack) => pack.is_own === 1).map((pack) => pack.id),
    [library.data],
  );
  const sources = useCustomEmojiArchives(ownPackIds);
  const [described, setDescribed] = useState<Map<string, CustomEmojiDescriptor>>(new Map());
  const wanted = useRef(new Set<string>());
  const asked = useRef(new Set<string>());
  const [round, setRound] = useState(0);

  const known = useMemo(() => {
    const map = new Map<string, CustomEmojiInfo>();
    for (const item of library.data?.emoji ?? []) {
      const source = sources.get(item.custom_emoji_id);
      map.set(item.custom_emoji_id, {
        renderKind: item.render_kind,
        packId: item.pack_id,
        emoji: item.emoji,
        ...(source ? { src: source.url, sourceType: source.contentType } : {}),
      });
    }
    for (const [id, item] of described) {
      if (map.has(id)) continue;
      map.set(id, { renderKind: item.render_kind, packId: item.pack_id, emoji: item.emoji });
    }
    return map;
  }, [library.data, sources, described]);

  const want = useCallback(
    (customEmojiId: string) => {
      if (!/^[0-9]{1,32}$/.test(customEmojiId)) return;
      if (asked.current.has(customEmojiId) || wanted.current.has(customEmojiId)) return;
      wanted.current.add(customEmojiId);
      setRound((value) => value + 1);
    },
    [setRound],
  );

  useEffect(() => {
    if (!wanted.current.size) return;
    // Collected for a moment first: a screenful of text asks about its emoji one
    // by one, and they should leave as a single question.
    const timer = setTimeout(() => {
      const ids = [...wanted.current].filter((id) => !known.has(id)).slice(0, 200);
      for (const id of wanted.current) asked.current.add(id);
      wanted.current.clear();
      if (!ids.length) return;
      void api
        .describeCustomEmoji(ids)
        .then((rows) => {
          setDescribed((previous) => {
            const next = new Map(previous);
            for (const row of rows) next.set(row.custom_emoji_id, row);
            return next;
          });
        })
        .catch(() => {
          // An emoji that cannot be described simply keeps its still picture.
        });
    }, 200);
    return () => clearTimeout(timer);
  }, [round, known]);

  const value = useMemo<LibraryValue>(
    () => ({ lookup: (customEmojiId) => known.get(customEmojiId), want }),
    [known, want],
  );
  return <LibraryContext.Provider value={value}>{children}</LibraryContext.Provider>;
}

/** What is known about one emoji, asking about it if this is the first sighting. */
export function useCustomEmoji(customEmojiId: string): CustomEmojiInfo | undefined {
  const { lookup, want } = useContext(LibraryContext);
  const info = lookup(customEmojiId);
  useEffect(() => {
    if (!info) want(customEmojiId);
  }, [customEmojiId, info, want]);
  return info;
}

/** The archive sources for the packs already loaded, for a grid to paint from. */
export function useCustomEmojiSources(): (customEmojiId: string) => CustomEmojiInfo | undefined {
  return useContext(LibraryContext).lookup;
}

/**
 * The props that hand a glyph bytes the app already has. Anything not in an
 * imported pack simply gets nothing back and fetches its own picture, which the
 * browser then keeps for a year.
 */
export function useGlyphSource(): (customEmojiId: string) => {
  srcOverride?: string;
  sourceType?: string;
} {
  const lookup = useContext(LibraryContext).lookup;
  return (customEmojiId) => {
    const info = lookup(customEmojiId);
    if (!info?.src) return {};
    return {
      srcOverride: info.src,
      ...(info.sourceType ? { sourceType: info.sourceType } : {}),
    };
  };
}

/**
 * The character a custom emoji falls back to — what a client without the pack
 * would see, and what stands in for it while the text is being written.
 */
export function useCustomEmojiBase(): (customEmojiId: string) => string | undefined {
  const lookup = useContext(LibraryContext).lookup;
  return (customEmojiId) => lookup(customEmojiId)?.emoji || undefined;
}
