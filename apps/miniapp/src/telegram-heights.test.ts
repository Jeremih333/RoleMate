import { afterEach, describe, expect, it, vi } from 'vitest';
import { trackMusicPlayerHeight, trackTopbarHeight } from './telegram.js';

function elementOfHeight(height: number): HTMLElement {
  const element = document.createElement('div');
  vi.spyOn(element, 'getBoundingClientRect').mockReturnValue({
    height,
    width: 320,
    top: 0,
    left: 0,
    right: 320,
    bottom: height,
    x: 0,
    y: 0,
    toJSON: () => ({}),
  });
  document.body.append(element);
  return element;
}

afterEach(() => {
  document.documentElement.style.removeProperty('--topbar-height');
  document.documentElement.style.removeProperty('--music-player-height');
  document.body.replaceChildren();
  vi.restoreAllMocks();
});

describe('publishing measured heights to the layout', () => {
  it('publishes the header height rather than leaving the layout to guess', () => {
    const stop = trackTopbarHeight(elementOfHeight(78));
    expect(document.documentElement.style.getPropertyValue('--topbar-height')).toBe('78px');
    stop();
    // The header is always there, so its value stays for the next measurement.
    expect(document.documentElement.style.getPropertyValue('--topbar-height')).toBe('78px');
  });

  it('publishes the music strip height and drops it back to zero when it goes', () => {
    const stop = trackMusicPlayerHeight(elementOfHeight(92));
    expect(document.documentElement.style.getPropertyValue('--music-player-height')).toBe('92px');
    // Closing the player must not leave the layout inset by a strip that is gone —
    // that is the gap under the header people were seeing.
    stop();
    expect(document.documentElement.style.getPropertyValue('--music-player-height')).toBe('0px');
  });

  it('does nothing when there is no element to measure', () => {
    expect(() => trackMusicPlayerHeight(null)()).not.toThrow();
    expect(document.documentElement.style.getPropertyValue('--music-player-height')).toBe('');
  });
});
