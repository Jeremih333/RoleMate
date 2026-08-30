import { useEffect, useRef, useState } from 'react';
import { claimAnimationSlot } from './animation-budget.js';

export type CustomEmojiRenderKind = 'static' | 'video' | 'lottie';

/**
 * One custom emoji.
 *
 * The still thumbnail is always what appears first: it is a few kilobytes, it is
 * cached for a year, and it is all a picker of hundreds of glyphs ever needs.
 * When `animate` is asked for, a Lottie document is loaded on top of it once the
 * glyph is actually on screen, and the runtime itself is imported only at that
 * moment — nobody who never opens an animated emoji pays for it in the bundle.
 */
export function CustomEmojiGlyph({
  customEmojiId,
  renderKind = 'static',
  label = '',
  size = 22,
  animate = false,
  srcOverride,
  sourceType,
}: {
  customEmojiId: string;
  renderKind?: CustomEmojiRenderKind;
  label?: string;
  size?: number;
  animate?: boolean;
  /** Bytes already in hand — from a pack archive — instead of a request of its own. */
  srcOverride?: string;
  /** What those bytes actually are, when the archive said so. */
  sourceType?: string;
}) {
  const holderRef = useRef<HTMLSpanElement>(null);
  const [playing, setPlaying] = useState(false);
  // A still picture is what a cell normally holds, but not every emoji has one:
  // when Telegram offers no separate thumbnail we keep the emoji itself, which is
  // a Lottie document or a small video. Drawing that in an <img> shows nothing at
  // all — the empty cells in a pack were exactly this — so the kind of the bytes
  // decides the element, and a picture that fails to decode falls back the same
  // way rather than leaving a hole.
  const [stillFailed, setStillFailed] = useState(false);
  const stillIsPicture = !sourceType || sourceType.startsWith('image/');
  const playInstead = renderKind !== 'static' && (!stillIsPicture || stillFailed);
  const shouldAnimate = (animate || playInstead) && renderKind !== 'static';

  useEffect(() => {
    setStillFailed(false);
  }, [customEmojiId, srcOverride]);

  useEffect(() => {
    if (!shouldAnimate) return;
    const holder = holderRef.current;
    if (!holder) return;
    let cancelled = false;
    let destroy: (() => void) | null = null;
    let release: (() => void) | null = null;

    const stop = () => {
      destroy?.();
      destroy = null;
      release?.();
      release = null;
      setPlaying(false);
    };

    const start = async () => {
      if (destroy || cancelled) return;
      // A place in the budget first: a page full of animated emoji must not ask
      // a modest phone to run a player for every one of them at once.
      const slot = claimAnimationSlot(stop);
      if (!slot) return;
      release = slot;
      try {
        if (renderKind === 'video') {
          destroy = () => undefined;
          setPlaying(true);
          return;
        }
        const [{ default: lottie }, response] = await Promise.all([
          // The light build: the full one evaluates Lottie expressions with
          // eval(), which our Content-Security-Policy refuses, and emoji have no
          // expressions in them anyway.
          import('lottie-web/build/player/lottie_light'),
          fetch(
            srcOverride && sourceType === 'application/json'
              ? srcOverride
              : `/api/custom-emoji/${customEmojiId}?thumbnail=0`,
          ),
        ]);
        if (!response.ok || cancelled) {
          release?.();
          release = null;
          return;
        }
        const animationData: unknown = await response.json();
        if (cancelled || !holderRef.current) {
          release?.();
          release = null;
          return;
        }
        const animation = lottie.loadAnimation({
          container: holderRef.current,
          renderer: 'svg',
          loop: true,
          autoplay: true,
          animationData,
        });
        destroy = () => animation.destroy();
        setPlaying(true);
      } catch {
        // The still stays on screen; a glyph is never worth an error to the user.
        release?.();
        release = null;
      }
    };

    if (typeof IntersectionObserver === 'undefined') {
      void start();
      return () => {
        cancelled = true;
        stop();
      };
    }
    // Kept watching rather than disconnected on the first sighting: a glyph
    // scrolled away gives its player back, which is what lets a long page hand
    // the budget to whatever the reader is actually looking at.
    const observer = new IntersectionObserver(
      (entries) => {
        if (entries.some((entry) => entry.isIntersecting)) void start();
        else stop();
      },
      { rootMargin: '120px' },
    );
    observer.observe(holder);
    return () => {
      cancelled = true;
      observer.disconnect();
      stop();
    };
  }, [customEmojiId, renderKind, shouldAnimate, srcOverride, sourceType]);

  const dimensions = { width: size, height: size };
  if (shouldAnimate && renderKind === 'video' && playing) {
    return (
      <video
        className="custom-emoji-glyph"
        style={dimensions}
        src={
          srcOverride && sourceType?.startsWith('video/')
            ? srcOverride
            : `/api/custom-emoji/${customEmojiId}?thumbnail=0`
        }
        autoPlay
        loop
        muted
        playsInline
      />
    );
  }
  return (
    <span
      className="custom-emoji-glyph-holder"
      style={dimensions}
      ref={holderRef}
      aria-label={label || undefined}
      role={label ? 'img' : undefined}
    >
      {(playing && renderKind === 'lottie') || playInstead ? null : (
        <img
          className="custom-emoji-glyph"
          style={dimensions}
          src={srcOverride ?? `/api/custom-emoji/${customEmojiId}?thumbnail=1`}
          alt={label}
          loading="lazy"
          decoding="async"
          onError={() => setStillFailed(true)}
        />
      )}
    </span>
  );
}
