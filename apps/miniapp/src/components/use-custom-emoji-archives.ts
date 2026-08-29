import { useEffect, useState } from 'react';
import { api } from '../api.js';
import { createArchiveObjectUrls, parseCustomEmojiArchive } from './custom-emoji-archive.js';

/**
 * Loads whole packs as archives and hands back a URL per glyph.
 *
 * A picker paints hundreds of glyphs; fetching each one separately is hundreds
 * of requests against a daily allowance of a hundred thousand. One archive per
 * pack is one request. If an archive cannot be had the map simply stays empty
 * and each glyph falls back to its own address, so the picker still works.
 */
export function useCustomEmojiArchives(packIds: string[]): Map<string, string> {
  const [urls, setUrls] = useState<Map<string, string>>(new Map());
  const key = packIds.join(',');

  useEffect(() => {
    if (!key) {
      setUrls(new Map());
      return;
    }
    let cancelled = false;
    const releases: Array<() => void> = [];
    const collected = new Map<string, string>();

    const load = async () => {
      for (const packId of key.split(',')) {
        try {
          const buffer = await api.customEmojiPackArchive(packId);
          if (cancelled) return;
          const { urls: packUrls, release } = createArchiveObjectUrls(
            parseCustomEmojiArchive(buffer),
          );
          releases.push(release);
          for (const [id, url] of packUrls) collected.set(id, url);
        } catch {
          // The individual pictures still work; nothing here is worth an error.
        }
      }
      if (!cancelled) setUrls(new Map(collected));
    };
    void load();

    return () => {
      cancelled = true;
      // Object URLs live until they are revoked, and a few hundred of them held
      // for a session is a leak nobody would go looking for.
      for (const release of releases) release();
    };
  }, [key]);

  return urls;
}
