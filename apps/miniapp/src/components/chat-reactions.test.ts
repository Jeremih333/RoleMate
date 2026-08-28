import { describe, expect, it } from 'vitest';
import { parseMessageReactions } from './chat-reactions.js';

describe('chat reaction summaries', () => {
  it('keeps well formed reaction counts in order', () => {
    expect(
      parseMessageReactions('[{"reaction":"heart","count":2},{"reaction":"🔥","count":1}]'),
    ).toEqual([
      { reaction: 'heart', count: 2 },
      { reaction: '🔥', count: 1 },
    ]);
  });

  it('treats missing, empty and malformed payloads as no reactions', () => {
    expect(parseMessageReactions(null)).toEqual([]);
    expect(parseMessageReactions('')).toEqual([]);
    expect(parseMessageReactions('[]')).toEqual([]);
    expect(parseMessageReactions('not json')).toEqual([]);
    expect(parseMessageReactions('{"reaction":"heart","count":1}')).toEqual([]);
  });

  it('drops entries that could not be rendered as a chip', () => {
    expect(
      parseMessageReactions(
        JSON.stringify([
          { reaction: '', count: 3 },
          { reaction: '   ', count: 3 },
          { reaction: 'x'.repeat(17), count: 3 },
          { reaction: 'heart' },
          { reaction: 'heart', count: 0 },
          { reaction: 'heart', count: -2 },
          { reaction: 'heart', count: Number.NaN },
          null,
          'heart',
          { reaction: 'heart', count: 4 },
        ]),
      ),
    ).toEqual([{ reaction: 'heart', count: 4 }]);
  });
});
