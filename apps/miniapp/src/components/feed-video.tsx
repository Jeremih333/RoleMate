import { useEffect, type ReactEventHandler } from 'react';
import { useInView } from './use-in-view.js';

/**
 * A looping video in a feed.
 *
 * A page of posts used to start every video it held at once, wherever it was on
 * the page, which on a modest phone is what turned scrolling into a slideshow.
 * This one loads and plays only while it is near the screen, pauses when it
 * leaves, and stays a still frame for a reader who has asked for less motion.
 */
export function FeedVideo({
  className,
  src,
  onError,
  ...rest
}: {
  className?: string;
  src: string;
  onError?: ReactEventHandler<HTMLVideoElement>;
  'aria-label'?: string;
}) {
  const { ref, inView } = useInView<HTMLVideoElement>();

  useEffect(() => {
    const video = ref.current;
    if (!video) return;
    if (inView) void video.play().catch(() => undefined);
    else video.pause();
  }, [inView, ref]);

  return (
    <video
      {...rest}
      ref={ref}
      className={className}
      {...(inView ? { src } : {})}
      muted
      loop
      playsInline
      preload="none"
      onError={onError}
    />
  );
}
