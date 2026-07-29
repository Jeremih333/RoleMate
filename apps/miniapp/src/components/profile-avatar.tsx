interface ProfileAvatarProps {
  mediaId?: string | null | undefined;
  renderMode?: 'photo' | 'animation' | null | undefined;
  name?: string | undefined;
  className?: string | undefined;
}

export function ProfileAvatar({
  mediaId,
  renderMode,
  name = 'RoleMate',
  className = '',
}: ProfileAvatarProps) {
  const classes = `profile-avatar ${className}`.trim();
  if (!mediaId) {
    return (
      <span className={classes} aria-hidden="true">
        {name.trim().slice(0, 1).toLocaleUpperCase() || 'R'}
      </span>
    );
  }
  const source = `/api/profile-media/${mediaId}`;
  if (renderMode === 'animation') {
    return (
      <video
        className={classes}
        src={source}
        aria-label={name}
        autoPlay
        loop
        muted
        playsInline
        preload="metadata"
      />
    );
  }
  return <img className={classes} src={source} alt={name} loading="lazy" />;
}
