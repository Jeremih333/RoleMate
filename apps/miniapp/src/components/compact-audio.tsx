import { useRef, useState } from 'react';
import { Pause, Play } from 'lucide-react';

export function CompactAudio({ src, label }: { src: string; label: string }) {
  const audioRef = useRef<HTMLAudioElement>(null);
  const [playing, setPlaying] = useState(false);

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
    await audio.play();
  };

  return (
    <div className="profile-track-player">
      <audio
        data-profile-track-audio
        ref={audioRef}
        src={src}
        preload="none"
        onPlay={() => setPlaying(true)}
        onPause={() => setPlaying(false)}
        onEnded={() => setPlaying(false)}
      />
      <button type="button" aria-label={label} aria-pressed={playing} onClick={() => void toggle()}>
        {playing ? <Pause aria-hidden /> : <Play aria-hidden />}
      </button>
    </div>
  );
}
