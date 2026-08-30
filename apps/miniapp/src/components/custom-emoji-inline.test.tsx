import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { CustomEmojiInline } from './custom-emoji-inline.js';

let container: HTMLDivElement;
let root: Root;

beforeEach(() => {
  globalThis.IS_REACT_ACT_ENVIRONMENT = true;
  container = document.createElement('div');
  document.body.append(container);
  root = createRoot(container);
});

afterEach(() => {
  act(() => root.unmount());
  container.remove();
});

function render(text: string): void {
  act(() => root.render(<CustomEmojiInline text={text} />));
}

describe('a line of text that holds custom emoji', () => {
  it('draws the emoji instead of printing its token', () => {
    // A reply quote showed `[ce:5339121107477733735]` to the reader, which is
    // machinery leaking into a conversation.
    render('[ce:5301][ce:5302] aaa');
    expect(container.textContent).toBe(' aaa');
    expect(
      [...container.querySelectorAll('img')].map((image) => image.getAttribute('src')),
    ).toEqual(['/api/custom-emoji/5301?thumbnail=1', '/api/custom-emoji/5302?thumbnail=1']);
  });

  it('keeps the words around it in place', () => {
    render('before [ce:5301] after');
    expect(container.textContent).toBe('before  after');
    expect(container.querySelectorAll('img')).toHaveLength(1);
  });

  it('leaves a line without emoji exactly as it is', () => {
    render('nothing to draw here');
    expect(container.textContent).toBe('nothing to draw here');
    expect(container.querySelector('img')).toBeNull();
    expect(container.querySelector('span')).toBeNull();
  });
});
