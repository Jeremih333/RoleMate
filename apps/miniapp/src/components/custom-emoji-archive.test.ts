import { beforeEach, describe, expect, it, vi } from 'vitest';
import {
  createArchiveObjectUrls,
  parseCustomEmojiArchive,
  type ArchiveEntry,
} from './custom-emoji-archive.js';

function buildArchive(entries: Array<{ id: string; bytes: number[] }>): {
  buffer: ArrayBuffer;
  index: ArchiveEntry[];
} {
  const index: ArchiveEntry[] = [];
  let offset = 0;
  const payload: number[] = [];
  for (const entry of entries) {
    index.push({
      id: entry.id,
      emoji: '',
      renderKind: 'static',
      needsRepainting: 0,
      contentType: 'image/webp',
      offset,
      length: entry.bytes.length,
    });
    payload.push(...entry.bytes);
    offset += entry.bytes.length;
  }
  const indexBytes = new TextEncoder().encode(JSON.stringify({ version: 1, entries: index }));
  const buffer = new ArrayBuffer(4 + indexBytes.byteLength + payload.length);
  const view = new DataView(buffer);
  view.setUint32(0, indexBytes.byteLength);
  new Uint8Array(buffer, 4).set(indexBytes);
  new Uint8Array(buffer, 4 + indexBytes.byteLength).set(payload);
  return { buffer, index };
}

// jsdom has no object URLs; the test only cares that one is made per usable
// entry and released afterwards.
beforeEach(() => {
  let counter = 0;
  const revoked: string[] = [];
  vi.stubGlobal('URL', {
    ...URL,
    createObjectURL: () => `blob:test/${(counter += 1)}`,
    revokeObjectURL: (url: string) => revoked.push(url),
  });
});

describe('reading a pack archive', () => {
  it('finds every glyph at the position the index promises', () => {
    const { buffer } = buildArchive([
      { id: '1', bytes: [1, 2, 3] },
      { id: '2', bytes: [4, 5] },
      { id: '3', bytes: [6, 7, 8, 9] },
    ]);
    const archive = parseCustomEmojiArchive(buffer);
    expect(archive.entries.map((entry) => entry.id)).toEqual(['1', '2', '3']);
    expect(archive.bytes.byteLength).toBe(9);
    const second = archive.entries[1]!;
    expect([...archive.bytes.subarray(second.offset, second.offset + second.length)]).toEqual([
      4, 5,
    ]);
  });

  it('refuses an archive whose index does not fit inside it', () => {
    const tooShort = new ArrayBuffer(2);
    expect(() => parseCustomEmojiArchive(tooShort)).toThrow();

    const lying = new ArrayBuffer(8);
    new DataView(lying).setUint32(0, 999);
    expect(() => parseCustomEmojiArchive(lying)).toThrow();
  });

  it('skips an entry that points past the end instead of handing out bad bytes', () => {
    const { buffer } = buildArchive([{ id: '1', bytes: [1, 2, 3] }]);
    const archive = parseCustomEmojiArchive(buffer);
    archive.entries.push({
      id: 'broken',
      emoji: '',
      renderKind: 'static',
      needsRepainting: 0,
      contentType: 'image/webp',
      offset: 100,
      length: 10,
    });
    const { urls, release } = createArchiveObjectUrls(archive);
    expect(urls.has('1')).toBe(true);
    expect(urls.has('broken')).toBe(false);
    release();
    expect(urls.size).toBe(0);
  });
});
