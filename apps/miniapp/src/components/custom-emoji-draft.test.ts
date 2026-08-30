import { describe, expect, it } from 'vitest';
import {
  draftLength,
  draftPlaceholder,
  draftSegments,
  draftToStored,
  hasDraftPlaceholder,
  placeholderAfter,
  placeholderBefore,
  storedToDraft,
} from './custom-emoji-draft.js';

const HORSE = String.fromCodePoint(0x1f434);
const FACE = String.fromCodePoint(0x1f642);

describe('a custom emoji while it is being written', () => {
  it('takes exactly one visible character, whatever the id', () => {
    const short = draftPlaceholder('7', HORSE);
    const long = draftPlaceholder('5301234567890123456', HORSE);
    // Everything past the first character is a Unicode tag: invisible, and of no
    // width, which is what leaves no empty space beside the picture.
    expect(draftLength(short)).toBe(1);
    expect(draftLength(long)).toBe(1);
    expect([...short][0]).toBe(HORSE);
  });

  it('falls back to a face when the pack offers no character of its own', () => {
    expect([...draftPlaceholder('7', null)][0]).toBe(FACE);
    expect([...draftPlaceholder('7', '')][0]).toBe(FACE);
  });

  it('becomes the stored token when the text is sent, and comes back on edit', () => {
    const draft = `a ${draftPlaceholder('5301', HORSE)} b`;
    expect(draftToStored(draft)).toBe('a [ce:5301] b');
    const back = storedToDraft('a [ce:5301] b', () => HORSE);
    expect(back).toBe(draft);
    expect(draftToStored(back)).toBe('a [ce:5301] b');
  });

  it('leaves an ordinary emoji somebody typed exactly as it is', () => {
    expect(draftToStored(`I like ${HORSE} a lot`)).toBe(`I like ${HORSE} a lot`);
    expect(hasDraftPlaceholder(`plain ${HORSE}`)).toBe(false);
    expect(hasDraftPlaceholder(draftPlaceholder('1', HORSE))).toBe(true);
  });

  it('counts an emoji as one character beside the words', () => {
    expect(draftLength(`ab${draftPlaceholder('5301', HORSE)}c`)).toBe(4);
  });

  it('splits the text into what a field has to draw', () => {
    const placeholder = draftPlaceholder('5301', HORSE);
    expect(draftSegments(`a${placeholder}b`)).toEqual([
      { kind: 'text', value: 'a' },
      { kind: 'emoji', value: placeholder, customEmojiId: '5301' },
      { kind: 'text', value: 'b' },
    ]);
  });

  it('is removed whole by one press of backspace', () => {
    const placeholder = draftPlaceholder('5301', HORSE);
    const text = `a${placeholder}b`;
    const caret = 1 + placeholder.length;
    expect(placeholderBefore(text, caret)).toBe(placeholder.length);
    expect(placeholderBefore(text, caret - 1)).toBeNull();
    expect(placeholderAfter(text, 1)).toBe(placeholder.length);
    expect(placeholderAfter(text, 0)).toBeNull();
    expect(text.slice(0, caret - placeholder.length) + text.slice(caret)).toBe('ab');
  });
});
