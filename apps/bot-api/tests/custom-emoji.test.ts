import { describe, expect, it } from 'vitest';
import type { Sticker } from 'grammy/types';
import {
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
