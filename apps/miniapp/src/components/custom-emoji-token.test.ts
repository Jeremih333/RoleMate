import { describe, expect, it } from 'vitest';
import { CUSTOM_EMOJI_TOKEN_PATTERN, customEmojiToken } from './custom-emoji-token.js';

function tokens(text: string): string[] {
  return [...text.matchAll(CUSTOM_EMOJI_TOKEN_PATTERN)].map((match) => match[1]!);
}

describe('custom emoji tokens in text', () => {
  it('writes and finds a token', () => {
    expect(customEmojiToken('5301')).toBe('[ce:5301]');
    expect(tokens('hello [ce:5301] world')).toEqual(['5301']);
  });

  it('finds every token in a line, including adjacent ones', () => {
    expect(tokens('[ce:1][ce:22] and [ce:333]')).toEqual(['1', '22', '333']);
  });

  it('ignores anything that is not a token', () => {
    expect(tokens('[ce:] [ce:abc] [ce: 12] ce:12 [CE:12]')).toEqual([]);
    expect(tokens('a link [text](ce:12) stays a link')).toEqual([]);
  });

  it('does not match an id longer than Telegram can produce', () => {
    expect(tokens(`[ce:${'9'.repeat(33)}]`)).toEqual([]);
    expect(tokens(`[ce:${'9'.repeat(32)}]`)).toEqual(['9'.repeat(32)]);
  });
});
