import { useEffect, useRef } from 'react';

/**
 * Closes something open when a tap lands outside it, or when Escape is pressed.
 *
 * A transparent backdrop is the usual way to do this, and it is what the chat
 * menu had — but a backdrop is `position: fixed`, and a fixed element inside an
 * ancestor that has a transform is laid out against that ancestor rather than
 * the window. Page transitions animate exactly such an ancestor, so the backdrop
 * covered whatever it happened to be inside and taps beside the menu reached
 * nothing at all: the menu could only be closed by the button that opened it.
 *
 * Listening on the document does not depend on where anything is painted.
 */
export function useDismiss<T extends HTMLElement, U extends HTMLElement = HTMLElement>(
  open: boolean,
  close: () => void,
): { ref: React.RefObject<T | null>; trigger: React.RefObject<U | null> } {
  const ref = useRef<T>(null);
  // The button that opens it counts as inside: a tap on it must toggle, and
  // closing first would let its own click open the menu straight back up.
  const trigger = useRef<U>(null);

  useEffect(() => {
    if (!open) return;
    const onPointerDown = (event: PointerEvent | MouseEvent) => {
      const target = event.target;
      if (target instanceof Node && (ref.current?.contains(target) ?? false)) return;
      if (target instanceof Node && (trigger.current?.contains(target) ?? false)) return;
      close();
    };
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') close();
    };
    // In the capture phase, so a tap closes the menu even when what it landed on
    // stops the event for its own purposes.
    document.addEventListener('pointerdown', onPointerDown, true);
    document.addEventListener('keydown', onKeyDown);
    return () => {
      document.removeEventListener('pointerdown', onPointerDown, true);
      document.removeEventListener('keydown', onKeyDown);
    };
  }, [open, close]);

  return { ref, trigger };
}
