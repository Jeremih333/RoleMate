import { useEffect, useRef, useState } from 'react';

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
}: {
  customEmojiId: string;
  renderKind?: CustomEmojiRenderKind;
  label?: string;
  size?: number;
  animate?: boolean;
}) {
  const holderRef = useRef<HTMLSpanElement>(null);
  const [playing, setPlaying] = useState(false);
  const shouldAnimate = animate && renderKind !== 'static';

  useEffect(() => {
    if (!shouldAnimate) return;
    const holder = holderRef.current;
    if (!holder) return;
    let cancelled = false;
    let destroy: (() => void) | null = null;

    const start = async () => {
      try {
        if (renderKind === 'video') {
          setPlaying(true);
          return;
        }
        const [{ default: lottie }, response] = await Promise.all([
          // The light build: the full one evaluates Lottie expressions with
          // eval(), which our Content-Security-Policy refuses, and emoji have no
          // expressions in them anyway.
          import('lottie-web/build/player/lottie_light'),
          fetch(`/api/custom-emoji/${customEmojiId}?thumbnail=0`),
        ]);
        if (!response.ok || cancelled) return;
        const animationData: unknown = await response.json();
        if (cancelled || !holderRef.current) return;
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
      }
    };

    if (typeof IntersectionObserver === 'undefined') {
      void start();
      return () => {
        cancelled = true;
        destroy?.();
      };
    }
    const observer = new IntersectionObserver(
      (entries) => {
        if (entries.some((entry) => entry.isIntersecting)) {
          observer.disconnect();
          void start();
        }
      },
      { rootMargin: '120px' },
    );
    observer.observe(holder);
    return () => {
      cancelled = true;
      observer.disconnect();
      destroy?.();
    };
  }, [customEmojiId, renderKind, shouldAnimate]);

  const dimensions = { width: size, height: size };
  if (shouldAnimate && renderKind === 'video' && playing) {
    return (
      <video
        className="custom-emoji-glyph"
        style={dimensions}
        src={`/api/custom-emoji/${customEmojiId}?thumbnail=0`}
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
      {playing && renderKind === 'lottie' ? null : (
        <img
          className="custom-emoji-glyph"
          style={dimensions}
          src={`/api/custom-emoji/${customEmojiId}?thumbnail=1`}
          alt={label}
          loading="lazy"
          decoding="async"
        />
      )}
    </span>
  );
}
