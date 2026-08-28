import { useEffect, useRef, useState } from 'react';

interface ProfileAvatarProps {
  mediaId?: string | null | undefined;
  renderMode?: 'photo' | 'animation' | 'still' | null | undefined;
  name?: string | undefined;
  className?: string | undefined;
  accessVersion?: number | undefined;
}

export function ProfileAvatar({
  mediaId,
  renderMode,
  name = 'RoleMate',
  className = '',
  accessVersion,
}: ProfileAvatarProps) {
  const classes = `profile-avatar ${className}`.trim();
  const [failedSource, setFailedSource] = useState<string | null>(null);
  if (!mediaId) return <AvatarFallback className={classes} name={name} />;
  const source = `/api/profile-media/${mediaId}${
    renderMode === 'still'
      ? '/thumbnail'
      : accessVersion === undefined
        ? ''
        : `?access=${accessVersion}`
  }`;
  const failed = failedSource === source;
  if (renderMode === 'animation') {
    return (
      <span className={classes} aria-label={name} role="img">
        <AnimatedProfileAvatar
          className={`profile-avatar-media${failed ? ' is-hidden' : ''}`}
          source={source}
          name={name}
          mediaId={mediaId}
          onError={() => setFailedSource(source)}
        />
        {failed ? <AvatarLetter name={name} /> : null}
      </span>
    );
  }
  return (
    <span className={classes} aria-label={name} role="img">
      <img
        className={`profile-avatar-media${failed ? ' is-hidden' : ''}`}
        src={source}
        alt=""
        loading="lazy"
        decoding="async"
        onError={() => setFailedSource(source)}
      />
      {failed ? <AvatarLetter name={name} /> : null}
    </span>
  );
}

function AvatarFallback({ className, name }: { className: string; name: string }) {
  // The initial is always wrapped: some places restyle .profile-avatar to a
  // block, which would drop the flex centring and leave the letter in the
  // corner. The wrapper centres itself no matter how the circle is displayed.
  return (
    <span className={className} aria-label={name} role="img">
      <AvatarLetter name={name} />
    </span>
  );
}

function AvatarLetter({ name }: { name: string }) {
  return <span className="profile-avatar-letter">{avatarInitial(name)}</span>;
}

/**
 * The first character of a name, taken by code point so that an emoji or any
 * other surrogate pair is not sliced in half into an unrenderable glyph.
 */
export function avatarInitial(name: string): string {
  const [first] = Array.from(name.trim());
  return first ? first.toLocaleUpperCase() : 'R';
}

function AnimatedProfileAvatar({
  className,
  source,
  name,
  mediaId,
  onError,
}: {
  className: string;
  source: string;
  name: string;
  mediaId: string;
  onError: () => void;
}) {
  const ref = useRef<HTMLVideoElement>(null);
  const [visible, setVisible] = useState(false);
  useEffect(() => {
    const element = ref.current;
    if (!element) return;
    if (typeof IntersectionObserver === 'undefined') {
      setVisible(true);
      return;
    }
    const observer = new IntersectionObserver(
      ([entry]) =>
        setVisible(Boolean(entry?.isIntersecting) && document.visibilityState === 'visible'),
      { rootMargin: '160px' },
    );
    const onVisibility = () =>
      setVisible(
        document.visibilityState === 'visible' && element.getBoundingClientRect().bottom >= -160,
      );
    observer.observe(element);
    document.addEventListener('visibilitychange', onVisibility);
    return () => {
      observer.disconnect();
      document.removeEventListener('visibilitychange', onVisibility);
    };
  }, []);
  return (
    <video
      ref={ref}
      className={className}
      src={visible ? source : undefined}
      poster={`/api/profile-media/${mediaId}/thumbnail`}
      aria-label={name}
      autoPlay={visible}
      loop
      muted
      playsInline
      preload="none"
      onError={onError}
    />
  );
}
