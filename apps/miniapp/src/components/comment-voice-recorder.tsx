import { useEffect, useRef, useState } from 'react';
import { Mic, Square, Trash2 } from 'lucide-react';
import { ru } from '@rolemate/shared';
import { CompactAudio } from './compact-audio.js';

/** Base64 for the JSON upload; chunked so a long recording cannot blow the stack. */
export async function blobBase64(blob: Blob): Promise<string> {
  const bytes = new Uint8Array(await blob.arrayBuffer());
  let binary = '';
  const chunkSize = 32_768;
  for (let index = 0; index < bytes.length; index += chunkSize) {
    binary += String.fromCharCode(...bytes.subarray(index, index + chunkSize));
  }
  return btoa(binary);
}

export interface RecordedVoice {
  blob: Blob;
  mimeType: string;
  durationSeconds: number;
}

/**
 * A self-contained recorder for the comment box. The chat recorder is tied to a
 * conversation and sends on its own; here the recording is handed back so it
 * travels with the comment that is being written.
 */
export function CommentVoiceRecorder({
  value,
  onChange,
  disabled = false,
}: {
  value: RecordedVoice | null;
  onChange: (voice: RecordedVoice | null) => void;
  disabled?: boolean;
}) {
  const [recording, setRecording] = useState(false);
  const [notice, setNotice] = useState('');
  const [previewUrl, setPreviewUrl] = useState<string | null>(null);
  const recorderRef = useRef<MediaRecorder | null>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const chunksRef = useRef<Blob[]>([]);
  const startedAtRef = useRef(0);

  useEffect(() => {
    if (!value) {
      setPreviewUrl(null);
      return;
    }
    const url = URL.createObjectURL(value.blob);
    setPreviewUrl(url);
    return () => URL.revokeObjectURL(url);
  }, [value]);

  useEffect(
    () => () => {
      streamRef.current?.getTracks().forEach((track) => track.stop());
    },
    [],
  );

  const start = async () => {
    if (!navigator.mediaDevices || typeof MediaRecorder === 'undefined') {
      setNotice(ru.miniApp.community.recordingUnsupported);
      return;
    }
    setNotice('');
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      const mimeType = ['audio/mp4', 'audio/ogg;codecs=opus', 'audio/webm;codecs=opus'].find(
        (candidate) => MediaRecorder.isTypeSupported(candidate),
      );
      const recorder = new MediaRecorder(stream, mimeType ? { mimeType } : undefined);
      chunksRef.current = [];
      recorder.ondataavailable = (event) => {
        if (event.data.size) chunksRef.current.push(event.data);
      };
      recorder.onstop = () => {
        const type = recorder.mimeType || 'audio/webm';
        const blob = new Blob(chunksRef.current, { type });
        stream.getTracks().forEach((track) => track.stop());
        streamRef.current = null;
        setRecording(false);
        if (!blob.size) return;
        onChange({
          blob,
          mimeType: type.split(';')[0] ?? 'audio/webm',
          durationSeconds: Math.max(1, Math.round((Date.now() - startedAtRef.current) / 1_000)),
        });
      };
      streamRef.current = stream;
      recorderRef.current = recorder;
      startedAtRef.current = Date.now();
      recorder.start();
      setRecording(true);
    } catch {
      setNotice(ru.miniApp.community.microphoneDenied);
    }
  };

  const stop = () => {
    const recorder = recorderRef.current;
    if (recorder?.state === 'recording') recorder.stop();
  };

  if (value && previewUrl) {
    return (
      <div className="comment-voice-preview">
        <CompactAudio
          src={previewUrl}
          label={ru.miniApp.social.voiceComment}
          seekLabel={ru.miniApp.social.voiceCommentSeek}
        />
        <button
          type="button"
          className="comment-voice-button"
          aria-label={ru.miniApp.social.discardVoiceComment}
          title={ru.miniApp.social.discardVoiceComment}
          onClick={() => onChange(null)}
        >
          <Trash2 aria-hidden />
        </button>
      </div>
    );
  }

  return (
    <div className="comment-voice-controls">
      <button
        type="button"
        className={`comment-voice-button ${recording ? 'is-recording' : ''}`}
        disabled={disabled}
        aria-label={
          recording ? ru.miniApp.social.stopVoiceComment : ru.miniApp.social.recordVoiceComment
        }
        title={
          recording ? ru.miniApp.social.stopVoiceComment : ru.miniApp.social.recordVoiceComment
        }
        onClick={() => (recording ? stop() : void start())}
      >
        {recording ? <Square aria-hidden /> : <Mic aria-hidden />}
      </button>
      {notice ? <small className="comment-voice-notice">{notice}</small> : null}
    </div>
  );
}
