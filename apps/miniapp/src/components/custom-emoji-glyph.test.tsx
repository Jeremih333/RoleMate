import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { CustomEmojiGlyph } from './custom-emoji-glyph.js';

let container: HTMLDivElement;
let root: Root;
let requested: string[];

/** Lets the effect that loads a glyph finish before the test looks at it. */
const settle = () => Promise.resolve();

beforeEach(() => {
  globalThis.IS_REACT_ACT_ENVIRONMENT = true;
  container = document.createElement('div');
  document.body.append(container);
  root = createRoot(container);
  requested = [];
  vi.stubGlobal(
    'fetch',
    vi.fn((input: string) => {
      requested.push(input);
      return Promise.resolve(
        new Response('{}', { headers: { 'Content-Type': 'application/json' } }),
      );
    }),
  );
});

afterEach(() => {
  act(() => root.unmount());
  container.remove();
  vi.unstubAllGlobals();
});

describe('drawing one custom emoji', () => {
  it('plays an animated emoji instead of leaving it as a still', async () => {
    await act(async () => {
      root.render(<CustomEmojiGlyph customEmojiId="5301" renderKind="lottie" animate />);
      await settle();
    });
    expect(requested).toContain('/api/custom-emoji/5301?thumbnail=0');
  });

  it('asks for nothing to play when the emoji has nothing to play', async () => {
    await act(async () => {
      root.render(<CustomEmojiGlyph customEmojiId="5302" renderKind="static" animate />);
      await settle();
    });
    expect(requested).toEqual([]);
    expect(container.querySelector('img')?.getAttribute('src')).toBe(
      '/api/custom-emoji/5302?thumbnail=1',
    );
  });

  it('plays a video emoji from the bytes it was handed rather than fetching them again', async () => {
    await act(async () => {
      root.render(
        <CustomEmojiGlyph
          customEmojiId="5303"
          renderKind="video"
          animate
          srcOverride="blob:pack/5303"
          sourceType="video/webm"
        />,
      );
      await settle();
    });
    expect(requested).toEqual([]);
    expect(container.querySelector('video')?.getAttribute('src')).toBe('blob:pack/5303');
  });

  it('plays an emoji whose only bytes are the animation itself', async () => {
    // Telegram gives some emoji no separate still, so what the pack archive
    // carries for them is the video: an <img> would show nothing at all.
    await act(async () => {
      root.render(
        <CustomEmojiGlyph
          customEmojiId="5304"
          renderKind="video"
          srcOverride="blob:pack/5304"
          sourceType="video/webm"
        />,
      );
      await settle();
    });
    expect(container.querySelector('img')).toBeNull();
    expect(container.querySelector('video')?.getAttribute('src')).toBe('blob:pack/5304');
  });
});
