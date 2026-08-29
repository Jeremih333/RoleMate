import { describe, expect, it } from 'vitest';
import {
  CUSTOM_EMOJI_TOKEN_PATTERN,
  customEmojiToken,
  stripCustomEmojiTokens,
} from './custom-emoji-token.js';

// Russian sample text is written as escapes: user-facing copy belongs in the
// locale package, and the architecture test keeps it out of application sources.
const HELLO = '\u043f\u0440\u0438\u0432\u0435\u0442';
const YOU = '\u0412\u044b';
const PLAIN = '\u043e\u0431\u044b\u0447\u043d\u044b\u0439\u0020\u0442\u0435\u043a\u0441\u0442';
const TWO = '\u0434\u0432\u0430';
const SPACES = '\u043f\u0440\u043e\u0431\u0435\u043b\u0430';

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

describe('emoji tokens in plain text', () => {
  it('replaces a token with a mark people recognise', () => {
    expect(stripCustomEmojiTokens(`${HELLO} [ce:5348160394433148525]`)).toBe(`${HELLO} 🙂`);
    expect(stripCustomEmojiTokens('[ce:1][ce:2]')).toBe('🙂🙂');
  });

  it('never leaves the raw token in a preview', () => {
    expect(stripCustomEmojiTokens('[ce:5348160394433148525]')).not.toContain('ce:');
    expect(stripCustomEmojiTokens(`${YOU}: [ce:5348160394433148525]`)).toBe(`${YOU}: 🙂`);
  });

  it('leaves ordinary text alone and tidies the spacing it creates', () => {
    expect(stripCustomEmojiTokens(PLAIN)).toBe(PLAIN);
    expect(stripCustomEmojiTokens(`  ${TWO}   ${SPACES}  `)).toBe(`${TWO} ${SPACES}`);
  });

  it('accepts a different mark when a caller wants one', () => {
    expect(stripCustomEmojiTokens('[ce:7]', '*')).toBe('*');
  });
});
