import { useEffect, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { Check, Send, X } from 'lucide-react';
import { ru } from '@rolemate/shared';
import { api } from '../api.js';
import { ProfileAvatar } from './profile-avatar.js';
import { VerificationBadge } from './verification-badge.js';
import { Button, Skeleton } from './ui.js';

export function ShareToChatsDialog({
  open,
  loading,
  onClose,
  onSend,
  allowCaption = false,
}: {
  open: boolean;
  loading: boolean;
  onClose: () => void;
  onSend: (conversationIds: string[], caption?: string) => void;
  allowCaption?: boolean;
}) {
  const [selected, setSelected] = useState<Set<string>>(() => new Set());
  const [caption, setCaption] = useState('');
  const conversations = useQuery({
    queryKey: ['conversations'],
    queryFn: () => api.conversations(),
    enabled: open,
  });
  useEffect(() => {
    if (!open) {
      setSelected(new Set());
      setCaption('');
    }
  }, [open]);
  if (!open) return null;
  return (
    <div
      className="confirm-dialog-backdrop share-dialog-backdrop"
      role="presentation"
      onMouseDown={(event) => {
        if (event.target === event.currentTarget && !loading) onClose();
      }}
    >
      <section className="share-dialog" role="dialog" aria-modal="true">
        <header className="share-dialog-header">
          <div>
            <h2>{ru.miniApp.social.chooseChats}</h2>
            <p>{ru.miniApp.social.chooseChatsDescription}</p>
          </div>
          <button type="button" className="icon-button" disabled={loading} onClick={onClose}>
            <X aria-hidden />
          </button>
        </header>
        <div className="share-dialog-list">
          {conversations.isLoading ? <Skeleton className="h-20" /> : null}
          {conversations.data?.map((conversation) => {
            const checked = selected.has(conversation.id);
            return (
              <button
                className={`share-chat-row ${checked ? 'selected' : ''}`}
                type="button"
                key={conversation.id}
                onClick={() =>
                  setSelected((current) => {
                    const next = new Set(current);
                    if (next.has(conversation.id)) next.delete(conversation.id);
                    else if (next.size < 20) next.add(conversation.id);
                    return next;
                  })
                }
              >
                <ProfileAvatar
                  mediaId={conversation.avatar_media_id}
                  renderMode={conversation.avatar_render_mode}
                  name={conversation.display_name ?? conversation.anonymous_alias}
                />
                <span className="share-chat-name">
                  {conversation.display_name ?? conversation.anonymous_alias}
                  <VerificationBadge
                    kind={conversation.verification_kind}
                    premium={conversation.has_premium}
                  />
                </span>
                <span className="share-chat-check">{checked ? <Check aria-hidden /> : null}</span>
              </button>
            );
          })}
        </div>
        {allowCaption ? (
          <label className="share-dialog-caption">
            <span>{ru.miniApp.community.addShareCaption}</span>
            <textarea
              value={caption}
              maxLength={1_000}
              onChange={(event) => setCaption(event.target.value)}
              placeholder={ru.miniApp.community.shareCaptionPlaceholder}
            />
          </label>
        ) : null}
        <footer className="share-dialog-footer">
          <span>{ru.miniApp.social.chatsSelected(selected.size)}</span>
          <Button
            loading={loading}
            disabled={selected.size === 0}
            onClick={() => onSend([...selected], caption.trim() || undefined)}
          >
            <Send className="h-4 w-4" aria-hidden /> {ru.miniApp.social.sendShare}
          </Button>
        </footer>
      </section>
    </div>
  );
}
