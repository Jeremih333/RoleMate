/**
 * How many things may move at once.
 *
 * A profile with an animated avatar and a wall of animated emoji asks a phone to
 * run dozens of players at the same time, and a modest device simply cannot: the
 * page stutters and scrolling goes with it. What is on screen gets to play, up
 * to a budget, and everything past it stays a still picture — which is what an
 * emoji looks like anyway until it is looked at.
 *
 * The budget is a guess at the device, not a setting: a phone reporting few
 * cores or little memory gets a small one. Somebody who has asked their system
 * for less motion gets none at all.
 */
const claims = new Set<() => void>();

export function prefersReducedMotion(): boolean {
  return (
    typeof window !== 'undefined' &&
    typeof window.matchMedia === 'function' &&
    window.matchMedia('(prefers-reduced-motion: reduce)').matches
  );
}

export function animationBudget(): number {
  if (prefersReducedMotion()) return 0;
  if (typeof navigator === 'undefined') return 12;
  const cores = navigator.hardwareConcurrency ?? 8;
  const memory: unknown = Reflect.get(navigator, 'deviceMemory');
  const gigabytes = typeof memory === 'number' ? memory : 8;
  if (cores <= 4 || gigabytes <= 4) return 4;
  if (cores <= 8) return 8;
  return 12;
}

/**
 * Asks for a place among the things allowed to move. Returns the way to give it
 * back, or nothing when the budget is full — the caller then stays still.
 */
export function claimAnimationSlot(stop: () => void): (() => void) | null {
  if (claims.size >= animationBudget()) return null;
  claims.add(stop);
  return () => claims.delete(stop);
}

/** Only for tests: forgets every claim so each case starts from an empty budget. */
export function resetAnimationBudget(): void {
  claims.clear();
}
