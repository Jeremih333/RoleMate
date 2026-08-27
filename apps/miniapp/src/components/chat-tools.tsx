import { useEffect, useRef, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import {
  BookOpen,
  ChevronDown,
  ChevronUp,
  FileAudio,
  Gift,
  Image,
  Mic,
  Paperclip,
  Square,
  Send,
  Type,
  X,
  UserRound,
  Video,
} from 'lucide-react';
import { ru } from '@rolemate/shared';
import { api, type ChatMediaKind } from '../api.js';
import { Card, ConfirmDialog } from './ui.js';
import { getTelegram } from '../telegram.js';

function startChatActivity(
  conversationId: string,
  activity: 'recording_voice' | 'sending_media',
  intervalMs: number,
): () => void {
  let stopped = false;
  const publish = () => {
    if (!stopped) void api.setConversationPresence(conversationId, activity).catch(() => undefined);
  };
  publish();
  const interval = window.setInterval(publish, intervalMs);
  return () => {
    if (stopped) return;
    stopped = true;
    window.clearInterval(interval);
    void api.setConversationPresence(conversationId, 'idle').catch(() => undefined);
  };
}

interface ChatToolsProps {
  conversationId: string;
  premium: boolean;
  onSent?: () => void;
  replyToMessageId?: string;
}

function premiumMessage(): void {
  window.alert(ru.api.premiumRequired);
}

async function fileBase64(file: File): Promise<string> {
  const buffer = new Uint8Array(await file.arrayBuffer());
  let binary = '';
  const chunkSize = 32_768;
  for (let index = 0; index < buffer.length; index += chunkSize) {
    binary += String.fromCharCode(...buffer.subarray(index, index + chunkSize));
  }
  return btoa(binary);
}

function safeFileName(file: Blob, fallback: string): string {
  return file instanceof File && file.name.trim() ? file.name : fallback;
}

function PendingMediaThumbnail({ file }: { file: File }) {
  const [source, setSource] = useState('');
  useEffect(() => {
    if (!file.type.startsWith('image/')) return;
    const url = URL.createObjectURL(file);
    setSource(url);
    return () => URL.revokeObjectURL(url);
  }, [file]);
  return source ? <img src={source} alt="" /> : <Video aria-hidden />;
}

export function ChatTools({ conversationId, premium, onSent, replyToMessageId }: ChatToolsProps) {
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState('');
  const [giftOpen, setGiftOpen] = useState(false);
  const [scenarioOpen, setScenarioOpen] = useState(false);
  const [shareConfirmOpen, setShareConfirmOpen] = useState(false);
  const [playlistTitle, setPlaylistTitle] = useState('');
  const [playlistCaption, setPlaylistCaption] = useState('');
  const [playlistCaptionPosition, setPlaylistCaptionPosition] = useState<'top' | 'bottom'>(
    'bottom',
  );
  const [pendingAudioFiles, setPendingAudioFiles] = useState<File[]>([]);
  const [playlistNameOpen, setPlaylistNameOpen] = useState(false);
  const [uploadProgress, setUploadProgress] = useState<number | null>(null);
  const [uploadFileName, setUploadFileName] = useState('');
  const [pendingMediaFiles, setPendingMediaFiles] = useState<File[]>([]);
  const [mediaCaption, setMediaCaption] = useState('');
  const [captionPosition, setCaptionPosition] = useState<'top' | 'bottom'>('bottom');
  const photoRef = useRef<HTMLInputElement>(null);
  const mediaRef = useRef<HTMLInputElement>(null);
  const audioRef = useRef<HTMLInputElement>(null);
  const products = useQuery({
    queryKey: ['products'],
    queryFn: api.products,
    enabled: open && giftOpen,
  });
  const scenarios = useQuery({
    queryKey: ['profile-variants'],
    queryFn: api.profileVariants,
    enabled: open && scenarioOpen && premium,
  });

  useEffect(() => {
    if (!notice || busy) return;
    const timeout = window.setTimeout(() => setNotice(''), 2_500);
    return () => window.clearTimeout(timeout);
  }, [busy, notice]);

  async function sendBlob(
    blob: Blob,
    kind: ChatMediaKind,
    fallbackName: string,
    mediaGroupId?: string,
    notifyRecipient = true,
    playlistName?: string,
    caption?: string,
    selectedCaptionPosition: 'top' | 'bottom' = 'bottom',
  ) {
    if (kind !== 'photo' && !premium) {
      premiumMessage();
      return;
    }
    const maxBytes = kind === 'photo' ? 8 * 1024 * 1024 : 20 * 1024 * 1024;
    if (blob.size > maxBytes) {
      setNotice(ru.api.chatMediaTooLarge);
      return;
    }
    setBusy(true);
    setNotice('');
    setUploadProgress(1);
    setUploadFileName(safeFileName(blob, fallbackName));
    const stopActivity = startChatActivity(conversationId, 'sending_media', 5_000);
    let completed = false;
    try {
      const dataBase64 = await fileBase64(new File([blob], safeFileName(blob, fallbackName)));
      setUploadProgress(4);
      await api.sendConversationMedia(
        conversationId,
        {
          kind,
          fileName: safeFileName(blob, fallbackName),
          mimeType: blob.type.split(';')[0] || 'application/octet-stream',
          dataBase64,
          ...(mediaGroupId ? { mediaGroupId } : {}),
          ...(playlistName ? { playlistTitle: playlistName } : {}),
          notifyRecipient,
          ...(replyToMessageId && notifyRecipient ? { replyToMessageId } : {}),
          ...(caption ? { caption, captionPosition: selectedCaptionPosition } : {}),
        },
        setUploadProgress,
      );
      completed = true;
      setNotice(ru.miniApp.community.mediaSent);
      setOpen(false);
      onSent?.();
    } catch (error) {
      setNotice(error instanceof Error ? error.message : ru.api.requestFailed);
    } finally {
      stopActivity();
      setBusy(false);
      if (completed) {
        window.setTimeout(() => {
          setUploadProgress(null);
          setUploadFileName('');
        }, 450);
      } else {
        setUploadProgress(null);
        setUploadFileName('');
      }
    }
  }

  async function shareProfile() {
    setBusy(true);
    try {
      await api.shareConversationProfile(conversationId, replyToMessageId);
      setNotice(ru.miniApp.community.profileShared);
      setShareConfirmOpen(false);
      setOpen(false);
      onSent?.();
    } catch (error) {
      setNotice(error instanceof Error ? error.message : ru.api.requestFailed);
    } finally {
      setBusy(false);
    }
  }

  async function giftPremium(productId: string, name: string, stars: number) {
    if (!window.confirm(ru.miniApp.community.giftPremiumConfirm(name, stars))) return;
    setBusy(true);
    setNotice('');
    try {
      const invoice = await api.giftPremiumInvoice(conversationId, productId);
      if (!invoice.invoiceLink) throw new Error(ru.api.requestFailed);
      getTelegram()?.openInvoice(invoice.invoiceLink);
      setNotice(ru.miniApp.community.giftPremiumInvoiceOpened);
      setGiftOpen(false);
      setOpen(false);
    } catch (error) {
      setNotice(error instanceof Error ? error.message : ru.api.requestFailed);
    } finally {
      setBusy(false);
    }
  }

  async function shareScenario(variantId: string) {
    if (!premium) {
      premiumMessage();
      return;
    }
    setBusy(true);
    setNotice('');
    try {
      await api.shareConversationScenario(conversationId, variantId, replyToMessageId);
      setNotice(ru.miniApp.community.scenarioShared);
      setScenarioOpen(false);
      setOpen(false);
      onSent?.();
    } catch (error) {
      setNotice(error instanceof Error ? error.message : ru.api.requestFailed);
    } finally {
      setBusy(false);
    }
  }

  async function sendPendingPlaylist(title?: string) {
    const files = pendingAudioFiles.slice(0, 20);
    if (!files.length) return;
    const mediaGroupId = files.length > 1 || title ? crypto.randomUUID() : undefined;
    for (const [index, file] of files.entries()) {
      await sendBlob(
        file,
        'audio',
        file.name,
        mediaGroupId,
        index === 0,
        title,
        index === 0 ? playlistCaption.trim() || undefined : undefined,
        playlistCaptionPosition,
      );
    }
    setPendingAudioFiles([]);
    setPlaylistTitle('');
    setPlaylistCaption('');
    setPlaylistNameOpen(false);
  }

  async function sendPendingMedia() {
    const files = pendingMediaFiles.slice(0, 10);
    if (!files.length) return;
    const ordered = [
      ...files.filter((file) => file.type !== 'image/gif'),
      ...files.filter((file) => file.type === 'image/gif'),
    ];
    const mediaGroupId = ordered.length > 1 ? crypto.randomUUID() : undefined;
    for (const [index, file] of ordered.entries()) {
      const kind: ChatMediaKind =
        file.type === 'image/gif'
          ? 'animation'
          : file.type.startsWith('video/')
            ? 'video'
            : 'photo';
      await sendBlob(
        file,
        kind,
        file.name,
        mediaGroupId,
        index === 0,
        undefined,
        index === 0 && kind !== 'animation' ? mediaCaption.trim() || undefined : undefined,
        captionPosition,
      );
    }
    setPendingMediaFiles([]);
    setMediaCaption('');
    setCaptionPosition('bottom');
  }

  return (
    <div className="chat-tools">
      <button
        className="chat-tool-main"
        type="button"
        aria-label={ru.miniApp.community.attach}
        onClick={() => setOpen((value) => !value)}
      >
        <Paperclip className="h-5 w-5" />
      </button>
      {open ? (
        <Card className="attachment-menu">
          <button type="button" onClick={() => photoRef.current?.click()}>
            <Image /> {ru.miniApp.community.sendPhoto}
          </button>
          <button
            type="button"
            onClick={() => (premium ? mediaRef.current?.click() : premiumMessage())}
          >
            <Video /> {ru.miniApp.community.sendVideoGif}
          </button>
          <button
            type="button"
            onClick={() => (premium ? audioRef.current?.click() : premiumMessage())}
          >
            <FileAudio /> {ru.miniApp.community.sendAudio}
          </button>
          <button type="button" onClick={() => setShareConfirmOpen(true)}>
            <UserRound /> {ru.miniApp.community.shareProfile}
          </button>
          <button
            type="button"
            onClick={() => (premium ? setScenarioOpen((value) => !value) : premiumMessage())}
          >
            <BookOpen /> {ru.miniApp.community.shareScenario}
          </button>
          {scenarioOpen && premium ? (
            <div className="attachment-gifts">
              <strong>{ru.miniApp.community.shareScenarioTitle}</strong>
              {scenarios.data?.map((variant) => (
                <button
                  key={variant.id}
                  type="button"
                  disabled={busy}
                  onClick={() => void shareScenario(variant.id)}
                >
                  <BookOpen /> {variant.name}
                </button>
              ))}
              {scenarios.isSuccess && !scenarios.data.length ? (
                <span>{ru.miniApp.community.shareScenarioEmpty}</span>
              ) : null}
            </div>
          ) : null}
          <button type="button" onClick={() => setGiftOpen((value) => !value)}>
            <Gift /> {ru.miniApp.community.giftPremium}
          </button>
          {giftOpen ? (
            <div className="attachment-gifts">
              <strong>{ru.miniApp.community.giftPremiumTitle}</strong>
              {products.data
                ?.filter((product) => product.billing_type === 'one_time')
                .map((product) => (
                  <button
                    key={product.id}
                    type="button"
                    disabled={busy}
                    onClick={() => void giftPremium(product.id, product.name, product.stars_amount)}
                  >
                    <Gift /> {product.name} · {product.stars_amount} ⭐
                  </button>
                ))}
              {products.isSuccess &&
              !products.data.some((product) => product.billing_type === 'one_time') ? (
                <span>{ru.miniApp.community.giftPremiumNoPlans}</span>
              ) : null}
            </div>
          ) : null}
        </Card>
      ) : null}
      <input
        ref={photoRef}
        hidden
        multiple
        type="file"
        accept="image/jpeg,image/png,image/webp,image/gif,video/mp4,video/webm,video/quicktime"
        onChange={(event) => {
          const files = [...(event.target.files ?? [])].slice(0, 10);
          if (files.length) setPendingMediaFiles(files);
          event.target.value = '';
        }}
      />
      <input
        ref={mediaRef}
        hidden
        multiple
        type="file"
        accept="image/gif,video/mp4,video/webm,video/quicktime"
        onChange={(event) => {
          const files = [...(event.target.files ?? [])].slice(0, 10);
          if (files.length) setPendingMediaFiles(files);
          event.target.value = '';
        }}
      />
      {pendingMediaFiles.length ? (
        <div className="confirm-dialog-backdrop" role="presentation">
          <Card
            className="confirm-dialog chat-media-caption-dialog"
            role="dialog"
            aria-modal="true"
          >
            <h2>{ru.miniApp.community.sendMedia}</h2>
            <div className="chat-media-caption-preview">
              {pendingMediaFiles.map((file) => (
                <span key={`${file.name}-${file.lastModified}`}>
                  <PendingMediaThumbnail file={file} />
                  <small>{file.name}</small>
                </span>
              ))}
            </div>
            {!pendingMediaFiles.every((file) => file.type === 'image/gif') ? (
              <label className="chat-media-caption-field">
                <span>{ru.miniApp.community.mediaCaption}</span>
                <textarea
                  value={mediaCaption}
                  maxLength={4_000}
                  placeholder={ru.miniApp.community.mediaCaptionPlaceholder}
                  onChange={(event) => setMediaCaption(event.target.value)}
                />
              </label>
            ) : null}
            <button
              type="button"
              className="chat-caption-position"
              onClick={() => setCaptionPosition((value) => (value === 'top' ? 'bottom' : 'top'))}
            >
              {captionPosition === 'top' ? <ChevronUp /> : <ChevronDown />}
              {captionPosition === 'top'
                ? ru.miniApp.community.captionAbove
                : ru.miniApp.community.captionBelow}
            </button>
            <div className="confirm-dialog-actions">
              <button
                type="button"
                className="button button-primary"
                disabled={busy}
                onClick={() => void sendPendingMedia()}
              >
                <Send /> {ru.miniApp.community.sendMedia}
              </button>
              <button
                type="button"
                className="button button-secondary"
                disabled={busy}
                onClick={() => {
                  setPendingMediaFiles([]);
                  setMediaCaption('');
                }}
              >
                {ru.miniApp.community.cancelAction}
              </button>
            </div>
          </Card>
        </div>
      ) : null}
      <input
        ref={audioRef}
        hidden
        multiple
        type="file"
        accept="audio/mpeg,audio/mp4,audio/ogg,audio/webm"
        onChange={(event) => {
          const files = [...(event.target.files ?? [])].slice(0, 20);
          if (files.length === 1 && files[0]) {
            void sendBlob(files[0], 'audio', files[0].name);
          } else if (files.length > 1) {
            setPendingAudioFiles(files);
            setPlaylistNameOpen(true);
          }
          event.target.value = '';
        }}
      />
      {busy ? <p className="chat-tool-notice">{ru.miniApp.community.sendingMedia}</p> : null}
      {notice ? <p className="chat-tool-notice">{notice}</p> : null}
      {uploadProgress !== null ? (
        <div
          className="chat-media-upload-progress"
          role="progressbar"
          aria-valuemin={0}
          aria-valuemax={100}
          aria-valuenow={uploadProgress}
        >
          <span>{ru.miniApp.community.mediaUploadProgress(uploadProgress)}</span>
          <small title={uploadFileName}>{uploadFileName}</small>
          <i aria-hidden>
            <b style={{ width: `${uploadProgress}%` }} />
          </i>
        </div>
      ) : null}
      {playlistNameOpen ? (
        <div className="confirm-dialog-backdrop" role="presentation">
          <Card
            className="confirm-dialog chat-playlist-name-dialog"
            role="dialog"
            aria-modal="true"
          >
            <h2>{ru.miniApp.community.namePlaylistQuestion}</h2>
            <label className="chat-playlist-title">
              <span>{ru.miniApp.community.playlistTitle}</span>
              <input
                autoFocus
                value={playlistTitle}
                maxLength={120}
                placeholder={ru.miniApp.community.playlistTitleOptional}
                onChange={(event) => setPlaylistTitle(event.target.value)}
              />
              <small>{ru.miniApp.community.playlistLimit}</small>
            </label>
            <label className="chat-media-caption-field">
              <span>{ru.miniApp.community.mediaCaption}</span>
              <textarea
                value={playlistCaption}
                maxLength={4_000}
                placeholder={ru.miniApp.community.mediaCaptionPlaceholder}
                onChange={(event) => setPlaylistCaption(event.target.value)}
              />
            </label>
            <button
              type="button"
              className="chat-caption-position"
              onClick={() =>
                setPlaylistCaptionPosition((value) => (value === 'top' ? 'bottom' : 'top'))
              }
            >
              {playlistCaptionPosition === 'top' ? <ChevronUp /> : <ChevronDown />}
              {playlistCaptionPosition === 'top'
                ? ru.miniApp.community.captionAbove
                : ru.miniApp.community.captionBelow}
            </button>
            <div className="confirm-dialog-actions chat-playlist-name-actions">
              <button
                type="button"
                className="button button-primary"
                disabled={busy}
                onClick={() => void sendPendingPlaylist(playlistTitle.trim() || undefined)}
              >
                {playlistTitle.trim()
                  ? ru.miniApp.community.sendPlaylist
                  : ru.miniApp.community.keepPlaylistUntitled}
              </button>
              <button
                type="button"
                className="button button-secondary"
                disabled={busy}
                onClick={() => {
                  setPendingAudioFiles([]);
                  setPlaylistTitle('');
                  setPlaylistCaption('');
                  setPlaylistNameOpen(false);
                }}
              >
                {ru.miniApp.community.cancelAction}
              </button>
            </div>
          </Card>
        </div>
      ) : null}
      <ConfirmDialog
        open={shareConfirmOpen}
        title={ru.miniApp.community.shareProfile}
        description={ru.miniApp.community.shareProfileConfirm}
        confirmLabel={ru.miniApp.community.shareProfile}
        cancelLabel={ru.miniApp.community.cancelAction}
        loading={busy}
        onConfirm={() => void shareProfile()}
        onCancel={() => setShareConfirmOpen(false)}
      />
    </div>
  );
}

export function VoiceRecorderButton({
  conversationId,
  premium,
  onSent,
  replyToMessageId,
}: ChatToolsProps) {
  const [recording, setRecording] = useState(false);
  const [requestingMicrophone, setRequestingMicrophone] = useState(false);
  const [pending, setPending] = useState<{ blob: Blob; url: string; name: string } | null>(null);
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState('');
  const [voiceCaption, setVoiceCaption] = useState('');
  const [voiceCaptionPosition, setVoiceCaptionPosition] = useState<'top' | 'bottom'>('bottom');
  const [captionOpen, setCaptionOpen] = useState(false);
  const recorderRef = useRef<MediaRecorder | null>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const chunksRef = useRef<Blob[]>([]);
  const stopActivityRef = useRef<(() => void) | null>(null);

  useEffect(
    () => () => {
      stopActivityRef.current?.();
      stopActivityRef.current = null;
      streamRef.current?.getTracks().forEach((track) => track.stop());
      if (pending) URL.revokeObjectURL(pending.url);
    },
    [pending],
  );

  const finish = () => {
    const recorder = recorderRef.current;
    if (recorder?.state === 'recording') recorder.stop();
  };

  const start = async () => {
    if (!premium) {
      premiumMessage();
      return;
    }
    if (!navigator.mediaDevices || typeof MediaRecorder === 'undefined') {
      setNotice(ru.miniApp.community.recordingUnsupported);
      return;
    }
    setRequestingMicrophone(true);
    setNotice('');
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      const mimeType = ['audio/mp4', 'audio/ogg;codecs=opus', 'audio/webm;codecs=opus'].find(
        (value) => MediaRecorder.isTypeSupported(value),
      );
      const recorder = new MediaRecorder(stream, mimeType ? { mimeType } : undefined);
      chunksRef.current = [];
      streamRef.current = stream;
      recorderRef.current = recorder;
      setPending(null);
      recorder.ondataavailable = (event) => {
        if (event.data.size) chunksRef.current.push(event.data);
      };
      recorder.onstop = () => {
        stopActivityRef.current?.();
        stopActivityRef.current = null;
        stream.getTracks().forEach((track) => track.stop());
        const type = recorder.mimeType || 'audio/webm';
        const blob = new Blob(chunksRef.current, { type });
        const extension = type.includes('ogg') ? 'ogg' : type.includes('mp4') ? 'm4a' : 'webm';
        setPending({
          blob,
          url: URL.createObjectURL(blob),
          name: `voice-${Date.now()}.${extension}`,
        });
        setRecording(false);
      };
      recorder.start(250);
      stopActivityRef.current = startChatActivity(conversationId, 'recording_voice', 3_000);
      setRecording(true);
    } catch {
      setNotice(ru.miniApp.community.recordingUnsupported);
    } finally {
      setRequestingMicrophone(false);
    }
  };

  const send = async () => {
    if (!pending) return;
    setBusy(true);
    const stopActivity = startChatActivity(conversationId, 'sending_media', 5_000);
    try {
      await api.sendConversationMedia(conversationId, {
        kind: 'voice',
        fileName: pending.name,
        mimeType: pending.blob.type.split(';')[0] || 'audio/webm',
        dataBase64: await fileBase64(new File([pending.blob], pending.name)),
        ...(replyToMessageId ? { replyToMessageId } : {}),
        ...(voiceCaption.trim()
          ? { caption: voiceCaption.trim(), captionPosition: voiceCaptionPosition }
          : {}),
      });
      URL.revokeObjectURL(pending.url);
      setPending(null);
      setVoiceCaption('');
      setCaptionOpen(false);
      onSent?.();
    } catch (error) {
      setNotice(error instanceof Error ? error.message : ru.api.requestFailed);
    } finally {
      stopActivity();
      setBusy(false);
    }
  };

  if (pending) {
    return (
      <div className="voice-recorder-preview">
        <div className="voice-recorder-row">
          <audio src={pending.url} controls preload="metadata" />
          <button
            type="button"
            className={`voice-caption-toggle${captionOpen ? ' is-open' : ''}`}
            aria-pressed={captionOpen}
            aria-label={ru.miniApp.community.addCaptionOptional}
            title={ru.miniApp.community.addCaptionOptional}
            onClick={() => setCaptionOpen((open) => !open)}
          >
            <Type />
          </button>
          <button
            type="button"
            onClick={() => {
              URL.revokeObjectURL(pending.url);
              setPending(null);
              setVoiceCaption('');
              setCaptionOpen(false);
            }}
            aria-label={ru.miniApp.community.cancelAction}
          >
            <X />
          </button>
          <button
            type="button"
            className="voice-recorder-send"
            disabled={busy}
            onClick={() => void send()}
            aria-label={ru.miniApp.community.sendMessage}
          >
            <Send />
          </button>
        </div>
        {captionOpen ? (
          <div className="voice-recorder-caption">
            <textarea
              value={voiceCaption}
              maxLength={4_000}
              placeholder={ru.miniApp.community.mediaCaptionPlaceholder}
              onChange={(event) => setVoiceCaption(event.target.value)}
            />
            <button
              type="button"
              className="chat-caption-position"
              onClick={() =>
                setVoiceCaptionPosition((value) => (value === 'top' ? 'bottom' : 'top'))
              }
            >
              {voiceCaptionPosition === 'top' ? <ChevronUp /> : <ChevronDown />}
              <span>
                {voiceCaptionPosition === 'top'
                  ? ru.miniApp.community.captionAbove
                  : ru.miniApp.community.captionBelow}
              </span>
            </button>
          </div>
        ) : null}
        {notice ? <small>{notice}</small> : null}
      </div>
    );
  }
  return (
    <div className={`voice-recorder ${recording ? 'is-recording' : ''}`}>
      {recording ? (
        <span>{ru.miniApp.community.recordingNow}</span>
      ) : requestingMicrophone ? (
        <span>{ru.miniApp.community.requestingMicrophone}</span>
      ) : null}
      <button
        type="button"
        className="chat-icon-button"
        disabled={requestingMicrophone}
        aria-label={
          requestingMicrophone
            ? ru.miniApp.community.requestingMicrophone
            : recording
              ? ru.miniApp.community.stopRecording
              : ru.miniApp.community.recordVoice
        }
        onClick={() => {
          if (recording) finish();
          else void start();
        }}
      >
        {recording ? <Square /> : <Mic />}
      </button>
      {notice ? <small>{notice}</small> : null}
    </div>
  );
}
