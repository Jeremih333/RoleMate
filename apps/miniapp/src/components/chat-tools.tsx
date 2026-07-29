import { useEffect, useRef, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import {
  Camera,
  FileAudio,
  Gift,
  Image,
  Mic,
  Paperclip,
  Phone,
  PhoneOff,
  Send,
  UserRound,
  Video,
} from 'lucide-react';
import { ru } from '@rolemate/shared';
import { api, type AnonymousCall, type ChatMediaKind, type TurnCredentials } from '../api.js';
import { Button, Card } from './ui.js';
import { getTelegram } from '../telegram.js';

interface ChatToolsProps {
  conversationId: string;
  premium: boolean;
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

export function ChatTools({ conversationId, premium }: ChatToolsProps) {
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState('');
  const [giftOpen, setGiftOpen] = useState(false);
  const photoRef = useRef<HTMLInputElement>(null);
  const mediaRef = useRef<HTMLInputElement>(null);
  const audioRef = useRef<HTMLInputElement>(null);
  const recorderRef = useRef<MediaRecorder | null>(null);
  const recordedChunksRef = useRef<Blob[]>([]);
  const products = useQuery({
    queryKey: ['products'],
    queryFn: api.products,
    enabled: open && giftOpen,
  });

  async function sendBlob(blob: Blob, kind: ChatMediaKind, fallbackName: string) {
    if (kind !== 'photo' && !premium) {
      premiumMessage();
      return;
    }
    const maxBytes = kind === 'photo' ? 8 * 1024 * 1024 : 16 * 1024 * 1024;
    if (blob.size > maxBytes) {
      setNotice(ru.api.chatMediaTooLarge);
      return;
    }
    setBusy(true);
    setNotice('');
    try {
      await api.sendConversationMedia(conversationId, {
        kind,
        fileName: safeFileName(blob, fallbackName),
        mimeType: blob.type.split(';')[0] || 'application/octet-stream',
        dataBase64: await fileBase64(new File([blob], safeFileName(blob, fallbackName))),
      });
      setNotice(ru.miniApp.community.mediaSent);
      setOpen(false);
    } catch (error) {
      setNotice(error instanceof Error ? error.message : ru.api.requestFailed);
    } finally {
      setBusy(false);
    }
  }

  async function startRecording(kind: 'voice' | 'video_note') {
    if (!premium) {
      premiumMessage();
      return;
    }
    if (!navigator.mediaDevices || typeof MediaRecorder === 'undefined') {
      setNotice(ru.miniApp.community.recordingUnsupported);
      return;
    }
    const candidates =
      kind === 'voice'
        ? ['audio/mp4', 'audio/ogg;codecs=opus', 'audio/webm;codecs=opus']
        : ['video/mp4;codecs=avc1,mp4a.40.2', 'video/mp4'];
    const mimeType = candidates.find((value) => MediaRecorder.isTypeSupported(value));
    if (!mimeType) {
      setNotice(
        kind === 'video_note'
          ? ru.miniApp.community.videoNoteUnsupported
          : ru.miniApp.community.recordingUnsupported,
      );
      return;
    }
    const stream = await navigator.mediaDevices.getUserMedia({
      audio: true,
      video: kind === 'video_note',
    });
    const recorder = new MediaRecorder(stream, { mimeType });
    recordedChunksRef.current = [];
    recorder.ondataavailable = (event) => {
      if (event.data.size) recordedChunksRef.current.push(event.data);
    };
    recorder.onstop = () => {
      stream.getTracks().forEach((track) => track.stop());
      const extension = mimeType.startsWith('video/')
        ? 'mp4'
        : mimeType.includes('ogg')
          ? 'ogg'
          : 'm4a';
      void sendBlob(
        new Blob(recordedChunksRef.current, { type: mimeType }),
        kind,
        `${kind}-${Date.now()}.${extension}`,
      );
    };
    recorderRef.current = recorder;
    recorder.start();
    setNotice(ru.miniApp.community.recordingNow);
  }

  function stopRecording() {
    if (recorderRef.current?.state === 'recording') recorderRef.current.stop();
    recorderRef.current = null;
  }

  async function shareProfile() {
    if (!window.confirm(ru.miniApp.community.shareProfileConfirm)) return;
    setBusy(true);
    try {
      await api.shareConversationProfile(conversationId);
      setNotice(ru.miniApp.community.profileShared);
      setOpen(false);
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

  return (
    <div className="chat-tools">
      <div className="chat-composer">
        <button
          className="chat-tool-main"
          type="button"
          aria-label={ru.miniApp.community.attach}
          onClick={() => setOpen((value) => !value)}
        >
          <Paperclip className="h-5 w-5" />
        </button>
        <span>{ru.miniApp.community.attachHint}</span>
        <Send className="h-4 w-4 text-muted" />
      </div>
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
          <button type="button" onClick={() => void startRecording('voice')}>
            <Mic /> {ru.miniApp.community.recordVoice}
          </button>
          <button type="button" onClick={() => void startRecording('video_note')}>
            <Camera /> {ru.miniApp.community.recordVideoNote}
          </button>
          <button type="button" onClick={() => void shareProfile()}>
            <UserRound /> {ru.miniApp.community.shareProfile}
          </button>
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
        type="file"
        accept="image/jpeg,image/png,image/webp"
        onChange={(event) => {
          const file = event.target.files?.[0];
          if (file) void sendBlob(file, 'photo', file.name);
          event.target.value = '';
        }}
      />
      <input
        ref={mediaRef}
        hidden
        type="file"
        accept="image/gif,video/mp4,video/webm,video/quicktime"
        onChange={(event) => {
          const file = event.target.files?.[0];
          if (file)
            void sendBlob(file, file.type === 'image/gif' ? 'animation' : 'video', file.name);
          event.target.value = '';
        }}
      />
      <input
        ref={audioRef}
        hidden
        type="file"
        accept="audio/mpeg,audio/mp4,audio/ogg,audio/webm"
        onChange={(event) => {
          const file = event.target.files?.[0];
          if (file) void sendBlob(file, 'audio', file.name);
          event.target.value = '';
        }}
      />
      {recorderRef.current?.state === 'recording' ? (
        <Button variant="secondary" onClick={stopRecording}>
          <PhoneOff className="h-4 w-4" /> {ru.miniApp.community.stopRecording}
        </Button>
      ) : null}
      {busy ? <p className="chat-tool-notice">{ru.miniApp.community.sendingMedia}</p> : null}
      {notice ? <p className="chat-tool-notice">{notice}</p> : null}
      <AnonymousCallControls conversationId={conversationId} premium={premium} />
    </div>
  );
}

function AnonymousCallControls({ conversationId, premium }: ChatToolsProps) {
  const [afterSequence, setAfterSequence] = useState(0);
  const [activeCall, setActiveCall] = useState<AnonymousCall | null>(null);
  const [error, setError] = useState('');
  const peerRef = useRef<RTCPeerConnection | null>(null);
  const localStreamRef = useRef<MediaStream | null>(null);
  const remoteVideoRef = useRef<HTMLVideoElement>(null);
  const localVideoRef = useRef<HTMLVideoElement>(null);
  const poll = useQuery({
    queryKey: ['call', conversationId, afterSequence],
    queryFn: () => api.pollCall(conversationId, afterSequence),
    refetchInterval: 5_000,
  });

  async function createPeer(
    kind: 'audio' | 'video',
    callId: string,
    existingCredentials?: TurnCredentials,
  ) {
    const credentials = existingCredentials ?? (await api.callTurnCredentials(conversationId));
    const stream = await navigator.mediaDevices.getUserMedia({
      audio: true,
      video: kind === 'video',
    });
    localStreamRef.current = stream;
    if (localVideoRef.current) localVideoRef.current.srcObject = stream;
    const peer = new RTCPeerConnection({
      iceServers: credentials.iceServers,
      iceTransportPolicy: 'relay',
    });
    stream.getTracks().forEach((track) => peer.addTrack(track, stream));
    peer.ontrack = (event) => {
      if (remoteVideoRef.current) remoteVideoRef.current.srcObject = event.streams[0] ?? null;
    };
    peer.onicecandidate = (event) => {
      if (event.candidate) {
        void api.signalCall(callId, 'ice', JSON.stringify(event.candidate.toJSON()));
      }
    };
    peerRef.current = peer;
    return peer;
  }

  function cleanup() {
    peerRef.current?.close();
    peerRef.current = null;
    localStreamRef.current?.getTracks().forEach((track) => track.stop());
    localStreamRef.current = null;
    setActiveCall(null);
  }

  async function start(kind: 'audio' | 'video') {
    if (!premium) {
      premiumMessage();
      return;
    }
    setError('');
    try {
      const credentials = await api.callTurnCredentials(conversationId);
      const call = await api.startCall(conversationId, kind);
      setActiveCall(call);
      const peer = await createPeer(kind, call.id, credentials);
      const offer = await peer.createOffer();
      await peer.setLocalDescription(offer);
      await api.signalCall(call.id, 'offer', JSON.stringify(offer));
    } catch (caught) {
      cleanup();
      setError(caught instanceof Error ? caught.message : ru.api.callsUnavailable);
    }
  }

  async function accept(call: AnonymousCall) {
    if (!premium) {
      premiumMessage();
      return;
    }
    try {
      const peer = await createPeer(call.kind, call.id);
      await api.respondCall(call.id, true);
      setActiveCall({ ...call, status: 'active' });
      const offerSignal = poll.data?.signals.find((signal) => signal.type === 'offer');
      if (!offerSignal) throw new Error(ru.miniApp.community.callConnecting);
      const offer = JSON.parse(offerSignal.payload) as RTCSessionDescriptionInit;
      await peer.setRemoteDescription(offer);
      const answer = await peer.createAnswer();
      await peer.setLocalDescription(answer);
      await api.signalCall(call.id, 'answer', JSON.stringify(answer));
    } catch (caught) {
      cleanup();
      setError(caught instanceof Error ? caught.message : ru.api.callsUnavailable);
    }
  }

  async function end() {
    if (activeCall) await api.endCall(activeCall.id).catch(() => undefined);
    cleanup();
  }

  useEffect(() => {
    const data = poll.data;
    if (!data?.call) return;
    const call = data.call;
    setActiveCall((current) => current ?? call);
    void (async () => {
      for (const signal of data.signals) {
        if (!peerRef.current) continue;
        if (signal.type === 'answer' && peerRef.current.signalingState === 'have-local-offer') {
          await peerRef.current.setRemoteDescription(
            JSON.parse(signal.payload) as RTCSessionDescriptionInit,
          );
        } else if (signal.type === 'ice' && peerRef.current.remoteDescription) {
          await peerRef.current.addIceCandidate(JSON.parse(signal.payload) as RTCIceCandidateInit);
        }
        setAfterSequence((current) => Math.max(current, signal.sequence));
      }
      if (['declined', 'ended', 'missed'].includes(call.status)) cleanup();
    })().catch((caught: unknown) => {
      setError(caught instanceof Error ? caught.message : ru.api.callsUnavailable);
    });
  }, [poll.data]);

  useEffect(() => cleanup, []);

  const incoming = poll.data?.call;
  return (
    <div className="call-controls">
      <div className="flex flex-wrap gap-2">
        <Button variant="secondary" onClick={() => void start('audio')}>
          <Phone className="h-4 w-4" /> {ru.miniApp.community.audioCall}
        </Button>
        <Button variant="secondary" onClick={() => void start('video')}>
          <Video className="h-4 w-4" /> {ru.miniApp.community.videoCall}
        </Button>
      </div>
      {incoming && !incoming.isInitiator && incoming.status === 'ringing' ? (
        <Card className="incoming-call">
          <strong>
            {incoming.kind === 'video'
              ? ru.miniApp.community.incomingVideoCall
              : ru.miniApp.community.incomingAudioCall}
          </strong>
          <div className="flex gap-2">
            <Button onClick={() => void accept(incoming)}>{ru.miniApp.community.acceptCall}</Button>
            <Button variant="secondary" onClick={() => void api.respondCall(incoming.id, false)}>
              {ru.miniApp.community.declineCall}
            </Button>
          </div>
        </Card>
      ) : null}
      {activeCall ? (
        <div className="call-stage">
          <video ref={remoteVideoRef} autoPlay playsInline />
          <video ref={localVideoRef} autoPlay muted playsInline />
          <Button variant="secondary" onClick={() => void end()}>
            <PhoneOff className="h-4 w-4" /> {ru.miniApp.community.endCall}
          </Button>
        </div>
      ) : null}
      {error ? (
        <p className="chat-tool-notice">
          {error}{' '}
          {error === ru.api.premiumRequired ? (
            <a href="/premium">{ru.miniApp.search.openPremium}</a>
          ) : null}
        </p>
      ) : null}
    </div>
  );
}
