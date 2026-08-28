import { gzipSync } from 'node:zlib';
import { describe, expect, it, vi } from 'vitest';
import type { Sticker } from 'grammy/types';
import {
  cacheCustomEmojiAsset,
  collectCustomEmoji,
  CUSTOM_EMOJI_MAX_BYTES,
  CUSTOM_EMOJI_SET_LIMIT,
  parseAddEmojiSetName,
} from '../src/custom-emoji.js';

// needs_repainting is missing from the installed type definitions even though
// Telegram sends it, so the fixture is assembled as a record and handed over as
// the shape the collector expects.
function sticker(overrides: Record<string, unknown>): Sticker {
  return {
    file_id: 'file-1',
    file_unique_id: 'unique-1',
    type: 'custom_emoji',
    width: 100,
    height: 100,
    is_animated: false,
    is_video: false,
    ...overrides,
  } as unknown as Sticker;
}

describe('addemoji links', () => {
  it('accepts the shapes people actually paste', () => {
    expect(parseAddEmojiSetName('https://t.me/addemoji/TopicIcons')).toBe('TopicIcons');
    expect(parseAddEmojiSetName('t.me/addemoji/TopicIcons')).toBe('TopicIcons');
    expect(parseAddEmojiSetName('http://www.t.me/addemoji/TopicIcons?single')).toBe('TopicIcons');
    expect(parseAddEmojiSetName('https://telegram.me/addemoji/TopicIcons')).toBe('TopicIcons');
    expect(parseAddEmojiSetName('tg://addemoji?set=TopicIcons')).toBe('TopicIcons');
    expect(
      parseAddEmojiSetName('look: https://t.me/addemoji/TGofficialadaptiveemoji_by_TgEmodziBot !'),
    ).toBe('TGofficialadaptiveemoji_by_TgEmodziBot');
  });

  it('ignores anything that is not an emoji pack link', () => {
    expect(parseAddEmojiSetName('https://t.me/addstickers/SomePack')).toBeNull();
    expect(parseAddEmojiSetName('https://t.me/rolemate')).toBeNull();
    expect(parseAddEmojiSetName('just a message about addemoji')).toBeNull();
    expect(parseAddEmojiSetName('')).toBeNull();
  });
});

describe('collecting a custom emoji set', () => {
  it('records the render kind for static, video and lottie emoji', () => {
    const collected = collectCustomEmoji([
      sticker({ custom_emoji_id: '1', emoji: '🙂' }),
      sticker({ custom_emoji_id: '2', is_video: true }),
      sticker({ custom_emoji_id: '3', is_animated: true }),
    ]);
    expect(collected.map((item) => item.renderKind)).toEqual(['static', 'video', 'lottie']);
    expect(collected[0]?.emoji).toBe('🙂');
  });

  it('carries the repaint flag Telegram sets on single-colour emoji', () => {
    const collected = collectCustomEmoji([
      sticker({ custom_emoji_id: '1', needs_repainting: true }),
      sticker({ custom_emoji_id: '2' }),
    ]);
    expect(collected.map((item) => item.needsRepainting)).toEqual([true, false]);
  });

  it('keeps the still thumbnail when Telegram provides one', () => {
    const collected = collectCustomEmoji([
      sticker({
        custom_emoji_id: '1',
        is_animated: true,
        thumbnail: {
          file_id: 'thumb-1',
          file_unique_id: 'thumb-unique',
          width: 100,
          height: 100,
        },
      }),
    ]);
    expect(collected[0]?.thumbnailFileId).toBe('thumb-1');
  });

  it('drops entries that cannot be stored instead of failing the import', () => {
    const collected = collectCustomEmoji([
      sticker({}),
      sticker({ custom_emoji_id: 'not-a-number' }),
      sticker({ custom_emoji_id: '3', file_size: CUSTOM_EMOJI_MAX_BYTES + 1 }),
      sticker({ custom_emoji_id: '4', file_size: 12_000 }),
    ]);
    expect(collected.map((item) => item.customEmojiId)).toEqual(['4']);
    expect(collected[0]?.fileSizeBytes).toBe(12_000);
  });

  it('stops at the limit Telegram itself enforces on a set', () => {
    const many = Array.from({ length: CUSTOM_EMOJI_SET_LIMIT + 25 }, (_, index) =>
      sticker({ custom_emoji_id: String(index + 1) }),
    );
    expect(collectCustomEmoji(many)).toHaveLength(CUSTOM_EMOJI_SET_LIMIT);
  });

  it('returns nothing for an empty set', () => {
    expect(collectCustomEmoji([])).toEqual([]);
  });
});

interface StoredAsset {
  customEmojiId: string;
  kind: string;
  contentType: string;
  dataBase64: string;
  byteSize: number;
}

function harness(options: {
  filePath?: string | undefined;
  body?: Uint8Array;
  responseStatus?: number;
  contentType?: string;
}) {
  const stored: StoredAsset[] = [];
  const bot = {
    api: {
      getFile: () =>
        Promise.resolve(options.filePath === undefined ? {} : { file_path: options.filePath }),
    },
  };
  const dataApi = {
    execute: (_operation: string, payload: unknown) => {
      stored.push(payload as StoredAsset);
      return Promise.resolve({ stored: true });
    },
  } as unknown as Parameters<typeof cacheCustomEmojiAsset>[0]['dataApi'];
  const fetchMock = vi.fn(() =>
    Promise.resolve(
      new Response(options.body ?? new Uint8Array([1, 2, 3]), {
        status: options.responseStatus ?? 200,
        headers: { 'Content-Type': options.contentType ?? 'image/webp' },
      }),
    ),
  );
  return { bot, dataApi, stored, fetchMock };
}

describe('caching a custom emoji', () => {
  const emoji = { file_id: 'file-1', thumbnail_file_id: 'thumb-1' };

  it('stores the still thumbnail as an image', async () => {
    const { bot, dataApi, stored, fetchMock } = harness({ filePath: 'stickers/one.webp' });
    vi.stubGlobal('fetch', fetchMock);
    const result = await cacheCustomEmojiAsset({
      bot,
      dataApi,
      token: 'test-token',
      customEmojiId: '5301',
      kind: 'thumbnail',
      emoji,
    });
    expect(result?.contentType).toBe('image/webp');
    expect(stored).toEqual([
      expect.objectContaining({ customEmojiId: '5301', kind: 'thumbnail', byteSize: 3 }),
    ]);
    vi.unstubAllGlobals();
  });

  it('unpacks a TGS into a Lottie document rather than shipping gzip to the browser', async () => {
    const lottie = JSON.stringify({ v: '5.5.7', fr: 60, layers: [] });
    const { bot, dataApi, stored, fetchMock } = harness({
      filePath: 'stickers/one.tgs',
      body: new Uint8Array(gzipSync(Buffer.from(lottie))),
    });
    vi.stubGlobal('fetch', fetchMock);
    const result = await cacheCustomEmojiAsset({
      bot,
      dataApi,
      token: 'test-token',
      customEmojiId: '5302',
      kind: 'animation',
      emoji,
    });
    expect(result?.contentType).toBe('application/json');
    expect(Buffer.from(result?.dataBase64 ?? '', 'base64').toString('utf8')).toBe(lottie);
    expect(stored[0]?.contentType).toBe('application/json');
    vi.unstubAllGlobals();
  });

  it('stores nothing when Telegram will not give the file', async () => {
    const withoutPath = harness({ filePath: undefined });
    vi.stubGlobal('fetch', withoutPath.fetchMock);
    await expect(
      cacheCustomEmojiAsset({
        bot: withoutPath.bot,
        dataApi: withoutPath.dataApi,
        token: 'test-token',
        customEmojiId: '5303',
        kind: 'thumbnail',
        emoji,
      }),
    ).resolves.toBeNull();
    expect(withoutPath.stored).toEqual([]);

    const throttled = harness({ filePath: 'stickers/one.webp', responseStatus: 429 });
    vi.stubGlobal('fetch', throttled.fetchMock);
    await expect(
      cacheCustomEmojiAsset({
        bot: throttled.bot,
        dataApi: throttled.dataApi,
        token: 'test-token',
        customEmojiId: '5304',
        kind: 'thumbnail',
        emoji,
      }),
    ).resolves.toBeNull();
    expect(throttled.stored).toEqual([]);
    vi.unstubAllGlobals();
  });

  it('asks for the animation file when the animation is what is wanted', async () => {
    const { bot, dataApi, fetchMock } = harness({ filePath: 'stickers/one.webm' });
    const getFile = vi.spyOn(bot.api, 'getFile');
    vi.stubGlobal('fetch', fetchMock);
    await cacheCustomEmojiAsset({
      bot,
      dataApi,
      token: 'test-token',
      customEmojiId: '5305',
      kind: 'animation',
      emoji,
    });
    expect(getFile).toHaveBeenCalledWith('file-1');
    vi.unstubAllGlobals();
  });
});
