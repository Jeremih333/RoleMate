import { useEffect, useRef, useState } from 'react';
import { Pause, Play } from 'lucide-react';

export function CompactAudio({
  src,
  label,
  seekLabel,
}: {
  src: string;
  label: string;
  seekLabel: string;
}) {
  const audioRef = useRef<HTMLAudioElement>(null);
  const seekingRef = useRef(false);
  const [playing, setPlaying] = useState(false);
  const [duration, setDuration] = useState(0);
  const [position, setPosition] = useState(0);

  useEffect(() => {
    setPlaying(false);
    setDuration(0);
    setPosition(0);
    seekingRef.current = false;
  }, [src]);

  const syncDuration = (audio: HTMLAudioElement) => {
    const nextDuration = Number.isFinite(audio.duration) && audio.duration > 0 ? audio.duration : 0;
    setDuration(nextDuration);
    if (nextDuration > 0) setPosition(Math.min(audio.currentTime, nextDuration));
  };

  const seekTo = (rawPosition: number) => {
    const audio = audioRef.current;
    if (!audio || duration <= 0 || !Number.isFinite(rawPosition)) return;
    const nextPosition = Math.min(Math.max(rawPosition, 0), duration);
    audio.currentTime = nextPosition;
    setPosition(nextPosition);
  };

  const toggle = async () => {
    const audio = audioRef.current;
    if (!audio) return;
    if (!audio.paused) {
      audio.pause();
      return;
    }
    document
      .querySelectorAll<HTMLAudioElement>('audio[data-profile-track-audio]')
      .forEach((item) => {
        if (item !== audio) item.pause();
      });
    try {
      await audio.play();
    } catch {
      setPlaying(false);
    }
  };

  return (
    <div className="profile-track-player">
      <audio
        data-profile-track-audio
        ref={audioRef}
        src={src}
        preload="metadata"
        onLoadedMetadata={(event) => syncDuration(event.currentTarget)}
        onDurationChange={(event) => syncDuration(event.currentTarget)}
        onTimeUpdate={(event) => {
          if (!seekingRef.current) setPosition(event.currentTarget.currentTime);
        }}
        onPlay={() => setPlaying(true)}
        onPause={() => setPlaying(false)}
        onEnded={() => {
          setPlaying(false);
          setPosition(0);
        }}
      />
      <button type="button" aria-label={label} aria-pressed={playing} onClick={() => void toggle()}>
        {playing ? <Pause aria-hidden /> : <Play aria-hidden />}
      </button>
      <input
        type="range"
        min={0}
        max={duration > 0 ? duration : 1}
        step={0.1}
        value={Math.min(position, duration > 0 ? duration : 1)}
        disabled={duration <= 0}
        aria-label={seekLabel}
        aria-valuetext={`${Math.round(position)} / ${Math.round(duration)}`}
        onPointerDown={() => {
          seekingRef.current = true;
        }}
        onPointerUp={(event) => {
          seekTo(Number(event.currentTarget.value));
          seekingRef.current = false;
        }}
        onKeyUp={(event) => seekTo(Number(event.currentTarget.value))}
        onInput={(event) => seekTo(Number(event.currentTarget.value))}
        onChange={(event) => seekTo(Number(event.currentTarget.value))}
      />
    </div>
  );
}
