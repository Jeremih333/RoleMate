import { useEffect, useRef, useState } from 'react';
import { prefersReducedMotion } from './animation-budget.js';

/**
 * Whether an element is worth animating right now.
 *
 * A feed plays every video it holds, including the ones far below the fold, and
 * on a modest phone that is what makes scrolling stutter. This says yes only
 * while the element is near the screen and the tab is in front, and never when
 * the reader has asked their system for less motion.
 */
export function useInView<T extends Element>(): {
  ref: React.RefObject<T | null>;
  inView: boolean;
} {
  const ref = useRef<T>(null);
  const [inView, setInView] = useState(false);

  useEffect(() => {
    if (prefersReducedMotion()) return;
    const element = ref.current;
    if (!element) return;
    if (typeof IntersectionObserver === 'undefined') {
      setInView(true);
      return;
    }
    const observer = new IntersectionObserver(
      ([entry]) =>
        setInView(Boolean(entry?.isIntersecting) && document.visibilityState === 'visible'),
      { rootMargin: '200px' },
    );
    const onVisibility = () => {
      if (document.visibilityState !== 'visible') setInView(false);
    };
    observer.observe(element);
    document.addEventListener('visibilitychange', onVisibility);
    return () => {
      observer.disconnect();
      document.removeEventListener('visibilitychange', onVisibility);
    };
  }, []);

  return { ref, inView };
}
