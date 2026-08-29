import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  type CSSProperties,
  type ReactNode,
} from 'react';
import {
  ChevronDown,
  Check,
  ListMusic,
  Pause,
  Play,
  Repeat,
  Share2,
  Shuffle,
  SkipBack,
  SkipForward,
  X,
} from 'lucide-react';
import { ru } from '@rolemate/shared';
import { trackMusicPlayerHeight } from '../telegram.js';

export type PlaylistTrack = {
  id: string;
  src: string;
  title: string;
  performer: string;
  coverSrc?: string;
  fileSizeBytes?: number | null;
};

type RepeatMode = 'off' | 'playlist' | 'track';

type MusicPlayerContextValue = {
  queue: PlaylistTrack[];
  currentIndex: number;
  currentTrack: PlaylistTrack | null;
  playing: boolean;
  position: number;
  duration: number;
  seek: (position: number) => void;
  playQueue: (
    tracks: PlaylistTrack[],
    index?: number,
    startPosition?: number,
    persistOrder?: (trackIds: string[]) => Promise<void>,
  ) => Promise<void>;
  toggle: () => Promise<void>;
  next: () => Promise<void>;
  previous: () => Promise<void>;
  select: (index: number) => Promise<void>;
};

const MusicPlayerContext = createContext<MusicPlayerContextValue | null>(null);

export function useMusicPlayer() {
  const context = useContext(MusicPlayerContext);
  if (!context) throw new Error('useMusicPlayer must be used inside MusicPlayerProvider');
  return context;
}

const speedSteps = [1, 1.5, 2] as const;

type MusicProgressStyle = CSSProperties & { '--music-progress': string };

export function musicProgressStyle(position: number, duration: number): MusicProgressStyle {
  const percent = duration > 0 ? Math.min(100, Math.max(0, (position / duration) * 100)) : 0;
  return { '--music-progress': `${percent}%` };
}

export function MusicPlayerProvider({ children }: { children: ReactNode }) {
  const audioRef = useRef<HTMLAudioElement>(null);
  const [queue, setQueue] = useState<PlaylistTrack[]>([]);
  const [currentIndex, setCurrentIndex] = useState(0);
  const [playing, setPlaying] = useState(false);
  const [position, setPosition] = useState(0);
  const [duration, setDuration] = useState(0);
  const [repeatMode, setRepeatMode] = useState<RepeatMode>('off');
  const [shuffle, setShuffle] = useState(false);
  const [speedIndex, setSpeedIndex] = useState(0);
  const [drawerOpen, setDrawerOpen] = useState(false);
  const [orderSelecting, setOrderSelecting] = useState(false);
  const [orderedTrackIds, setOrderedTrackIds] = useState<string[]>([]);
  const [orderError, setOrderError] = useState<string | null>(null);
  const pendingAutoplayRef = useRef(false);
  const pendingSeekRef = useRef<number | null>(null);
  const persistOrderRef = useRef<((trackIds: string[]) => Promise<void>) | null>(null);
  const playRequestRef = useRef(0);
  const currentTrack = queue[currentIndex] ?? null;

  const startCurrent = useCallback(async () => {
    const audio = audioRef.current;
    if (!audio) return;
    const requestId = ++playRequestRef.current;
    try {
      await audio.play();
    } catch {
      if (requestId === playRequestRef.current) setPlaying(false);
    }
  }, []);

  const select = useCallback(
    (index: number) => {
      if (index < 0 || index >= queue.length) return Promise.resolve();
      if (index === currentIndex) return startCurrent();
      pendingAutoplayRef.current = true;
      pendingSeekRef.current = null;
      setCurrentIndex(index);
      setPosition(0);
      return Promise.resolve();
    },
    [currentIndex, queue.length, startCurrent],
  );

  const next = useCallback(async () => {
    if (!queue.length) return;
    if (repeatMode === 'track') {
      const audio = audioRef.current;
      if (audio) audio.currentTime = 0;
      await startCurrent();
      return;
    }
    const nextIndex = shuffle
      ? Math.floor(Math.random() * queue.length)
      : (currentIndex + 1) % queue.length;
    if (repeatMode === 'off' && !shuffle && currentIndex === queue.length - 1) {
      setPlaying(false);
      return;
    }
    await select(nextIndex);
  }, [currentIndex, queue.length, repeatMode, select, shuffle, startCurrent]);

  const previous = useCallback(async () => {
    if (!queue.length) return;
    const audio = audioRef.current;
    if (audio && audio.currentTime > 4) {
      audio.currentTime = 0;
      setPosition(0);
      return;
    }
    await select((currentIndex - 1 + queue.length) % queue.length);
  }, [currentIndex, queue.length, select]);

  const playQueue = useCallback(
    (
      tracks: PlaylistTrack[],
      index = 0,
      startPosition = 0,
      persistOrder?: (trackIds: string[]) => Promise<void>,
    ) => {
      if (!tracks.length) return Promise.resolve();
      const safeIndex = Math.min(Math.max(index, 0), tracks.length - 1);
      const target = tracks[safeIndex];
      const sameTrack =
        target !== undefined && currentTrack?.id === target.id && currentTrack.src === target.src;
      pendingSeekRef.current = Math.max(0, startPosition);
      persistOrderRef.current = persistOrder ?? null;
      setDrawerOpen((open) => open && tracks.length > 0);
      setQueue(tracks);
      setCurrentIndex(safeIndex);
      setPosition(Math.max(0, startPosition));
      if (sameTrack) {
        const audio = audioRef.current;
        if (audio && startPosition > 0) audio.currentTime = startPosition;
        pendingSeekRef.current = null;
        return startCurrent();
      }
      setPlaying(false);
      pendingAutoplayRef.current = true;
      return Promise.resolve();
    },
    [currentTrack, startCurrent],
  );

  useEffect(() => {
    if (!currentTrack || !pendingAutoplayRef.current) return;
    pendingAutoplayRef.current = false;
    const audio = audioRef.current;
    if (!audio) return;
    audio.load();
    void startCurrent();
  }, [currentTrack?.id, currentTrack?.src, startCurrent]);

  const toggle = useCallback(async () => {
    const audio = audioRef.current;
    if (!audio) return;
    if (audio.paused) await startCurrent();
    else audio.pause();
  }, [startCurrent]);
  const seek = useCallback((nextPosition: number) => {
    const audio = audioRef.current;
    if (!audio || !Number.isFinite(nextPosition)) return;
    audio.currentTime = Math.max(0, Math.min(nextPosition, audio.duration || nextPosition));
    setPosition(audio.currentTime);
  }, []);

  useEffect(() => {
    const audio = audioRef.current;
    if (audio) audio.playbackRate = speedSteps[speedIndex] ?? 1;
  }, [speedIndex]);

  const value = useMemo<MusicPlayerContextValue>(
    () => ({
      queue,
      currentIndex,
      currentTrack,
      playing,
      position,
      duration,
      seek,
      playQueue,
      toggle,
      next,
      previous,
      select,
    }),
    [
      currentIndex,
      currentTrack,
      next,
      playQueue,
      playing,
      position,
      duration,
      previous,
      queue,
      select,
      seek,
      toggle,
    ],
  );

  // The player is a fixed strip above everything, so the layout has to know it is
  // there. A class says so plainly instead of a :has() selector the WebView in
  // some Telegram clients ignores, and the strip's measured height is what the
  // layout insets itself by — a guessed number left a gap beneath it.
  const playerRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    document.body.classList.toggle('music-open', Boolean(currentTrack));
    return () => document.body.classList.remove('music-open');
  }, [currentTrack]);
  useEffect(() => trackMusicPlayerHeight(playerRef.current), [currentTrack]);

  return (
    <MusicPlayerContext.Provider value={value}>
      {children}
      {currentTrack ? (
        <div className="global-music-player" data-no-section-swipe ref={playerRef}>
          <audio
            ref={audioRef}
            src={currentTrack.src}
            preload="metadata"
            onLoadedMetadata={(event) => {
              const loadedDuration = Number.isFinite(event.currentTarget.duration)
                ? event.currentTarget.duration
                : 0;
              setDuration(loadedDuration);
              const pendingSeek = pendingSeekRef.current;
              if (pendingSeek !== null) {
                event.currentTarget.currentTime = Math.min(
                  pendingSeek,
                  loadedDuration || pendingSeek,
                );
                setPosition(event.currentTarget.currentTime);
                pendingSeekRef.current = null;
              }
            }}
            onTimeUpdate={(event) => setPosition(event.currentTarget.currentTime)}
            onPlay={() => setPlaying(true)}
            onPause={() => setPlaying(false)}
            onError={() => {
              pendingAutoplayRef.current = false;
              pendingSeekRef.current = null;
              setPlaying(false);
            }}
            onEnded={() => void next()}
          />
          <input
            className="global-music-progress"
            type="range"
            min={0}
            max={duration || 1}
            step={0.1}
            value={Math.min(position, duration || 1)}
            style={musicProgressStyle(position, duration)}
            onChange={(event) => seek(Number(event.target.value))}
            aria-label={ru.miniApp.musicPlayer.seek}
          />
          <button
            className="global-music-cover-button"
            type="button"
            onClick={() => void toggle()}
            aria-label={playing ? ru.miniApp.musicPlayer.pause : ru.miniApp.musicPlayer.play}
          >
            {currentTrack.coverSrc ? (
              <img className="global-music-cover" src={currentTrack.coverSrc} alt="" />
            ) : (
              <span className="global-music-cover global-music-cover-placeholder" aria-hidden>
                <ListMusic />
              </span>
            )}
            <span className="global-music-cover-action" aria-hidden>
              {playing ? <Pause /> : <Play />}
            </span>
          </button>
          <button
            className="global-music-title"
            type="button"
            // A single track has a playlist too: it holds the cover, the title
            // and the queue actions, so the drawer opens for one track as well.
            onClick={() => setDrawerOpen(true)}
          >
            <strong>{currentTrack.title}</strong>
            <span>
              {currentTrack.performer}
              {queue.length > 1 ? ` · ${currentIndex + 1}/${queue.length}` : ''}
            </span>
          </button>
          <div className="global-music-actions">
            {queue.length > 1 ? (
              <>
                <button
                  type="button"
                  onClick={() => void previous()}
                  aria-label={ru.miniApp.musicPlayer.previous}
                >
                  <SkipBack />
                </button>
                <button
                  type="button"
                  onClick={() => void next()}
                  aria-label={ru.miniApp.musicPlayer.next}
                >
                  <SkipForward />
                </button>
              </>
            ) : null}
            <button
              type="button"
              onClick={() => setDrawerOpen(true)}
              aria-label={ru.miniApp.musicPlayer.openPlaylist}
            >
              <ListMusic />
            </button>
            <button
              type="button"
              onClick={() => {
                playRequestRef.current += 1;
                pendingAutoplayRef.current = false;
                pendingSeekRef.current = null;
                audioRef.current?.pause();
                setQueue([]);
                setPosition(0);
                setDuration(0);
                setDrawerOpen(false);
              }}
              aria-label={ru.miniApp.musicPlayer.closePlayer}
            >
              <X />
            </button>
          </div>
        </div>
      ) : null}
      {drawerOpen && currentTrack ? (
        <div
          className="music-drawer-backdrop"
          role="presentation"
          onClick={() => setDrawerOpen(false)}
        >
          <section
            className="music-drawer"
            role="dialog"
            aria-modal="true"
            aria-label={ru.miniApp.musicPlayer.playlist}
            onClick={(event) => event.stopPropagation()}
          >
            <button
              className="music-drawer-handle"
              type="button"
              onClick={() => setDrawerOpen(false)}
              aria-label={ru.miniApp.musicPlayer.close}
            >
              <ChevronDown />
            </button>
            <h2>
              {ru.miniApp.musicPlayer.playlist} · {currentIndex + 1}/{queue.length}
            </h2>
            <div className="music-drawer-current-seek">
              <input
                type="range"
                min={0}
                max={duration || 1}
                step={0.1}
                value={Math.min(position, duration || 1)}
                style={musicProgressStyle(position, duration)}
                onChange={(event) => seek(Number(event.target.value))}
                aria-label={ru.miniApp.musicPlayer.seek}
              />
              <button
                className="music-drawer-toggle"
                type="button"
                onClick={() => void toggle()}
                aria-label={playing ? ru.miniApp.musicPlayer.pause : ru.miniApp.musicPlayer.play}
              >
                {playing ? <Pause /> : <Play />}
              </button>
              <div className="music-drawer-skip-actions">
                <button
                  type="button"
                  onClick={() => void previous()}
                  aria-label={ru.miniApp.musicPlayer.previous}
                >
                  <SkipBack />
                </button>
                <button
                  type="button"
                  onClick={() => void next()}
                  aria-label={ru.miniApp.musicPlayer.next}
                >
                  <SkipForward />
                </button>
              </div>
            </div>
            <div className="music-drawer-playback-options">
              <button
                type="button"
                className={shuffle ? 'active' : ''}
                onClick={() => setShuffle((value) => !value)}
                aria-label={ru.miniApp.musicPlayer.shuffle}
              >
                <Shuffle />
              </button>
              <button
                type="button"
                className={repeatMode !== 'off' ? 'active' : ''}
                onClick={() =>
                  setRepeatMode((mode) =>
                    mode === 'off' ? 'playlist' : mode === 'playlist' ? 'track' : 'off',
                  )
                }
                aria-label={ru.miniApp.musicPlayer.repeat}
              >
                <Repeat /> {repeatMode === 'track' ? '1' : ''}
              </button>
              <button
                type="button"
                onClick={() => setSpeedIndex((index) => (index + 1) % speedSteps.length)}
                aria-label={ru.miniApp.musicPlayer.speed}
              >
                {speedSteps[speedIndex] ?? 1}x
              </button>
            </div>
            <div className="music-drawer-order-actions">
              <button
                type="button"
                onClick={() => {
                  setOrderSelecting((value) => !value);
                  setOrderedTrackIds([]);
                  setOrderError(null);
                }}
              >
                {orderSelecting
                  ? ru.miniApp.musicPlayer.cancelPlaybackOrder
                  : ru.miniApp.musicPlayer.choosePlaybackOrder}
              </button>
              {orderSelecting && orderedTrackIds.length ? (
                <button
                  type="button"
                  onClick={() => {
                    void (async () => {
                      const byId = new Map(queue.map((track) => [track.id, track]));
                      const selected = orderedTrackIds.flatMap((id) => {
                        const track = byId.get(id);
                        return track ? [track] : [];
                      });
                      const remaining = queue.filter(
                        (track) => !orderedTrackIds.includes(track.id),
                      );
                      const reordered = [...selected, ...remaining];
                      if (persistOrderRef.current) {
                        try {
                          await persistOrderRef.current(reordered.map((track) => track.id));
                        } catch (error) {
                          setOrderError(
                            error instanceof Error ? error.message : ru.api.requestFailed,
                          );
                          return;
                        }
                      }
                      const preservedIndex = currentTrack
                        ? reordered.findIndex((track) => track.id === currentTrack.id)
                        : 0;
                      setQueue(reordered);
                      setCurrentIndex(Math.max(0, preservedIndex));
                      setOrderedTrackIds([]);
                      setOrderSelecting(false);
                      setOrderError(null);
                    })();
                  }}
                >
                  {ru.miniApp.musicPlayer.applyPlaybackOrder}
                </button>
              ) : null}
            </div>
            {orderError ? <div className="error-box">{orderError}</div> : null}
            <div className="music-drawer-list">
              {queue.map((track, index) => (
                <button
                  className={index === currentIndex ? 'active' : ''}
                  type="button"
                  key={track.id}
                  onClick={() => {
                    if (!orderSelecting) {
                      void select(index);
                      return;
                    }
                    setOrderedTrackIds((current) =>
                      current.includes(track.id)
                        ? current.filter((id) => id !== track.id)
                        : [...current, track.id],
                    );
                  }}
                >
                  {track.coverSrc ? (
                    <img src={track.coverSrc} alt="" />
                  ) : (
                    <span className="music-drawer-placeholder">
                      <ListMusic />
                    </span>
                  )}
                  <span>
                    <strong>{track.title}</strong>
                    <small>{track.performer}</small>
                  </span>
                  <small>
                    {orderSelecting
                      ? orderedTrackIds.indexOf(track.id) >= 0
                        ? orderedTrackIds.indexOf(track.id) + 1
                        : '·'
                      : index + 1}
                  </small>
                </button>
              ))}
            </div>
          </section>
        </div>
      ) : null}
    </MusicPlayerContext.Provider>
  );
}

export function SwipePlaylist({
  tracks,
  emptyLabel,
  limit = 5,
  onShare,
  onReorder,
}: {
  tracks: PlaylistTrack[];
  emptyLabel: string;
  limit?: number;
  onShare?: (trackIds: string[]) => void;
  onReorder?: (trackIds: string[]) => Promise<void>;
}) {
  const player = useMusicPlayer();
  const [index, setIndex] = useState(0);
  const [selecting, setSelecting] = useState(false);
  const [selected, setSelected] = useState<Set<string>>(() => new Set());
  const touchStart = useRef<{ x: number; y: number } | null>(null);
  const track = tracks[index];
  useEffect(() => {
    if (index >= tracks.length) setIndex(Math.max(tracks.length - 1, 0));
  }, [index, tracks.length]);
  if (!track)
    return (
      <p className="playlist-empty">
        {emptyLabel} · 0/{limit}
      </p>
    );
  const unavailableReason =
    (track.fileSizeBytes ?? 0) > 20 * 1024 * 1024 ? ru.miniApp.musicPlayer.fileTooLarge : null;
  const finishSwipe = (x: number, y: number) => {
    const start = touchStart.current;
    touchStart.current = null;
    if (!start || Math.abs(x - start.x) < 45 || Math.abs(x - start.x) <= Math.abs(y - start.y))
      return;
    setIndex((current) =>
      x < start.x ? (current + 1) % tracks.length : (current - 1 + tracks.length) % tracks.length,
    );
  };
  return (
    <div
      className={`swipe-playlist ${tracks.length === 1 ? 'is-single' : ''} ${
        onShare ? 'has-share' : ''
      }`}
      data-no-section-swipe
    >
      <button
        className="swipe-playlist-card"
        type="button"
        aria-label={ru.miniApp.search.profileAudio(index + 1)}
        aria-disabled={Boolean(unavailableReason)}
        onClick={() => {
          if (!unavailableReason) void player.playQueue(tracks, index, 0, onReorder);
        }}
        onTouchStart={(event) => {
          const touch = event.touches[0];
          if (touch) touchStart.current = { x: touch.clientX, y: touch.clientY };
        }}
        onTouchEnd={(event) => {
          const touch = event.changedTouches[0];
          if (touch) finishSwipe(touch.clientX, touch.clientY);
        }}
      >
        {track.coverSrc ? (
          <img src={track.coverSrc} alt="" />
        ) : (
          <span className="swipe-playlist-cover">
            <ListMusic />
          </span>
        )}
        <span className="swipe-playlist-copy">
          <strong>{track.title}</strong>
          <small>{track.performer}</small>
        </span>
        {tracks.length > 1 ? (
          <span className="swipe-playlist-count">
            {index + 1}/{tracks.length}
          </span>
        ) : null}
      </button>
      <input
        className="swipe-playlist-seek"
        type="range"
        min={0}
        max={player.currentTrack?.id === track.id ? player.duration || 1 : 1}
        step={0.1}
        value={
          player.currentTrack?.id === track.id ? Math.min(player.position, player.duration || 1) : 0
        }
        style={musicProgressStyle(
          player.currentTrack?.id === track.id ? player.position : 0,
          player.currentTrack?.id === track.id ? player.duration : 0,
        )}
        onChange={(event) => {
          const nextPosition = Number(event.target.value);
          if (player.currentTrack?.id !== track.id) {
            void player.playQueue(tracks, index, nextPosition, onReorder);
          } else {
            player.seek(nextPosition);
          }
        }}
        aria-label={ru.miniApp.search.profileAudioSeek(index + 1)}
        aria-valuetext={`${Math.round(player.currentTrack?.id === track.id ? player.position : 0)} / ${Math.round(player.currentTrack?.id === track.id ? player.duration : 0)}`}
        disabled={Boolean(unavailableReason)}
      />
      <button
        className="swipe-playlist-play"
        type="button"
        aria-label={ru.miniApp.musicPlayer.playPlaylist}
        disabled={Boolean(unavailableReason)}
        onClick={() => {
          if (player.currentTrack?.id === track.id) void player.toggle();
          else void player.playQueue(tracks, index, 0, onReorder);
        }}
      >
        {player.currentTrack?.id === track.id && player.playing ? <Pause /> : <Play />}
      </button>
      {unavailableReason ? (
        <p className="swipe-playlist-error" role="status">
          {unavailableReason}
        </p>
      ) : null}
      {onShare ? (
        <button
          className="swipe-playlist-share"
          type="button"
          aria-label={ru.miniApp.musicPlayer.chooseTracks}
          onClick={() => setSelecting((value) => !value)}
        >
          <Share2 />
        </button>
      ) : null}
      {selecting && onShare ? (
        <div className="playlist-track-selector">
          {tracks.slice(0, 20).map((item) => {
            const checked = selected.has(item.id);
            return (
              <button
                type="button"
                className={checked ? 'selected' : ''}
                key={item.id}
                onClick={() =>
                  setSelected((current) => {
                    const next = new Set(current);
                    if (next.has(item.id)) next.delete(item.id);
                    else next.add(item.id);
                    return next;
                  })
                }
              >
                <span className="playlist-track-check">{checked ? <Check /> : null}</span>
                <span>
                  <strong>{item.title}</strong>
                  <small>{item.performer}</small>
                </span>
              </button>
            );
          })}
          <button
            type="button"
            className="button button-primary playlist-share-confirm"
            disabled={selected.size === 0}
            onClick={() => {
              onShare([...selected]);
              setSelecting(false);
            }}
          >
            <Share2 /> {ru.miniApp.musicPlayer.shareSelected} ·{' '}
            {ru.miniApp.musicPlayer.tracksSelected(selected.size)}
          </button>
        </div>
      ) : null}
    </div>
  );
}
