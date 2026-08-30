import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { CustomEmojiField } from './custom-emoji-field.js';
import { draftPlaceholder } from './custom-emoji-draft.js';

declare global {
  var IS_REACT_ACT_ENVIRONMENT: boolean;
}

const HORSE = String.fromCodePoint(0x1f434);

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

function render(value: string, onChange?: (next: string) => void): void {
  act(() => {
    root.render(
      <CustomEmojiField value={value} {...(onChange ? { onChange } : {})}>
        <textarea value={value} readOnly />
      </CustomEmojiField>,
    );
  });
}

describe('writing with custom emoji in a field', () => {
  it('leaves plain text exactly as it was', () => {
    render(`hello ${HORSE}`);
    expect(container.querySelector('.custom-emoji-field-mirror')).toBeNull();
    expect(container.querySelector('.custom-emoji-field')?.className).not.toContain('is-mirrored');
  });

  it('draws the emoji as soon as one is written into the text', () => {
    const placeholder = draftPlaceholder('5301', HORSE);
    render(`before ${placeholder} after`);
    expect(container.querySelector('.custom-emoji-field-mirror')).not.toBeNull();
    expect(container.querySelector('.custom-emoji-field')?.className).toContain('is-mirrored');
    expect(container.querySelector('img')?.getAttribute('src')).toBe(
      '/api/custom-emoji/5301?thumbnail=1',
    );
  });

  it('covers one character and nothing more', () => {
    // The hole to the right of an emoji was a nine-character token hiding under
    // a picture; the box is the emoji's own box now.
    const placeholder = draftPlaceholder('5301', HORSE);
    render(placeholder);
    const ghost = container.querySelector('.custom-emoji-field-ghost');
    expect(ghost?.textContent).toBe(placeholder);
    expect([...(ghost?.textContent ?? '')][0]).toBe(HORSE);
    expect(container.querySelector('.custom-emoji-field-slot')?.getAttribute('style')).toBeNull();
  });

  it('draws every emoji in order and keeps the words between them', () => {
    const first = draftPlaceholder('1', HORSE);
    const second = draftPlaceholder('22', HORSE);
    render(`a ${first} b ${second} c`);
    expect(
      [...container.querySelectorAll('img')].map((image) => image.getAttribute('src')),
    ).toEqual(['/api/custom-emoji/1?thumbnail=1', '/api/custom-emoji/22?thumbnail=1']);
    expect(container.querySelector('.custom-emoji-field-mirror')?.textContent).toBe(
      `a ${first} b ${second} c`,
    );
  });

  it('takes the overlay away again when the emoji is deleted', () => {
    render(draftPlaceholder('5301', HORSE));
    expect(container.querySelector('.custom-emoji-field-mirror')).not.toBeNull();
    render('');
    expect(container.querySelector('.custom-emoji-field-mirror')).toBeNull();
  });

  it('removes a whole emoji on one press of backspace', () => {
    const placeholder = draftPlaceholder('5301', HORSE);
    const changes: string[] = [];
    render(`a${placeholder}b`, (next) => changes.push(next));
    const field = container.querySelector('textarea')!;
    field.setSelectionRange(1 + placeholder.length, 1 + placeholder.length);
    act(() => {
      field.dispatchEvent(new KeyboardEvent('keydown', { key: 'Backspace', bubbles: true }));
    });
    expect(changes).toEqual(['ab']);
  });

  it('leaves an ordinary character to the field itself', () => {
    const placeholder = draftPlaceholder('5301', HORSE);
    const changes: string[] = [];
    render(`ab${placeholder}`, (next) => changes.push(next));
    const field = container.querySelector('textarea')!;
    field.setSelectionRange(1, 1);
    act(() => {
      field.dispatchEvent(new KeyboardEvent('keydown', { key: 'Backspace', bubbles: true }));
    });
    expect(changes).toEqual([]);
  });
});

describe('the copy wrapping the same way the field does', () => {
  it('takes its wrapping rules from the field rather than guessing them', () => {
    vi.spyOn(window, 'getComputedStyle').mockReturnValue({
      getPropertyValue: (property: string) => (property === 'white-space' ? 'pre-wrap' : ''),
    } as unknown as CSSStyleDeclaration);
    render(draftPlaceholder('5301', HORSE));
    expect(container.querySelector('.custom-emoji-field-mirror')?.getAttribute('style')).toContain(
      'white-space: pre-wrap',
    );
    vi.restoreAllMocks();
  });

  it('draws the text around the emoji exactly as the field holds it', () => {
    const placeholder = draftPlaceholder('1', HORSE);
    render(`  a\n${placeholder}  b  `);
    expect(container.querySelector('.custom-emoji-field-mirror')?.textContent).toBe(
      `  a\n${placeholder}  b  `,
    );
  });
});
