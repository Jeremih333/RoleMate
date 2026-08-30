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

/** One glyph's bytes, and what they are: a still, a video or a Lottie document. */
export interface ArchiveSource {
  url: string;
  contentType: string;
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
 * Turns one archive into a source per glyph. The content type travels with the
 * bytes because not every emoji has a still picture: where Telegram offers no
 * separate thumbnail the archive carries the emoji itself, and whoever draws it
 * has to know whether that is an image, a video or a Lottie document.
 *
 * The caller must release the sources when it is done: an object URL lives until
 * it is revoked, and a few hundred of them held for a session is a leak nobody
 * would go looking for.
 */
export function createArchiveObjectUrls(archive: ParsedArchive): {
  urls: Map<string, ArchiveSource>;
  release: () => void;
} {
  const urls = new Map<string, ArchiveSource>();
  for (const entry of archive.entries) {
    if (entry.offset + entry.length > archive.bytes.byteLength) continue;
    // Copied rather than viewed: a Blob wants its own buffer, and a subarray of
    // the archive would keep the whole thing alive for one glyph.
    const slice = archive.bytes.slice(entry.offset, entry.offset + entry.length);
    urls.set(entry.id, {
      url: URL.createObjectURL(new Blob([slice.buffer], { type: entry.contentType })),
      contentType: entry.contentType,
    });
  }
  return {
    urls,
    release: () => {
      for (const source of urls.values()) URL.revokeObjectURL(source.url);
      urls.clear();
    },
  };
}
