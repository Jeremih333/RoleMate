import { useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { ru } from '@rolemate/shared';
import { ChevronLeft, ChevronRight, X } from 'lucide-react';
import { ProfileAvatar } from './profile-avatar.js';

export interface AvatarMediaItem {
  id: string;
  render_mode: 'photo' | 'animation' | 'still';
}

export function parseAvatarMediaItems(
  value: string | null | undefined,
  fallbackMediaId?: string | null,
  fallbackRenderMode?: 'photo' | 'animation' | 'still' | null,
): AvatarMediaItem[] {
  try {
    const parsed: unknown = JSON.parse(value ?? '[]');
    if (Array.isArray(parsed)) {
      const items = parsed.filter(
        (item): item is AvatarMediaItem =>
          typeof item === 'object' &&
          item !== null &&
          typeof (item as Record<string, unknown>).id === 'string' &&
          ((item as Record<string, unknown>).render_mode === 'photo' ||
            (item as Record<string, unknown>).render_mode === 'animation' ||
            (item as Record<string, unknown>).render_mode === 'still'),
      );
      if (items.length) return items;
    }
  } catch {
    // A legacy profile falls back to its single avatar below.
  }
  return fallbackMediaId
    ? [{ id: fallbackMediaId, render_mode: fallbackRenderMode ?? 'photo' }]
    : [];
}

interface ProfileAvatarGalleryProps {
  items: AvatarMediaItem[];
  name: string;
  className?: string;
  accessVersion?: number;
}

export function ProfileAvatarGallery({
  items,
  name,
  className = '',
  accessVersion,
}: ProfileAvatarGalleryProps) {
  const [open, setOpen] = useState(false);
  const [index, setIndex] = useState(0);
  const swipeStart = useRef<{ x: number; y: number } | null>(null);
  const current = items[Math.min(index, Math.max(0, items.length - 1))];

  useEffect(() => {
    if (!open) return;
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') setOpen(false);
      if (event.key === 'ArrowLeft' && items.length > 1) {
        setIndex((value) => (value - 1 + items.length) % items.length);
      }
      if (event.key === 'ArrowRight' && items.length > 1) {
        setIndex((value) => (value + 1) % items.length);
      }
    };
    window.addEventListener('keydown', onKeyDown);
    return () => {
      document.body.style.overflow = previousOverflow;
      window.removeEventListener('keydown', onKeyDown);
    };
  }, [items.length, open]);

  const move = (direction: -1 | 1) => {
    setIndex((value) => (value + direction + items.length) % items.length);
  };

  const finishSwipe = (clientX: number, clientY: number) => {
    if (swipeStart.current === null) return;
    const distance = clientX - swipeStart.current.x;
    const verticalDistance = clientY - swipeStart.current.y;
    swipeStart.current = null;
    if (verticalDistance < -70 && Math.abs(verticalDistance) > Math.abs(distance)) {
      setOpen(false);
      return;
    }
    if (items.length < 2) return;
    if (Math.abs(distance) >= 45) move(distance > 0 ? -1 : 1);
  };

  if (!current) {
    return <ProfileAvatar name={name} className={className} />;
  }

  return (
    <>
      <button
        className="profile-avatar-gallery-trigger"
        type="button"
        aria-label={ru.miniApp.social.openAvatar}
        onClick={() => {
          setIndex(0);
          setOpen(true);
        }}
      >
        <ProfileAvatar
          mediaId={current.id}
          renderMode={current.render_mode}
          name={name}
          className={className}
          accessVersion={accessVersion}
        />
      </button>
      {open
        ? createPortal(
            <div
              className="profile-avatar-lightbox"
              role="dialog"
              aria-modal="true"
              aria-label={ru.miniApp.social.avatarGallery}
              onClick={() => setOpen(false)}
            >
              <button
                className="media-lightbox-close"
                type="button"
                aria-label={ru.miniApp.social.closeAvatar}
                onClick={(event) => {
                  event.stopPropagation();
                  setOpen(false);
                }}
              >
                <X aria-hidden />
              </button>
              {items.length > 1 ? (
                <>
                  <button
                    className="media-lightbox-nav media-lightbox-prev"
                    type="button"
                    aria-label={ru.miniApp.social.previousAvatar}
                    onClick={(event) => {
                      event.stopPropagation();
                      move(-1);
                    }}
                  >
                    <ChevronLeft aria-hidden />
                  </button>
                  <button
                    className="media-lightbox-nav media-lightbox-next"
                    type="button"
                    aria-label={ru.miniApp.social.nextAvatar}
                    onClick={(event) => {
                      event.stopPropagation();
                      move(1);
                    }}
                  >
                    <ChevronRight aria-hidden />
                  </button>
                </>
              ) : null}
              <div
                className="profile-avatar-lightbox-stage"
                onClick={(event) => event.stopPropagation()}
                onTouchStart={(event) => {
                  const touch = event.touches[0];
                  swipeStart.current = touch ? { x: touch.clientX, y: touch.clientY } : null;
                }}
                onTouchEnd={(event) => {
                  const touch = event.changedTouches[0];
                  if (touch) finishSwipe(touch.clientX, touch.clientY);
                }}
              >
                {current.render_mode === 'animation' || current.render_mode === 'still' ? (
                  <video
                    key={current.id}
                    src={`/api/profile-media/${current.id}${accessVersion === undefined ? '' : `?access=${accessVersion}`}`}
                    aria-label={name}
                    autoPlay={current.render_mode === 'animation'}
                    loop={current.render_mode === 'animation'}
                    muted
                    controls={current.render_mode === 'still'}
                    playsInline
                    preload="metadata"
                  />
                ) : (
                  <img
                    src={`/api/profile-media/${current.id}${accessVersion === undefined ? '' : `?access=${accessVersion}`}`}
                    alt={name}
                  />
                )}
                {items.length > 1 ? (
                  <>
                    <div className="profile-avatar-lightbox-dots" aria-hidden>
                      {items.map((item, itemIndex) => (
                        <span className={itemIndex === index ? 'is-active' : ''} key={item.id} />
                      ))}
                    </div>
                    <span className="profile-avatar-lightbox-position">
                      {ru.miniApp.social.avatarPosition(index + 1, items.length)}
                    </span>
                  </>
                ) : null}
              </div>
            </div>,
            document.body,
          )
        : null}
    </>
  );
}
