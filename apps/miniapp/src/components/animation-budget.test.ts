import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  animationBudget,
  claimAnimationSlot,
  prefersReducedMotion,
  resetAnimationBudget,
} from './animation-budget.js';

function device(cores: number, memory: number, reducedMotion = false): void {
  vi.stubGlobal('navigator', { hardwareConcurrency: cores, deviceMemory: memory });
  vi.stubGlobal('window', {
    matchMedia: (query: string) => ({ matches: reducedMotion && query.includes('reduced-motion') }),
  });
}

afterEach(() => {
  resetAnimationBudget();
  vi.unstubAllGlobals();
});

describe('how much may move at once', () => {
  it('gives a modest phone a small budget and a capable one a larger', () => {
    device(4, 4);
    expect(animationBudget()).toBe(4);
    device(8, 8);
    expect(animationBudget()).toBe(8);
    device(16, 16);
    expect(animationBudget()).toBe(12);
  });

  it('lets little memory alone shrink the budget', () => {
    device(16, 2);
    expect(animationBudget()).toBe(4);
  });

  it('stops everything for a reader who asked for less motion', () => {
    device(16, 16, true);
    expect(prefersReducedMotion()).toBe(true);
    expect(animationBudget()).toBe(0);
    expect(claimAnimationSlot(() => undefined)).toBeNull();
  });

  it('hands out places up to the budget and no further', () => {
    device(4, 4);
    const releases = Array.from({ length: 4 }, () => claimAnimationSlot(() => undefined));
    expect(releases.every(Boolean)).toBe(true);
    expect(claimAnimationSlot(() => undefined)).toBeNull();

    // A glyph scrolled off the screen gives its place back to whatever the
    // reader is looking at now.
    releases[0]?.();
    expect(claimAnimationSlot(() => undefined)).not.toBeNull();
  });
});
