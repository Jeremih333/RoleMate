import { gzipSync } from 'node:zlib';
import { describe, expect, it, vi } from 'vitest';
import type { Sticker } from 'grammy/types';
import {
  cacheCustomEmojiAsset,
  collectCustomEmoji,
  CUSTOM_EMOJI_MAX_BYTES,
  CUSTOM_EMOJI_MAX_STORED_BYTES,
  CUSTOM_EMOJI_SET_LIMIT,
  describeCustomEmoji,
  inlineCustomEmojiTokens,
  parseAddEmojiSetName,
} from '../src/custom-emoji.js';

/** A custom emoji occupies two UTF-16 units in the text Telegram sends. */
const FACE = String.fromCodePoint(0x1f642);

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

  it('stores the still thumbnail as an image even though Telegram calls it a byte stream', async () => {
    const { bot, dataApi, stored, fetchMock } = harness({
      filePath: 'stickers/one.webp',
      contentType: 'application/octet-stream',
    });
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
      expect.objectContaining({
        customEmojiId: '5301',
        kind: 'thumbnail',
        contentType: 'image/webp',
        byteSize: 3,
      }),
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

  it('labels a video emoji as a video', async () => {
    const { bot, dataApi, stored, fetchMock } = harness({
      filePath: 'stickers/one.webm',
      contentType: 'application/octet-stream',
    });
    vi.stubGlobal('fetch', fetchMock);
    const result = await cacheCustomEmojiAsset({
      bot,
      dataApi,
      token: 'test-token',
      customEmojiId: '5306',
      kind: 'animation',
      emoji,
    });
    expect(result?.contentType).toBe('video/webm');
    expect(stored[0]?.contentType).toBe('video/webm');
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

describe('keeping custom emoji that arrive in a message', () => {
  // Telegram sends the emoji character in the text and the id only in an entity,
  // so text stored as it arrives loses the emoji entirely.
  it('writes each entity back into the text as a token', () => {
    const text = `a ${FACE} b ${FACE}`;
    expect(
      inlineCustomEmojiTokens(text, [
        { type: 'custom_emoji', offset: 2, length: 2, custom_emoji_id: '11' },
        { type: 'custom_emoji', offset: 7, length: 2, custom_emoji_id: '22' },
      ]),
    ).toBe('a [ce:11] b [ce:22]');
  });

  it('leaves everything else alone', () => {
    const text = `a ${FACE}`;
    expect(inlineCustomEmojiTokens(text, [{ type: 'bold', offset: 0, length: 3 }])).toBe(text);
    expect(inlineCustomEmojiTokens(text, undefined)).toBe(text);
    expect(
      inlineCustomEmojiTokens(text, [
        { type: 'custom_emoji', offset: 0, length: 99, custom_emoji_id: '11' },
        { type: 'custom_emoji', offset: 2, length: 2, custom_emoji_id: 'not-a-number' },
      ]),
    ).toBe(text);
  });
});

describe('describing emoji nobody here has imported', () => {
  const descriptor = {
    custom_emoji_id: '77',
    pack_id: 'pack-1',
    emoji: '',
    render_kind: 'static' as const,
    needs_repainting: 0,
    set_name: 'SomeSet',
    title: 'SomeSet',
  };

  it('asks Telegram once for the unknown ids and writes down the set', async () => {
    const execute = vi
      .fn()
      .mockResolvedValueOnce([])
      .mockResolvedValueOnce({ packId: 'pack-1', added: 1 })
      .mockResolvedValueOnce([descriptor]);
    const getCustomEmojiStickers = vi
      .fn()
      .mockResolvedValue([sticker({ custom_emoji_id: '77', set_name: 'SomeSet' })]);
    const described = await describeCustomEmoji({
      bot: { api: { getCustomEmojiStickers } },
      dataApi: { execute } as never,
      customEmojiIds: ['77', '77', 'nonsense'],
    });
    expect(getCustomEmojiStickers).toHaveBeenCalledWith(['77']);
    expect(execute.mock.calls[1]?.[0]).toBe('customEmoji.adopt');
    expect(described).toEqual([descriptor]);
  });

  it('does not go to Telegram when everything is already known', async () => {
    const execute = vi.fn().mockResolvedValueOnce([descriptor]);
    const getCustomEmojiStickers = vi.fn();
    expect(
      await describeCustomEmoji({
        bot: { api: { getCustomEmojiStickers } },
        dataApi: { execute } as never,
        customEmojiIds: ['77'],
      }),
    ).toEqual([descriptor]);
    expect(getCustomEmojiStickers).not.toHaveBeenCalled();
  });
});

describe('a picture too large to keep', () => {
  it('still reaches the reader, and is simply not stored', async () => {
    // An unpacked Lottie can be bigger than what fits between the two workers.
    // Failing the request there is what left animated emoji as stills.
    const huge = new Uint8Array(CUSTOM_EMOJI_MAX_STORED_BYTES + 1_024);
    const { bot, dataApi, stored, fetchMock } = harness({
      filePath: 'stickers/one.json',
      body: huge,
    });
    vi.stubGlobal('fetch', fetchMock);
    const result = await cacheCustomEmojiAsset({
      bot,
      dataApi,
      token: 'test-token',
      customEmojiId: '5401',
      kind: 'animation',
      emoji: { file_id: 'file-1', thumbnail_file_id: null },
    });
    expect(result?.contentType).toBe('application/json');
    expect(Buffer.from(result?.dataBase64 ?? '', 'base64').byteLength).toBe(huge.byteLength);
    expect(stored).toEqual([]);
    vi.unstubAllGlobals();
  });

  it('hands the picture over even when keeping it fails', async () => {
    const { bot, fetchMock } = harness({ filePath: 'stickers/one.webp' });
    const failing = {
      execute: () => Promise.reject(new Error('Payload is too large')),
    } as unknown as Parameters<typeof cacheCustomEmojiAsset>[0]['dataApi'];
    vi.stubGlobal('fetch', fetchMock);
    await expect(
      cacheCustomEmojiAsset({
        bot,
        dataApi: failing,
        token: 'test-token',
        customEmojiId: '5402',
        kind: 'thumbnail',
        emoji: { file_id: 'file-1', thumbnail_file_id: 'thumb-1' },
      }),
    ).resolves.toMatchObject({ contentType: 'image/webp' });
    vi.unstubAllGlobals();
  });
});
