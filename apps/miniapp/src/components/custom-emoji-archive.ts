/**
 * A pack of emoji arrives as one archive: four bytes saying how long the index
 * is, the index itself, then every glyph's bytes end to end.
 *
 * The picker paints hundreds of glyphs at once, and asking for each of them
 * separately is hundreds of requests against a daily allowance of a hundred
 * thousand. One archive is one request, and the index says where each glyph sits
 * inside it — the position in the grid, in other words.
 */
export interface ArchiveEntry {
  id: string;
  emoji: string;
  renderKind: 'static' | 'video' | 'lottie';
  needsRepainting: number;
  contentType: string;
  offset: number;
  length: number;
}

export interface ParsedArchive {
  entries: ArchiveEntry[];
  bytes: Uint8Array;
}

export function parseCustomEmojiArchive(buffer: ArrayBuffer): ParsedArchive {
  const view = new DataView(buffer);
  if (buffer.byteLength < 4) throw new Error('archive is too short to hold an index');
  const indexLength = view.getUint32(0);
  if (indexLength === 0 || 4 + indexLength > buffer.byteLength) {
    throw new Error('archive index does not fit inside the archive');
  }
  const indexBytes = new Uint8Array(buffer, 4, indexLength);
  const parsed: unknown = JSON.parse(new TextDecoder().decode(indexBytes));
  const entries =
    typeof parsed === 'object' && parsed !== null && Array.isArray(Reflect.get(parsed, 'entries'))
      ? (Reflect.get(parsed, 'entries') as ArchiveEntry[])
      : [];
  return { entries, bytes: new Uint8Array(buffer, 4 + indexLength) };
}

/**
 * Turns one archive into a URL per glyph. The caller must release them when the
 * picker closes: an object URL lives until it is revoked, and a few hundred of
 * them held for a session is a leak nobody would go looking for.
 */
export function createArchiveObjectUrls(archive: ParsedArchive): {
  urls: Map<string, string>;
  release: () => void;
} {
  const urls = new Map<string, string>();
  for (const entry of archive.entries) {
    if (entry.offset + entry.length > archive.bytes.byteLength) continue;
    // Copied rather than viewed: a Blob wants its own buffer, and a subarray of
    // the archive would keep the whole thing alive for one glyph.
    const slice = archive.bytes.slice(entry.offset, entry.offset + entry.length);
    urls.set(entry.id, URL.createObjectURL(new Blob([slice.buffer], { type: entry.contentType })));
  }
  return {
    urls,
    release: () => {
      for (const url of urls.values()) URL.revokeObjectURL(url);
      urls.clear();
    },
  };
}
