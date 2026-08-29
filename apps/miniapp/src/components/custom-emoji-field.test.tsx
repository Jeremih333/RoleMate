import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { CustomEmojiField } from './custom-emoji-field.js';

declare global {
  // React needs to be told it is running inside a test before act() is used.
  var IS_REACT_ACT_ENVIRONMENT: boolean;
}

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

function render(value: string): void {
  act(() => {
    root.render(
      <CustomEmojiField value={value}>
        <textarea value={value} readOnly />
      </CustomEmojiField>,
    );
  });
}

describe('writing with custom emoji in a field', () => {
  it('leaves plain text exactly as it was', () => {
    render('hello');
    expect(container.querySelector('.custom-emoji-field-mirror')).toBeNull();
    expect(container.querySelector('.custom-emoji-field')?.className).not.toContain('is-mirrored');
  });

  it('draws the emoji as soon as one is written into the text', () => {
    render('before [ce:5301] after');
    const mirror = container.querySelector('.custom-emoji-field-mirror');
    expect(mirror).not.toBeNull();
    expect(container.querySelector('.custom-emoji-field')?.className).toContain('is-mirrored');
    expect(mirror?.textContent).toBe('before [ce:5301] after');
    const picture = mirror?.querySelector('img');
    expect(picture?.getAttribute('src')).toBe('/api/custom-emoji/5301?thumbnail=1');
  });

  it('gives the picture the width of the token underneath it', () => {
    // The glyph covers the characters it stands for rather than sitting beside
    // them, so nothing after it shifts and the caret keeps matching the text.
    render('[ce:5301]x');
    const slot = container.querySelector('.custom-emoji-field-slot');
    expect(slot?.querySelector('.custom-emoji-field-ghost')?.textContent).toBe('[ce:5301]');
    expect(slot?.querySelector('.custom-emoji-field-picture')).not.toBeNull();
  });

  it('draws every emoji in the text, in order, and keeps the words between them', () => {
    render('a [ce:1] b [ce:22] c');
    const mirror = container.querySelector('.custom-emoji-field-mirror');
    expect(
      [...(mirror?.querySelectorAll('img') ?? [])].map((image) => image.getAttribute('src')),
    ).toEqual(['/api/custom-emoji/1?thumbnail=1', '/api/custom-emoji/22?thumbnail=1']);
    expect(mirror?.textContent).toBe('a [ce:1] b [ce:22] c');
  });

  it('takes the overlay away again when the emoji is deleted', () => {
    render('[ce:5301]');
    expect(container.querySelector('.custom-emoji-field-mirror')).not.toBeNull();
    render('');
    expect(container.querySelector('.custom-emoji-field-mirror')).toBeNull();
  });
});

describe('the copy wrapping the same way the field does', () => {
  it('keeps the emoji inside the flow instead of making a box of it', () => {
    // A box cannot break across lines: the field wrapped in the middle of a
    // token while the copy pushed the whole emoji to the next line, and
    // everything after it stood in the wrong place.
    render('a [ce:5301] b');
    const slot = container.querySelector('.custom-emoji-field-slot');
    expect(slot?.tagName).toBe('SPAN');
    expect(slot?.getAttribute('style')).toBeNull();
  });

  it('draws the text around the emoji as the field holds it, spaces and all', () => {
    render('  a\n[ce:1]  b  ');
    expect(container.querySelector('.custom-emoji-field-mirror')?.textContent).toBe(
      '  a\n[ce:1]  b  ',
    );
  });
});
