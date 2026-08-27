import { Fragment, useCallback, useEffect, useRef, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { ru } from '@rolemate/shared';
import {
  AlertTriangle,
  Archive,
  Ban,
  BellOff,
  Check,
  ChevronDown,
  ChevronLeft,
  ChevronRight,
  CheckSquare,
  Copy,
  Crown,
  ExternalLink,
  Gift,
  Heart,
  MessageCircle,
  Forward,
  HeartHandshake,
  PauseCircle,
  Pause,
  Pencil,
  Pin,
  Play,
  Save,
  Send,
  ShieldCheck,
  MoreVertical,
  Reply,
  Search,
  ThumbsDown,
  ThumbsUp,
  Trash2,
  X,
} from 'lucide-react';
import {
  ApiError,
  api,
  type Conversation,
  type ConversationMessage,
  type PinnedConversationMessage,
  type ChatReaction,
  type ChatMediaKind,
  type PublicProfilePrivacyInput,
  type SettingsInput,
  type UserSettings,
} from '../api.js';
import {
  Button,
  Card,
  ConfirmDialog,
  EmptyState,
  SectionTitle,
  Skeleton,
} from '../components/ui.js';
import { applyThemePreference, getTelegram } from '../telegram.js';
import { ChatTools, VoiceRecorderButton } from '../components/chat-tools.js';
import { ProfileAvatar } from '../components/profile-avatar.js';
import { VerificationBadge } from '../components/verification-badge.js';
import { ProfileMarkdown } from '../components/markdown.js';
import {
  musicProgressStyle,
  SwipePlaylist,
  type PlaylistTrack,
  useMusicPlayer,
} from '../components/music-player.js';
import { ShareToChatsDialog } from '../components/share-to-chats.js';
import { Link, useLocation, useSearch } from 'wouter';
import { createPortal } from 'react-dom';
import { useUserStore } from '../store.js';
import { DoubleHeartIcon } from '../components/double-heart-icon.js';
import { useViewerTime } from '../components/viewer-time.js';

export function MatchesPage() {
  const queryClient = useQueryClient();
  const matches = useQuery({ queryKey: ['matches'], queryFn: api.matches });
  const incoming = useQuery({
    queryKey: ['incoming-likes'],
    queryFn: api.incomingLikes,
  });
  const likeBack = useMutation({
    mutationFn: (userId: string) => api.swipe(userId, 'like'),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ['matches'] });
      void queryClient.invalidateQueries({ queryKey: ['incoming-likes'] });
    },
  });
  const dismissLike = useMutation({
    mutationFn: (userId: string) => api.swipe(userId, 'skip'),
    onSuccess: () => void queryClient.invalidateQueries({ queryKey: ['incoming-likes'] }),
  });
  if (matches.isLoading) return <Skeleton className="h-80" />;
  return (
    <div className="matches-page">
      <SectionTitle eyebrow={ru.miniApp.community.matchesEyebrow}>
        {ru.miniApp.community.matchesTitle}
      </SectionTitle>
      <div className="space-y-3">
        {(matches.data ?? []).map((match) => (
          <Card key={match.id} className="flex items-center gap-4 p-4">
            <Link
              className="profile-author-link flex min-w-0 flex-1 items-center gap-4"
              href={`/profiles/${match.other_user_id}`}
            >
              <ProfileAvatar
                mediaId={match.avatar_media_id}
                renderMode={match.avatar_render_mode}
                name={match.display_name}
              />
              <div className="min-w-0 flex-1">
                <strong className="inline-flex items-center gap-1">
                  {match.display_name ?? ru.miniApp.community.roleplayer}
                  <VerificationBadge kind={match.verification_kind} premium={match.has_premium} />
                </strong>
                <p className="truncate text-sm text-muted">{match.short_headline}</p>
              </div>
            </Link>
            <a className="button button-secondary" href="/chats">
              <MessageCircle className="h-4 w-4" />
            </a>
          </Card>
        ))}
        {!matches.data?.length ? (
          <EmptyState
            icon={<Heart className="h-7 w-7" />}
            title={ru.miniApp.community.matchesEmptyTitle}
            description={ru.miniApp.community.matchesEmptyDescription}
          />
        ) : null}
      </div>
      <div className="incoming-likes-heading">
        <SectionTitle eyebrow={ru.miniApp.community.likesEyebrow}>
          {ru.miniApp.community.incomingLikesTitle}
        </SectionTitle>
      </div>
      <div className="space-y-3">
        {incoming.data?.map((like) => (
          <Card
            key={like.swipe_id}
            className={`incoming-like-card p-4 ${like.action === 'super_like' ? 'is-super-like' : ''}`}
          >
            <div className="flex items-center justify-between gap-3">
              <Link
                className="profile-author-link flex min-w-0 items-center gap-3"
                href={`/profiles/${like.user_id}`}
              >
                <ProfileAvatar
                  mediaId={like.avatar_media_id}
                  renderMode={like.avatar_render_mode}
                  name={like.display_name}
                />
                <div className="min-w-0">
                  <strong className="flex items-center gap-1">
                    {like.display_name}
                    <VerificationBadge kind={like.verification_kind} premium={like.has_premium} />
                  </strong>
                  {like.username ? (
                    <p className="truncate text-xs text-lilac">@{like.username}</p>
                  ) : null}
                  <p className="truncate text-sm text-muted">{like.short_headline}</p>
                </div>
              </Link>
              <span className="incoming-like-kind">
                {like.action === 'super_like' ? (
                  <>
                    <DoubleHeartIcon /> {ru.miniApp.community.superLikeIncoming}
                  </>
                ) : (
                  ru.miniApp.community.like
                )}
              </span>
            </div>
            <div className="incoming-like-actions mt-3">
              <Button onClick={() => likeBack.mutate(like.user_id)} loading={likeBack.isPending}>
                <Heart className="h-4 w-4" /> {ru.miniApp.community.likeBack}
              </Button>
              <Button
                variant="secondary"
                onClick={() => dismissLike.mutate(like.user_id)}
                loading={dismissLike.isPending}
              >
                <X className="h-4 w-4" /> {ru.miniApp.community.dismissLike}
              </Button>
            </div>
          </Card>
        ))}
        {!incoming.isLoading && !incoming.data?.length ? (
          <Card className="p-4 text-sm text-soft">{ru.miniApp.community.incomingLikesEmpty}</Card>
        ) : null}
        {incoming.isError ? <div className="error-box">{incoming.error.message}</div> : null}
      </div>
    </div>
  );
}

export function ChatsPage() {
  const queryClient = useQueryClient();
  const [, navigate] = useLocation();
  const search = useSearch();
  const ownUserId = useUserStore((state) => state.user?.id);
  const [blockedUsersOpen, setBlockedUsersOpen] = useState(false);
  const [chatSettingsOpen, setChatSettingsOpen] = useState(false);
  const [archiveOpen, setArchiveOpen] = useState(false);
  const [orderedChats, setOrderedChats] = useState<Conversation[]>([]);
  const chats = useQuery({
    queryKey: ['conversations'],
    queryFn: () => api.conversations(),
    refetchOnMount: 'always',
    refetchOnWindowFocus: 'always',
    refetchInterval: 20_000,
  });
  const settings = useQuery({ queryKey: ['settings'], queryFn: api.settings });
  const archivedChats = useQuery({
    queryKey: ['conversations', 'archived'],
    queryFn: () => api.conversations(true),
    refetchOnMount: 'always',
    refetchOnWindowFocus: 'always',
    // The archive was polled every 20 seconds even while hidden, and archived
    // chats barely move; it is fetched only when the section can be shown.
    enabled: settings.data?.chat_archive_visible !== 0,
    refetchInterval: 60_000,
  });
  const archiveVisibility = useMutation({
    mutationFn: async (visible: boolean) => {
      if (!settings.data) throw new Error(ru.api.requestFailed);
      return api.saveSettings({ ...settingsInputFrom(settings.data), chatArchiveVisible: visible });
    },
    onSuccess: async (_, visible) => {
      if (!visible) setArchiveOpen(false);
      setChatSettingsOpen(false);
      await queryClient.invalidateQueries({ queryKey: ['settings'] });
    },
  });
  const archiveChat = useMutation({
    mutationFn: ({ conversationId, archived }: { conversationId: string; archived: boolean }) =>
      api.archiveConversation(conversationId, archived),
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: ['conversations'] });
    },
  });
  const pinChat = useMutation({
    mutationFn: ({ conversationId, pinned }: { conversationId: string; pinned: boolean }) =>
      api.pinConversation(conversationId, pinned),
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: ['conversations'] });
    },
  });
  const reorderPins = useMutation({
    mutationFn: (conversationIds: string[]) => api.reorderPinnedConversations(conversationIds),
    onSuccess: () => void queryClient.invalidateQueries({ queryKey: ['conversations'] }),
  });
  const deleteQuickChat = useMutation({
    mutationFn: api.deleteConversation,
    onSuccess: () => void queryClient.invalidateQueries({ queryKey: ['conversations'] }),
  });
  const blockQuickChat = useMutation({
    mutationFn: ({ userId, conversationId }: { userId: string; conversationId: string }) =>
      api.block(userId).then(() => api.deleteConversation(conversationId)),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ['conversations'] });
      void queryClient.invalidateQueries({ queryKey: ['blocked-users'] });
    },
  });
  const blockedUsers = useQuery({
    queryKey: ['blocked-users'],
    queryFn: api.blockedUsers,
    enabled: blockedUsersOpen,
  });
  const unblock = useMutation({
    mutationFn: api.unblock,
    onSuccess: async () => {
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: ['blocked-users'] }),
        queryClient.invalidateQueries({ queryKey: ['public-profile-view'] }),
        queryClient.invalidateQueries({ queryKey: ['search'] }),
        queryClient.invalidateQueries({ queryKey: ['posts'] }),
      ]);
    },
  });
  const premium = useQuery({ queryKey: ['premium-status'], queryFn: api.premiumStatus });
  const conversationId = new URLSearchParams(search).get('conversation');
  const openConversation = (id: string) => {
    navigate(`/chats?conversation=${encodeURIComponent(id)}`);
    void Promise.all([chats.refetch(), archivedChats.refetch()]);
  };
  useEffect(() => {
    if (chats.data) setOrderedChats(chats.data);
  }, [chats.data]);
  const selectedChat = [...(chats.data ?? []), ...(archivedChats.data ?? [])].find(
    (chat) => chat.id === conversationId,
  );
  if (chats.isLoading) return <Skeleton className="h-80" />;
  if (conversationId && selectedChat) {
    return (
      <ConversationView
        chat={selectedChat}
        premium={premium.data?.premium === true}
        onBack={() => navigate('/chats')}
      />
    );
  }
  if (conversationId && chats.isFetching) return <Skeleton className="h-80" />;
  if (conversationId && !selectedChat) {
    return (
      <EmptyState
        icon={<MessageCircle className="h-7 w-7" />}
        title={ru.miniApp.community.chatUnavailableTitle}
        description={ru.miniApp.community.chatUnavailableDescription}
        action={<Button onClick={() => navigate('/chats')}>{ru.miniApp.community.back}</Button>}
      />
    );
  }
  return (
    <div>
      <SectionTitle
        eyebrow={ru.miniApp.community.chatsEyebrow}
        action={
          <div className="chat-list-settings">
            <button
              type="button"
              className={`chat-settings-toggle ${chatSettingsOpen ? 'is-active' : ''}`}
              aria-label={ru.miniApp.community.chatSettings}
              aria-expanded={chatSettingsOpen}
              onClick={() => setChatSettingsOpen((open) => !open)}
            >
              <MoreVertical aria-hidden />
            </button>
            {chatSettingsOpen ? (
              <div className="chat-list-settings-menu">
                <button
                  type="button"
                  aria-expanded={blockedUsersOpen}
                  onClick={() => {
                    setBlockedUsersOpen((open) => !open);
                    setChatSettingsOpen(false);
                  }}
                >
                  <Ban aria-hidden />
                  {ru.miniApp.community.blockedUsers}
                </button>
                <button
                  type="button"
                  onClick={() =>
                    archiveVisibility.mutate(settings.data?.chat_archive_visible === 0)
                  }
                >
                  <Archive aria-hidden />
                  {settings.data?.chat_archive_visible === 0
                    ? ru.miniApp.community.showArchive
                    : ru.miniApp.community.hideArchive}
                </button>
              </div>
            ) : null}
          </div>
        }
      >
        {ru.miniApp.community.chatsTitle}
      </SectionTitle>
      {blockedUsersOpen ? (
        <Card className="chat-blacklist-panel p-3">
          <strong>{ru.miniApp.community.blockedUsers}</strong>
          {blockedUsers.isLoading ? <Skeleton className="mt-3 h-20" /> : null}
          {blockedUsers.isError ? (
            <div className="error-box mt-3">{blockedUsers.error.message}</div>
          ) : null}
          {!blockedUsers.isLoading && !blockedUsers.data?.length ? (
            <p className="mt-3 text-sm text-muted">{ru.miniApp.community.blockedUsersEmpty}</p>
          ) : null}
          {blockedUsers.data?.map((person) => (
            <div className="chat-blacklist-row" key={person.id}>
              <Link
                className="chat-blacklist-profile"
                href={`/profiles/${encodeURIComponent(person.id)}`}
                aria-label={ru.miniApp.community.openBlockedProfile}
              >
                <ProfileAvatar
                  name={person.display_name ?? ru.miniApp.community.blockedUserFallback}
                />
                <span>
                  <strong>
                    {person.display_name ?? ru.miniApp.community.blockedUserFallback}
                    <VerificationBadge
                      kind={person.verification_kind}
                      premium={person.has_premium}
                    />
                  </strong>
                  {person.username ? <small>@{person.username}</small> : null}
                </span>
                <ChevronRight aria-hidden />
              </Link>
              <Button
                variant="secondary"
                loading={unblock.isPending && unblock.variables === person.id}
                onClick={() => unblock.mutate(person.id)}
              >
                {ru.miniApp.community.unblockUser}
              </Button>
            </div>
          ))}
        </Card>
      ) : (
        <>
          {settings.data?.chat_archive_visible !== 0 && archivedChats.data?.length ? (
            <button
              className="chat-archive-row"
              type="button"
              onClick={() => setArchiveOpen((open) => !open)}
            >
              <Archive aria-hidden />
              <span>{ru.miniApp.community.archive}</span>
              <strong>{archivedChats.data?.length ?? 0}</strong>
              <ChevronDown className={archiveOpen ? 'is-open' : ''} aria-hidden />
            </button>
          ) : null}
          {settings.data?.chat_archive_visible !== 0 && archiveOpen ? (
            archivedChats.data?.length ? (
              <div className="telegram-chat-list chat-archive-list">
                {archivedChats.data.map((chat) => (
                  <ChatListRow
                    key={chat.id}
                    chat={chat}
                    ownUserId={ownUserId}
                    onOpen={() => openConversation(chat.id)}
                    onArchive={() =>
                      archiveChat.mutate({ conversationId: chat.id, archived: false })
                    }
                    onPin={() => undefined}
                  />
                ))}
              </div>
            ) : (
              <p className="mb-4 text-sm text-muted">{ru.miniApp.community.archiveEmpty}</p>
            )
          ) : null}
          {orderedChats.length ? (
            <>
              <p className="mb-4 text-sm text-muted">{ru.miniApp.community.chatListHint}</p>
              <div className="telegram-chat-list">
                {orderedChats.map((chat) => (
                  <ChatListRow
                    key={chat.id}
                    chat={chat}
                    ownUserId={ownUserId}
                    onOpen={() => openConversation(chat.id)}
                    onArchive={() =>
                      archiveChat.mutate({ conversationId: chat.id, archived: true })
                    }
                    onPin={() =>
                      pinChat.mutate({ conversationId: chat.id, pinned: chat.pinned_order == null })
                    }
                    onDelete={() => {
                      if (window.confirm(ru.miniApp.community.deleteChatDescription)) {
                        deleteQuickChat.mutate(chat.id);
                      }
                    }}
                    onBlock={() => {
                      if (window.confirm(ru.miniApp.community.blockConfirm)) {
                        blockQuickChat.mutate({
                          userId: chat.other_user_id,
                          conversationId: chat.id,
                        });
                      }
                    }}
                    onReorderOver={(targetId) =>
                      setOrderedChats((current) => reorderPinnedRows(current, chat.id, targetId))
                    }
                    onReorderCommit={() => {
                      const ids = orderedChats
                        .filter((item) => item.pinned_order != null)
                        .map((item) => item.id);
                      if (ids.length) reorderPins.mutate(ids);
                    }}
                  />
                ))}
              </div>
            </>
          ) : (
            <EmptyState
              icon={<MessageCircle className="h-7 w-7" />}
              title={ru.miniApp.community.chatsEmptyTitle}
              description={ru.miniApp.community.chatsEmptyDescription}
            />
          )}
        </>
      )}
    </div>
  );
}

function ChatListRow({
  chat,
  ownUserId,
  onOpen,
  onArchive,
  onPin,
  onDelete,
  onBlock,
  onReorderOver,
  onReorderCommit,
}: {
  chat: Conversation;
  ownUserId: string | undefined;
  onOpen: () => void;
  onArchive: () => void;
  onPin: () => void;
  onDelete?: () => void;
  onBlock?: () => void;
  onReorderOver?: (targetId: string) => void;
  onReorderCommit?: () => void;
}) {
  const viewerTime = useViewerTime();
  const [actionsOpen, setActionsOpen] = useState(false);
  const holdTimer = useRef<number | null>(null);
  const dragging = useRef(false);
  const suppressNextClick = useRef(false);
  const preview = conversationListPreview(chat);
  // Telegram closes a held-open chat preview on any tap outside it, and on Escape.
  useEffect(() => {
    if (!actionsOpen) return;
    const close = (event: KeyboardEvent) => {
      if (event.key === 'Escape') setActionsOpen(false);
    };
    window.addEventListener('keydown', close);
    return () => window.removeEventListener('keydown', close);
  }, [actionsOpen]);
  const previewMessages = useQuery({
    queryKey: ['conversation-preview', chat.id],
    queryFn: () => api.conversationMessages(chat.id),
    enabled: actionsOpen,
    staleTime: 15_000,
  });
  return (
    <div className="telegram-chat-row-wrap" data-chat-row-id={chat.id}>
      <button
        type="button"
        className="telegram-chat-row"
        onClick={() => {
          if (suppressNextClick.current) {
            suppressNextClick.current = false;
            return;
          }
          if (actionsOpen) setActionsOpen(false);
          else onOpen();
        }}
        onPointerDown={() => {
          holdTimer.current = window.setTimeout(() => {
            suppressNextClick.current = true;
            setActionsOpen(true);
            dragging.current = chat.pinned_order != null;
          }, 450);
        }}
        onPointerMove={(event) => {
          if (!dragging.current || !onReorderOver) return;
          const target = document
            .elementFromPoint(event.clientX, event.clientY)
            ?.closest<HTMLElement>('[data-chat-row-id]');
          const targetId = target?.dataset.chatRowId;
          if (targetId && targetId !== chat.id) onReorderOver(targetId);
        }}
        onPointerUp={() => {
          if (holdTimer.current) window.clearTimeout(holdTimer.current);
          if (dragging.current) onReorderCommit?.();
          dragging.current = false;
        }}
        onPointerCancel={() => {
          if (holdTimer.current) window.clearTimeout(holdTimer.current);
          dragging.current = false;
        }}
      >
        <span className="chat-avatar-slot">
          {chat.pinned_order != null ? <Pin className="chat-pin-badge" aria-hidden /> : null}
          <ProfileAvatar
            mediaId={chat.avatar_media_id}
            renderMode={chat.avatar_render_mode}
            name={chat.display_name ?? chat.anonymous_alias}
          />
        </span>
        <span className="telegram-chat-copy">
          <strong>
            {chat.display_name ?? chat.anonymous_alias}
            <VerificationBadge kind={chat.verification_kind} premium={chat.has_premium} />
          </strong>
          <span className={chat.draft_text?.trim() ? 'chat-draft-preview' : undefined}>
            {chat.draft_text?.trim() ? (
              <b>{ru.miniApp.community.draftPrefix} </b>
            ) : chat.last_sender_user_id && ownUserId === chat.last_sender_user_id ? (
              <b className="chat-preview-own-prefix">{ru.miniApp.community.youPrefix} </b>
            ) : null}
            {preview}
          </span>
        </span>
        <span className="telegram-chat-meta">
          {chat.is_online ? (
            <span className="activity-dot" aria-label={ru.miniApp.community.chatOnline} />
          ) : (
            <small className="chat-list-presence">
              {conversationPresence(chat, viewerTime.relative)}
            </small>
          )}
          {chat.unread_count ? (
            <span className="chat-unread-badge" aria-label={ru.miniApp.community.unreadCount}>
              {chat.unread_count > 99 ? '99+' : chat.unread_count}
            </span>
          ) : null}
        </span>
      </button>
      {actionsOpen ? (
        <button
          type="button"
          className="chat-row-actions-backdrop"
          aria-label={ru.miniApp.community.closePreview}
          onClick={() => setActionsOpen(false)}
        />
      ) : null}
      {actionsOpen ? (
        <div className="chat-row-quick-actions" role="menu">
          <div className="chat-hold-preview">
            <strong>{chat.display_name ?? chat.anonymous_alias}</strong>
            {previewMessages.isLoading ? <Skeleton className="h-20" /> : null}
            {previewMessages.data?.slice(-6).map((message) => (
              <p className={message.is_own ? 'is-own' : ''} key={message.id}>
                {message.is_own ? `${ru.miniApp.community.youPrefix} ` : ''}
                {chatMessageDisplayText(message)}
              </p>
            ))}
          </div>
          <button type="button" onClick={onPin}>
            <Pin aria-hidden />
            {chat.pinned_order == null
              ? ru.miniApp.community.pinChat
              : ru.miniApp.community.unpinChat}
          </button>
          <button type="button" onClick={onArchive}>
            <Archive aria-hidden />
            {chat.archived_at ? ru.miniApp.community.restoreChat : ru.miniApp.community.archiveChat}
          </button>
          {onDelete ? (
            <button type="button" className="danger" onClick={onDelete}>
              <Trash2 aria-hidden /> {ru.miniApp.community.deleteChat}
            </button>
          ) : null}
          {onBlock ? (
            <button type="button" className="danger" onClick={onBlock}>
              <Ban aria-hidden /> {ru.miniApp.community.block}
            </button>
          ) : null}
        </div>
      ) : null}
    </div>
  );
}

function conversationListPreview(chat: Conversation): string {
  if (chat.draft_text?.trim()) return chat.draft_text.trim();
  if (chat.last_message_text) {
    const shared = parseSharedEntity(chat.last_message_text);
    const telegramProfile = parseTelegramProfileShare(chat.last_message_text);
    return shared
      ? shared.entityType === 'post'
        ? ru.miniApp.community.sharedPostMessage
        : ru.miniApp.community.sharedQuestionnaireMessage
      : telegramProfile || chat.last_message_type === 'profile'
        ? ru.miniApp.community.sharedProfileMessage
        : chat.last_message_text;
  }
  if (
    chat.last_message_type === 'audio' &&
    chat.last_media_group_id &&
    Number(chat.last_media_group_size ?? 0) > 1
  ) {
    return chat.last_playlist_title
      ? `${ru.miniApp.community.playlist}: ${chat.last_playlist_title}`
      : ru.miniApp.community.playlist;
  }
  if (chat.last_message_type === 'photo') return ru.miniApp.community.photoMessage;
  if (chat.last_message_type === 'video') return ru.miniApp.community.videoMessage;
  if (chat.last_message_type === 'animation') return ru.miniApp.community.animationMessage;
  if (chat.last_message_type === 'audio') return ru.miniApp.community.audioMessage;
  if (chat.last_message_type === 'voice') return ru.miniApp.community.voiceMessage;
  if (chat.last_message_type === 'post') return ru.miniApp.community.sharedPostMessage;
  if (chat.last_message_type) return ru.miniApp.community.documentMessage;
  return ru.miniApp.community.continueInBot;
}

function chatPinnedPreview(message: PinnedConversationMessage): string {
  if (message.message_type === 'photo') return ru.miniApp.community.photoMessage;
  if (message.message_type === 'video') return ru.miniApp.community.videoMessage;
  if (message.message_type === 'animation') return ru.miniApp.community.animationMessage;
  if (message.message_type === 'audio') return ru.miniApp.community.audioMessage;
  if (message.message_type === 'voice') return ru.miniApp.community.voiceMessage;
  return ru.miniApp.community.documentMessage;
}

function settingsInputFrom(current: UserSettings): SettingsInput {
  return {
    notificationsEnabled: Boolean(current.notifications_enabled),
    telegramNotificationsEnabled: Boolean(current.telegram_notifications_enabled),
    matchNotificationsEnabled: Boolean(current.match_notifications_enabled),
    messageNotificationsEnabled: Boolean(current.message_notifications_enabled),
    mentionNotificationsEnabled: Boolean(current.mention_notifications_enabled),
    commentNotificationsEnabled: Boolean(current.comment_notifications_enabled),
    referralNotificationsEnabled: Boolean(current.referral_notifications_enabled),
    premiumNotificationsEnabled: Boolean(current.premium_notifications_enabled),
    followerPostNotificationsEnabled: Boolean(current.follower_post_notifications_enabled),
    followerQuestionnaireNotificationsEnabled: Boolean(
      current.follower_questionnaire_notifications_enabled,
    ),
    privacyShieldEnabled: Boolean(current.privacy_shield_enabled),
    showOnlineStatus: Boolean(current.show_online_status),
    showPremiumBadge: Boolean(current.show_premium_badge),
    hideDemographics: Boolean(current.hide_demographics),
    chatArchiveVisible: Boolean(current.chat_archive_visible),
    autoArchiveNewChats: Boolean(current.auto_archive_new_chats),
    hideForwardAuthor: Boolean(current.hide_forward_author),
    quickReaction: current.quick_reaction,
    theme: current.theme,
  };
}

function conversationPresence(
  chat: Conversation,
  relative: (value: string | Date) => string,
): string {
  if (chat.is_online) return ru.miniApp.community.chatOnline;
  if (!chat.presence_last_seen_at) return ru.miniApp.community.chatRecently;
  const value = relative(chat.presence_last_seen_at);
  return value === '—'
    ? ru.miniApp.community.chatRecently
    : ru.miniApp.community.chatLastSeen(value);
}

function conversationLiveActivity(
  activity: 'typing' | 'recording_voice' | 'sending_media' | null | undefined,
): string | null {
  if (activity === 'typing') return ru.miniApp.community.chatTyping;
  if (activity === 'recording_voice') return ru.miniApp.community.chatRecordingVoice;
  if (activity === 'sending_media') return ru.miniApp.community.chatSendingMedia;
  return null;
}

function chatReaction(value: string | undefined): ChatReaction {
  return value && value.trim().length <= 16 ? value : 'heart';
}

async function chatFileBase64(file: File): Promise<string> {
  const bytes = new Uint8Array(await file.arrayBuffer());
  let binary = '';
  for (let index = 0; index < bytes.length; index += 32_768) {
    binary += String.fromCharCode(...bytes.subarray(index, index + 32_768));
  }
  return btoa(binary);
}

function reorderPinnedRows(
  conversations: Conversation[],
  sourceId: string,
  targetId: string,
): Conversation[] {
  const pinned = conversations.filter((item) => item.pinned_order != null);
  const sourceIndex = pinned.findIndex((item) => item.id === sourceId);
  const targetIndex = pinned.findIndex((item) => item.id === targetId);
  if (sourceIndex < 0 || targetIndex < 0 || sourceIndex === targetIndex) return conversations;
  const reordered = [...pinned];
  const [source] = reordered.splice(sourceIndex, 1);
  if (!source) return conversations;
  reordered.splice(targetIndex, 0, source);
  const pinnedIds = new Map(reordered.map((item, index) => [item.id, index]));
  return [...conversations]
    .map((item) =>
      pinnedIds.has(item.id) ? { ...item, pinned_order: pinnedIds.get(item.id) ?? null } : item,
    )
    .sort((left, right) => {
      if (left.pinned_order == null) return right.pinned_order == null ? 0 : 1;
      if (right.pinned_order == null) return -1;
      return left.pinned_order - right.pinned_order;
    });
}

function chatMessagePreview(message: ConversationMessage): string {
  if (message.message_type === 'profile' || parseTelegramProfileShare(message.text_content)) {
    return ru.miniApp.community.sharedProfileMessage;
  }
  if (message.message_type === 'photo') return ru.miniApp.community.photoMessage;
  if (message.message_type === 'video') return ru.miniApp.community.videoMessage;
  if (message.message_type === 'animation') return ru.miniApp.community.animationMessage;
  if (message.message_type === 'audio') return ru.miniApp.community.audioMessage;
  if (message.message_type === 'voice') return ru.miniApp.community.voiceMessage;
  return message.file_name || ru.miniApp.community.documentMessage;
}

function chatMessageDisplayText(message: ConversationMessage): string {
  if (message.message_type === 'profile' || parseTelegramProfileShare(message.text_content)) {
    return ru.miniApp.community.sharedProfileMessage;
  }
  return message.text_content || chatMessagePreview(message);
}

/**
 * Telegram shows one pinned message at a time — the one governing the part of the
 * chat you are looking at — with a tick per pin and a manage sheet behind the menu
 * button. The old strip listed every pin side by side and its single close button
 * unpinned whichever happened to be first.
 */
function ChatPinnedBar({
  pins,
  activeIndex,
  onJump,
  onUnpin,
  unpinning,
}: {
  pins: PinnedConversationMessage[];
  activeIndex: number;
  onJump: (pin: PinnedConversationMessage, index: number) => void;
  onUnpin: (pin: PinnedConversationMessage) => void;
  unpinning: boolean;
}) {
  const [manageOpen, setManageOpen] = useState(false);
  const index = Math.min(Math.max(activeIndex, 0), pins.length - 1);
  const active = pins[index];
  if (!active) return null;
  const preview = active.text_content || active.file_name || chatPinnedPreview(active);
  return (
    <div className="chat-pinned-strip" aria-label={ru.miniApp.community.pinnedMessages}>
      {pins.length > 1 ? (
        <span className="chat-pinned-ticks" aria-hidden>
          {pins.map((pin, tickIndex) => (
            <i key={pin.id} className={tickIndex === index ? 'is-active' : ''} />
          ))}
        </span>
      ) : (
        <Pin className="chat-pinned-icon" aria-hidden />
      )}
      <button
        type="button"
        className="chat-pinned-active"
        onClick={() => onJump(pins[(index + 1) % pins.length]!, (index + 1) % pins.length)}
      >
        <strong>
          {pins.length > 1
            ? ru.miniApp.community.pinnedNumbered(index + 1, pins.length)
            : ru.miniApp.community.pinnedMessage}
        </strong>
        <small>{preview}</small>
      </button>
      <button
        type="button"
        className="chat-pinned-manage"
        aria-label={ru.miniApp.community.managePins}
        title={ru.miniApp.community.managePins}
        onClick={() => setManageOpen(true)}
      >
        <MoreVertical aria-hidden />
      </button>
      {manageOpen ? (
        <div className="confirm-dialog-backdrop" role="presentation">
          <Card
            className="confirm-dialog chat-pinned-manage-dialog"
            role="dialog"
            aria-modal="true"
          >
            <header>
              <h2>{ru.miniApp.community.managePins}</h2>
              <button
                type="button"
                aria-label={ru.miniApp.community.closePreview}
                onClick={() => setManageOpen(false)}
              >
                <X aria-hidden />
              </button>
            </header>
            <ul className="chat-pinned-manage-list">
              {pins.map((pin, pinIndex) => (
                <li key={pin.id}>
                  <button
                    type="button"
                    onClick={() => {
                      setManageOpen(false);
                      onJump(pin, pinIndex);
                    }}
                  >
                    <strong>{pin.sender_name}</strong>
                    <small>{pin.text_content || pin.file_name || chatPinnedPreview(pin)}</small>
                  </button>
                  <button
                    type="button"
                    className="chat-pinned-manage-unpin"
                    disabled={unpinning}
                    aria-label={ru.miniApp.community.unpinMessage}
                    onClick={() => onUnpin(pin)}
                  >
                    <X aria-hidden />
                  </button>
                </li>
              ))}
            </ul>
          </Card>
        </div>
      ) : null}
    </div>
  );
}

/**
 * Reacting to a message was implemented three times over — in the message row, in
 * the action sheet and in the media viewer — with the same call and the same
 * invalidation each time.
 */
function useMessageReaction(conversationId: string, messageId: string, onDone?: () => void) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (reaction: ChatReaction) =>
      api.reactConversationMessage(conversationId, messageId, reaction),
    onSuccess: () => {
      onDone?.();
      void queryClient.invalidateQueries({ queryKey: ['conversation-messages', conversationId] });
    },
  });
}

function pickRandom<T>(values: readonly T[], exclude?: T): T {
  const pool = exclude === undefined ? values : values.filter((value) => value !== exclude);
  const source = pool.length ? pool : values;
  return source[Math.floor(Math.random() * source.length)]!;
}

/**
 * A fresh match stalls because both sides wait for the other to write first, so an
 * empty chat offers three ready openings instead of an empty history line.
 */
function ChatIcebreakers({
  conversationId,
  name,
  onPick,
  sending,
  failed,
}: {
  conversationId: string;
  name: string;
  onPick: (message: string) => void;
  sending: boolean;
  failed: boolean;
}) {
  const copy = ru.miniApp.icebreakers;
  const context = useQuery({
    queryKey: ['icebreaker', conversationId],
    queryFn: () => api.conversationIcebreaker(conversationId),
    staleTime: 60_000,
  });
  const [scene, setScene] = useState(() => pickRandom(copy.scenes));
  const [question, setQuestion] = useState(() => pickRandom(copy.questions));
  const [hooksOpen, setHooksOpen] = useState(false);
  return (
    <div className="chat-icebreakers">
      <strong>{copy.title}</strong>
      <p>
        {copy.invitation(name, context.data?.sharedInterests ?? 0, Boolean(context.data?.isOnline))}
      </p>

      <div className="chat-icebreaker-card">
        <span>{scene}</span>
        <div className="chat-icebreaker-actions">
          <button type="button" disabled={sending} onClick={() => onPick(scene)}>
            {copy.randomScene}
          </button>
          <button
            type="button"
            className="is-ghost"
            onClick={() => setScene((current) => pickRandom(copy.scenes, current))}
          >
            {copy.another}
          </button>
        </div>
      </div>

      <div className="chat-icebreaker-card">
        <span>{question}</span>
        <div className="chat-icebreaker-actions">
          <button type="button" disabled={sending} onClick={() => onPick(question)}>
            {copy.askCharacter}
          </button>
          <button
            type="button"
            className="is-ghost"
            onClick={() => setQuestion((current) => pickRandom(copy.questions, current))}
          >
            {copy.another}
          </button>
        </div>
      </div>

      <div className="chat-icebreaker-card">
        <button
          type="button"
          className="chat-icebreaker-expand"
          aria-expanded={hooksOpen}
          onClick={() => setHooksOpen((open) => !open)}
        >
          {copy.pickHook}
        </button>
        {hooksOpen ? (
          <>
            <small>{copy.pickHookHint}</small>
            <div className="chat-icebreaker-hooks">
              {copy.hooks.map((hook) => (
                <button key={hook} type="button" disabled={sending} onClick={() => onPick(hook)}>
                  {hook}
                </button>
              ))}
            </div>
          </>
        ) : null}
      </div>

      {failed ? <p className="chat-icebreaker-error">{copy.sendFailed}</p> : null}
    </div>
  );
}

function ConversationView({
  chat,
  premium,
  onBack,
}: {
  chat: Conversation;
  premium: boolean;
  onBack: () => void;
}) {
  const viewerTime = useViewerTime();
  const queryClient = useQueryClient();
  const [, navigate] = useLocation();
  const [menuOpen, setMenuOpen] = useState(false);
  const [selectionMode, setSelectionMode] = useState(false);
  const [selectedMessages, setSelectedMessages] = useState<string[]>([]);
  const [confirmation, setConfirmation] = useState<'chat' | 'messages' | null>(null);
  const [pendingText, setPendingText] = useState<string | null>(null);
  const [replyTarget, setReplyTarget] = useState<ConversationMessage | null>(null);
  const [actionMessage, setActionMessage] = useState<ConversationMessage | null>(null);
  const [forwardOpen, setForwardOpen] = useState(false);
  const [goodbyeOpen, setGoodbyeOpen] = useState(false);
  // Ending a chat is a two-step courtesy: the note goes out over the ordinary
  // message path, then the conversation is closed and archived for both sides.
  const endGently = useMutation({
    mutationFn: async () => {
      await api
        .sendConversationMessage(chat.id, ru.miniApp.community.gentleGoodbyeMessage)
        .catch(() => undefined);
      return api.endConversation(chat.id);
    },
    onSuccess: () => {
      setGoodbyeOpen(false);
      void queryClient.invalidateQueries({ queryKey: ['conversations'] });
      onBack();
    },
  });
  const sendIcebreaker = useMutation({
    mutationFn: (message: string) => api.sendConversationMessage(chat.id, message),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ['conversation-messages', chat.id] });
      void queryClient.invalidateQueries({ queryKey: ['conversations'] });
    },
  });
  const [editMessageId, setEditMessageId] = useState<string | null>(null);
  const [pinCandidate, setPinCandidate] = useState<ConversationMessage | null>(null);
  const [pinForParticipant, setPinForParticipant] = useState(false);
  const [highlightedMessageId, setHighlightedMessageId] = useState<string | null>(null);
  const highlightTimerRef = useRef<number | null>(null);
  const messagesListRef = useRef<HTMLDivElement>(null);
  const messageGestureRef = useRef<{
    timer: number;
    messageId: string;
    x: number;
    y: number;
    replied: boolean;
    row: HTMLDivElement;
  } | null>(null);
  const messages = useQuery({
    queryKey: ['conversation-messages', chat.id],
    queryFn: () => api.conversationMessages(chat.id),
    refetchInterval: 4_000,
  });
  const pinnedMessages = useQuery({
    queryKey: ['conversation-message-pins', chat.id],
    queryFn: () => api.pinnedConversationMessages(chat.id),
    // Pins change rarely and our own changes invalidate immediately, so an
    // eight-second poll was spending reads for nothing.
    refetchInterval: 60_000,
  });
  const livePresence = useQuery({
    queryKey: ['conversation-presence', chat.id],
    queryFn: () => api.conversationPresence(chat.id),
    // The typing flag lives for five seconds, so polling faster than this spent
    // D1 reads without showing anything sooner.
    refetchInterval: 2_500,
    refetchIntervalInBackground: false,
  });
  // Which pin the bar shows follows the scroll position: the last pinned message
  // that has already scrolled past the top of the list is the one in force.
  const [activePinIndex, setActivePinIndex] = useState(0);
  const pinIds = pinnedMessages.data?.map((pin) => pin.id).join(',') ?? '';
  useEffect(() => {
    const list = messagesListRef.current;
    const ids = pinIds ? pinIds.split(',') : [];
    if (!list || ids.length < 2) return;
    const update = () => {
      const top = list.getBoundingClientRect().top;
      let next = 0;
      ids.forEach((id, index) => {
        const row = list.querySelector<HTMLElement>(`[data-message-id="${id}"]`);
        if (row && row.getBoundingClientRect().top <= top + 8) next = index;
      });
      setActivePinIndex(next);
    };
    update();
    list.addEventListener('scroll', update, { passive: true });
    return () => list.removeEventListener('scroll', update);
  }, [pinIds]);
  const block = useMutation({
    mutationFn: (userId: string) => api.block(userId),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ['conversations'] });
      onBack();
    },
  });
  const report = useMutation({ mutationFn: api.report });
  const control = useMutation({
    mutationFn: (input: {
      conversationId: string;
      action: 'mute' | 'unmute' | 'pause' | 'resume' | 'close';
    }) => api.controlConversation(input.conversationId, input.action),
    onSuccess: () => void queryClient.invalidateQueries({ queryKey: ['conversations'] }),
  });
  const rate = useMutation({
    mutationFn: ({ id, value }: { id: string; value: -1 | 1 }) => api.rateConversation(id, value),
    onSuccess: () => void queryClient.invalidateQueries({ queryKey: ['conversations'] }),
  });
  const deleteMessages = useMutation({
    mutationFn: () => api.deleteConversationMessages(chat.id, selectedMessages),
    onSuccess: () => {
      setSelectedMessages([]);
      setSelectionMode(false);
      setConfirmation(null);
      void queryClient.invalidateQueries({ queryKey: ['conversation-messages', chat.id] });
      // Deleting the newest message leaves a stale preview in the chat list.
      void queryClient.invalidateQueries({ queryKey: ['conversations'] });
    },
  });
  const deleteChat = useMutation({
    mutationFn: () => api.deleteConversation(chat.id),
    onSuccess: () => {
      setConfirmation(null);
      void queryClient.invalidateQueries({ queryKey: ['conversations'] });
      onBack();
    },
  });
  const reactMessage = useMutation({
    mutationFn: ({ messageId, reaction }: { messageId: string; reaction: ChatReaction }) =>
      api.reactConversationMessage(chat.id, messageId, reaction),
    onSuccess: () => {
      setActionMessage(null);
      void queryClient.invalidateQueries({ queryKey: ['conversation-messages', chat.id] });
    },
  });
  const forwardMessages = useMutation({
    mutationFn: (conversationIds: string[]) =>
      api.forwardConversationMessages(chat.id, selectedMessages, conversationIds),
    onSuccess: () => {
      setForwardOpen(false);
      setSelectedMessages([]);
      setSelectionMode(false);
      void queryClient.invalidateQueries({ queryKey: ['conversations'] });
    },
  });
  const pinMessage = useMutation({
    mutationFn: ({
      messageId,
      pinned,
      shared,
    }: {
      messageId: string;
      pinned: boolean;
      shared: boolean;
    }) => api.pinConversationMessage(chat.id, messageId, pinned, shared),
    onSuccess: () => {
      setPinCandidate(null);
      setPinForParticipant(false);
      setActionMessage(null);
      void queryClient.invalidateQueries({ queryKey: ['conversation-message-pins', chat.id] });
      void queryClient.invalidateQueries({ queryKey: ['conversation-messages', chat.id] });
    },
  });

  const scrollToMessage = useCallback(
    async (messageId: string) => {
      let element = messagesListRef.current?.querySelector<HTMLElement>(
        `[data-message-id="${CSS.escape(messageId)}"]`,
      );
      if (!element) {
        try {
          const fetched = await api.conversationMessage(chat.id, messageId);
          queryClient.setQueryData<ConversationMessage[]>(
            ['conversation-messages', chat.id],
            (current = []) =>
              current.some((item) => item.id === fetched.id)
                ? current
                : [...current, fetched].sort(
                    (left, right) =>
                      new Date(left.created_at).getTime() - new Date(right.created_at).getTime(),
                  ),
          );
          await new Promise<void>((resolve) => window.requestAnimationFrame(() => resolve()));
          element = messagesListRef.current?.querySelector<HTMLElement>(
            `[data-message-id="${CSS.escape(messageId)}"]`,
          );
        } catch {
          return;
        }
      }
      element?.scrollIntoView({ behavior: 'smooth', block: 'center' });
      setHighlightedMessageId(messageId);
      if (highlightTimerRef.current !== null) window.clearTimeout(highlightTimerRef.current);
      highlightTimerRef.current = window.setTimeout(() => setHighlightedMessageId(null), 2_000);
    },
    [chat.id, queryClient],
  );

  useEffect(() => {
    const list = messagesListRef.current;
    if (list) list.scrollTo({ top: list.scrollHeight, behavior: 'auto' });
  }, [messages.data?.length]);
  useEffect(() => {
    const listener = (event: Event) => {
      const messageId = (event as CustomEvent<string>).detail;
      if (messageId) void scrollToMessage(messageId);
    };
    window.addEventListener('rolemate:scroll-message', listener);
    return () => {
      window.removeEventListener('rolemate:scroll-message', listener);
      if (highlightTimerRef.current !== null) window.clearTimeout(highlightTimerRef.current);
    };
  }, [scrollToMessage]);

  const ratingProtected =
    chat.verification_kind === 'owner' || chat.verification_kind === 'moderator';
  const invalidateMessages = () =>
    void queryClient.invalidateQueries({ queryKey: ['conversation-messages', chat.id] });
  const messageGroups = groupConversationMessages(messages.data ?? []);
  const liveActivity = conversationLiveActivity(livePresence.data?.activity);

  return (
    <div className="telegram-conversation">
      <header className="telegram-conversation-header">
        <button
          type="button"
          className="chat-icon-button"
          onClick={onBack}
          aria-label={ru.miniApp.community.back}
        >
          <ChevronLeft />
        </button>
        <Link className="telegram-partner" href={`/profiles/${chat.other_user_id}`}>
          <ProfileAvatar
            mediaId={chat.avatar_media_id}
            renderMode={chat.avatar_render_mode}
            name={chat.display_name ?? chat.anonymous_alias}
          />
          <span>
            <strong>
              {chat.display_name ?? chat.anonymous_alias}
              <VerificationBadge kind={chat.verification_kind} premium={chat.has_premium} />
            </strong>
            <small className={liveActivity || chat.is_online ? 'is-online' : ''}>
              {liveActivity ?? conversationPresence(chat, viewerTime.relative)}
            </small>
          </span>
        </Link>
        <button
          type="button"
          className="chat-icon-button"
          aria-label={ru.miniApp.community.chatMenu}
          onClick={() => setMenuOpen((value) => !value)}
        >
          <MoreVertical />
        </button>
        {menuOpen ? (
          <>
            <button
              type="button"
              className="chat-menu-backdrop"
              aria-label={ru.miniApp.community.cancelAction}
              onClick={() => setMenuOpen(false)}
            />
            <Card className="chat-service-menu">
              <button
                type="button"
                aria-label={ru.miniApp.community.openPartnerProfile}
                title={ru.miniApp.community.openPartnerProfile}
                onClick={() => navigate(`/profiles/${chat.other_user_id}`)}
              >
                <ExternalLink /> <span>{ru.miniApp.community.openPartnerProfile}</span>
              </button>
              <button
                type="button"
                aria-label={ru.miniApp.community.selectMessages}
                title={ru.miniApp.community.selectMessages}
                onClick={() => {
                  setSelectionMode(true);
                  setMenuOpen(false);
                }}
              >
                <CheckSquare /> <span>{ru.miniApp.community.selectMessages}</span>
              </button>
              <button
                type="button"
                aria-label={chat.is_muted ? ru.miniApp.community.unmute : ru.miniApp.community.mute}
                title={chat.is_muted ? ru.miniApp.community.unmute : ru.miniApp.community.mute}
                onClick={() => {
                  control.mutate({
                    conversationId: chat.id,
                    action: chat.is_muted ? 'unmute' : 'mute',
                  });
                  setMenuOpen(false);
                }}
              >
                <BellOff />{' '}
                <span>
                  {chat.is_muted ? ru.miniApp.community.unmute : ru.miniApp.community.mute}
                </span>
              </button>
              {chat.status !== 'closed' ? (
                <button
                  type="button"
                  aria-label={
                    chat.status === 'paused'
                      ? ru.miniApp.community.resumeChat
                      : ru.miniApp.community.pauseChat
                  }
                  title={
                    chat.status === 'paused'
                      ? ru.miniApp.community.resumeChat
                      : ru.miniApp.community.pauseChat
                  }
                  onClick={() => {
                    control.mutate({
                      conversationId: chat.id,
                      action: chat.status === 'paused' ? 'resume' : 'pause',
                    });
                    setMenuOpen(false);
                  }}
                >
                  <PauseCircle />{' '}
                  <span>
                    {chat.status === 'paused'
                      ? ru.miniApp.community.resumeChat
                      : ru.miniApp.community.pauseChat}
                  </span>
                </button>
              ) : null}
              <button
                type="button"
                aria-label={ru.miniApp.community.report}
                title={ru.miniApp.community.report}
                onClick={() => {
                  const description = window.prompt(ru.miniApp.community.reportPrompt) ?? '';
                  if (description) {
                    report.mutate({
                      reportedUserId: chat.other_user_id,
                      conversationId: chat.id,
                      category: 'other',
                      description,
                    });
                  }
                  setMenuOpen(false);
                }}
              >
                <AlertTriangle /> <span>{ru.miniApp.community.report}</span>
              </button>
              <button
                type="button"
                aria-label={ru.miniApp.community.gentleGoodbyeTitle}
                title={ru.miniApp.community.gentleGoodbyeTitle}
                onClick={() => {
                  setMenuOpen(false);
                  setGoodbyeOpen(true);
                }}
              >
                <HeartHandshake /> <span>{ru.miniApp.community.gentleGoodbyeTitle}</span>
              </button>
              <button
                type="button"
                aria-label={ru.miniApp.community.block}
                title={ru.miniApp.community.block}
                onClick={() => {
                  if (window.confirm(ru.miniApp.community.blockConfirm)) {
                    block.mutate(chat.other_user_id);
                  }
                  setMenuOpen(false);
                }}
              >
                <Ban /> <span>{ru.miniApp.community.block}</span>
              </button>
              <button
                type="button"
                className="danger"
                aria-label={ru.miniApp.community.deleteChat}
                title={ru.miniApp.community.deleteChat}
                onClick={() => {
                  setConfirmation('chat');
                  setMenuOpen(false);
                }}
              >
                <Trash2 /> <span>{ru.miniApp.community.deleteChat}</span>
              </button>
            </Card>
          </>
        ) : null}
      </header>

      {selectionMode ? (
        <div className="chat-selection-toolbar">
          <span>
            <strong>{ru.miniApp.community.selectedMessages(selectedMessages.length)}</strong>
            <small>{ru.miniApp.community.selectionHint}</small>
          </span>
          <button
            type="button"
            disabled={!selectedMessages.length}
            onClick={() => setForwardOpen(true)}
            aria-label={ru.miniApp.community.forwardSelected}
          >
            <Forward />
          </button>
          <button
            type="button"
            disabled={!selectedMessages.length}
            onClick={() => setConfirmation('messages')}
            aria-label={ru.miniApp.community.deleteSelected}
          >
            <Trash2 />
          </button>
          <button
            type="button"
            onClick={() => {
              setSelectionMode(false);
              setSelectedMessages([]);
            }}
            aria-label={ru.miniApp.community.cancelSelection}
          >
            <X />
          </button>
        </div>
      ) : (
        <div className="chat-rating-bar">
          {ratingProtected ? (
            <span>{ru.miniApp.community.protectedRating}</span>
          ) : (
            <>
              <button
                type="button"
                className={chat.own_rating === 1 ? 'is-active' : ''}
                aria-label={ru.miniApp.community.ratePositive}
                title={ru.miniApp.community.ratePositive}
                onClick={() => rate.mutate({ id: chat.id, value: 1 })}
              >
                <ThumbsUp />
              </button>
              <button
                type="button"
                className={chat.own_rating === -1 ? 'is-active is-negative' : ''}
                aria-label={ru.miniApp.community.rateNegative}
                title={ru.miniApp.community.rateNegative}
                onClick={() => rate.mutate({ id: chat.id, value: -1 })}
              >
                <ThumbsDown />
              </button>
            </>
          )}
        </div>
      )}

      {pinnedMessages.data?.length ? (
        <ChatPinnedBar
          pins={pinnedMessages.data}
          activeIndex={activePinIndex}
          onJump={(pin, index) => {
            setActivePinIndex(index);
            void scrollToMessage(pin.id);
          }}
          onUnpin={(pin) => pinMessage.mutate({ messageId: pin.id, pinned: false, shared: false })}
          unpinning={pinMessage.isPending}
        />
      ) : null}

      <div ref={messagesListRef} className="telegram-message-list" aria-live="polite">
        {messages.isLoading ? <Skeleton className="h-48" /> : null}
        {!messages.isLoading && !messages.data?.length ? (
          <ChatIcebreakers
            conversationId={chat.id}
            name={chat.display_name ?? chat.anonymous_alias}
            onPick={(message) => sendIcebreaker.mutate(message)}
            sending={sendIcebreaker.isPending}
            failed={sendIcebreaker.isError}
          />
        ) : null}
        {messageGroups.map((group) => {
          const message = group[0]!;
          const selected = selectedMessages.includes(message.id);
          const selectable = selectionMode;
          // Telegram's "unread from here" line. The server resolves it before it
          // marks the chat read, otherwise it could never be shown.
          const unreadDivider = group.some((item) => item.is_first_unread) ? (
            <div className="chat-unread-divider" key={`${message.id}-unread`}>
              <span>{ru.miniApp.community.unreadDivider}</span>
            </div>
          ) : null;
          return (
            <Fragment key={`${message.id}-block`}>
              {unreadDivider}
              <div
                key={message.id}
                data-message-id={message.id}
                className={`telegram-message-row ${message.is_own ? 'is-own' : ''} ${
                  selected ? 'is-selected' : ''
                } ${highlightedMessageId === message.id ? 'is-highlighted' : ''}`}
                onClick={
                  selectable
                    ? () =>
                        setSelectedMessages((current) =>
                          current.includes(message.id)
                            ? current.filter((id) => id !== message.id)
                            : [...current, message.id],
                        )
                    : undefined
                }
                onContextMenu={(event) => {
                  if (selectionMode) return;
                  event.preventDefault();
                  setActionMessage(message);
                }}
                onPointerDown={(event) => {
                  const target = event.target as HTMLElement;
                  if (
                    selectionMode ||
                    target.closest('a,audio,input,textarea,select') ||
                    (target.closest('button') && !target.closest('.chat-media-stage'))
                  )
                    return;
                  const timer = window.setTimeout(() => setActionMessage(message), 480);
                  messageGestureRef.current = {
                    timer,
                    messageId: message.id,
                    x: event.clientX,
                    y: event.clientY,
                    replied: false,
                    row: event.currentTarget,
                  };
                }}
                onPointerMove={(event) => {
                  const gesture = messageGestureRef.current;
                  if (!gesture || gesture.messageId !== message.id || gesture.replied) return;
                  const deltaX = event.clientX - gesture.x;
                  const deltaY = event.clientY - gesture.y;
                  if (Math.abs(deltaX) > 10 || Math.abs(deltaY) > 10) {
                    window.clearTimeout(gesture.timer);
                  }
                  const replyDistance = message.is_own ? -deltaX : deltaX;
                  if (replyDistance > 0 && Math.abs(deltaX) > Math.abs(deltaY) * 1.15) {
                    if (!event.currentTarget.hasPointerCapture(event.pointerId)) {
                      try {
                        event.currentTarget.setPointerCapture(event.pointerId);
                      } catch {
                        // Synthetic test events can lack an active pointer; real gestures are captured.
                      }
                    }
                    const offset = Math.min(72, replyDistance * 0.72);
                    gesture.row.style.setProperty(
                      '--chat-reply-swipe-offset',
                      `${message.is_own ? -offset : offset}px`,
                    );
                    gesture.row.classList.toggle('is-reply-ready', replyDistance >= 56);
                    gesture.replied = replyDistance >= 56;
                  } else {
                    gesture.row.style.removeProperty('--chat-reply-swipe-offset');
                    gesture.row.classList.remove('is-reply-ready');
                    gesture.replied = false;
                  }
                }}
                onPointerUp={(event) => {
                  const gesture = messageGestureRef.current;
                  if (gesture) {
                    window.clearTimeout(gesture.timer);
                    gesture.row.style.removeProperty('--chat-reply-swipe-offset');
                    gesture.row.classList.remove('is-reply-ready');
                    if (gesture.replied) {
                      gesture.row.dataset.replySwiped = 'true';
                      window.setTimeout(() => delete gesture.row.dataset.replySwiped, 280);
                      setReplyTarget(message);
                      event.preventDefault();
                      event.stopPropagation();
                    }
                  }
                  messageGestureRef.current = null;
                }}
                onPointerCancel={() => {
                  const gesture = messageGestureRef.current;
                  if (gesture) {
                    window.clearTimeout(gesture.timer);
                    gesture.row.style.removeProperty('--chat-reply-swipe-offset');
                    gesture.row.classList.remove('is-reply-ready');
                  }
                  messageGestureRef.current = null;
                }}
              >
                {!selectable ? (
                  <span className="chat-swipe-reply-indicator" aria-hidden>
                    <Reply />
                  </span>
                ) : null}
                {selectable ? (
                  <span className="chat-message-checkbox" aria-hidden>
                    {selected ? <Check /> : null}
                  </span>
                ) : null}
                <div className="telegram-message-stack">
                  {group.length > 1 && ['audio', 'voice'].includes(message.message_type) ? (
                    <ConversationAudioPlaylist conversationId={chat.id} messages={group} />
                  ) : group.length > 1 ||
                    (message.has_media &&
                      ['photo', 'animation', 'video'].includes(message.message_type)) ? (
                    <ConversationMediaCarousel conversationId={chat.id} messages={group} />
                  ) : (
                    <ConversationMessageContent
                      conversationId={chat.id}
                      message={message}
                      editingRequested={editMessageId === message.id}
                      onEditingHandled={() => setEditMessageId(null)}
                    />
                  )}
                </div>
              </div>
            </Fragment>
          );
        })}
        {pendingText ? (
          <div className="telegram-message-row is-own">
            <article className="telegram-message-bubble is-own is-pending">
              <ProfileMarkdown className="chat-message-markdown" allowLinks={false} dimEmphasis>
                {pendingText}
              </ProfileMarkdown>
              <time>
                {viewerTime.clock(new Date())}
                <span className="chat-receipt" aria-label={ru.miniApp.community.messageSent}>
                  ✓
                </span>
              </time>
            </article>
          </div>
        ) : null}
        <div />
      </div>
      {actionMessage ? (
        <>
          <button
            type="button"
            className="chat-message-action-backdrop"
            aria-label={ru.miniApp.community.cancelAction}
            onClick={() => setActionMessage(null)}
          />
          <div className="chat-message-action-menu" role="menu">
            <ChatReactionMenu
              onReact={(reaction) => reactMessage.mutate({ messageId: actionMessage.id, reaction })}
            />
            <div className="chat-message-action-buttons">
              <button
                type="button"
                onClick={() => {
                  setReplyTarget(actionMessage);
                  setActionMessage(null);
                }}
              >
                <Reply /> {ru.miniApp.community.replyMessage}
              </button>
              {actionMessage.is_own && actionMessage.message_type === 'text' ? (
                <button
                  type="button"
                  onClick={() => {
                    setEditMessageId(actionMessage.id);
                    setActionMessage(null);
                  }}
                >
                  <Pencil /> {ru.miniApp.community.editMessage}
                </button>
              ) : null}
              <button
                type="button"
                onClick={() => {
                  setSelectedMessages([actionMessage.id]);
                  setSelectionMode(true);
                  setActionMessage(null);
                }}
              >
                <CheckSquare /> {ru.miniApp.community.selectMessage}
              </button>
              <button
                type="button"
                onClick={() => {
                  setSelectedMessages([actionMessage.id]);
                  setForwardOpen(true);
                  setActionMessage(null);
                }}
              >
                <Forward /> {ru.miniApp.community.forwardMessage}
              </button>
              <button
                type="button"
                onClick={() => {
                  if (actionMessage.pinned_by_me) {
                    pinMessage.mutate({
                      messageId: actionMessage.id,
                      pinned: false,
                      shared: false,
                    });
                  } else {
                    setPinCandidate(actionMessage);
                    setActionMessage(null);
                  }
                }}
              >
                <Pin />
                {actionMessage.pinned_by_me
                  ? ru.miniApp.community.unpinMessage
                  : ru.miniApp.community.pinMessage}
              </button>
              <button
                type="button"
                className="danger"
                onClick={() => {
                  setSelectedMessages([actionMessage.id]);
                  setConfirmation('messages');
                  setActionMessage(null);
                }}
              >
                <Trash2 /> {ru.miniApp.community.deleteAction}
              </button>
            </div>
          </div>
        </>
      ) : null}
      {report.data ? (
        <p className="chat-inline-notice">
          {ru.miniApp.community.reportSent(report.data.reportId)}
        </p>
      ) : null}
      {chat.status === 'active' && !selectionMode ? (
        <ChatComposer
          conversationId={chat.id}
          premium={premium}
          onSending={setPendingText}
          onSettled={() => setPendingText(null)}
          onSent={invalidateMessages}
          replyTarget={replyTarget}
          onCancelReply={() => setReplyTarget(null)}
        />
      ) : null}
      <ConfirmDialog
        open={confirmation === 'chat'}
        title={ru.miniApp.community.deleteChatTitle}
        description={ru.miniApp.community.deleteChatDescription}
        confirmLabel={ru.miniApp.community.deleteAction}
        cancelLabel={ru.miniApp.community.cancelAction}
        loading={deleteChat.isPending}
        onConfirm={() => deleteChat.mutate()}
        onCancel={() => setConfirmation(null)}
      />
      <ConfirmDialog
        open={goodbyeOpen}
        title={ru.miniApp.community.gentleGoodbyeTitle}
        description={ru.miniApp.community.gentleGoodbyeHint}
        confirmLabel={ru.miniApp.community.gentleGoodbyeConfirm}
        cancelLabel={ru.miniApp.community.cancelAction}
        loading={endGently.isPending}
        onConfirm={() => endGently.mutate()}
        onCancel={() => setGoodbyeOpen(false)}
      />
      {pinCandidate ? (
        <div className="confirm-dialog-backdrop" role="presentation">
          <Card className="confirm-dialog chat-pin-dialog" role="dialog" aria-modal="true">
            <h2>{ru.miniApp.community.pinMessageTitle}</h2>
            <label>
              <input
                type="checkbox"
                checked={pinForParticipant}
                onChange={(event) => setPinForParticipant(event.target.checked)}
              />
              <span>
                {ru.miniApp.community.pinForParticipant(chat.display_name ?? chat.anonymous_alias)}
              </span>
            </label>
            <div className="confirm-dialog-actions">
              <Button
                loading={pinMessage.isPending}
                onClick={() =>
                  pinMessage.mutate({
                    messageId: pinCandidate.id,
                    pinned: true,
                    shared: pinForParticipant,
                  })
                }
              >
                {ru.miniApp.community.pinMessage}
              </Button>
              <Button variant="secondary" onClick={() => setPinCandidate(null)}>
                {ru.miniApp.community.cancelAction}
              </Button>
            </div>
          </Card>
        </div>
      ) : null}
      <ShareToChatsDialog
        open={forwardOpen}
        loading={forwardMessages.isPending}
        onClose={() => setForwardOpen(false)}
        onSend={(conversationIds) => forwardMessages.mutate(conversationIds)}
      />
      <ConfirmDialog
        open={confirmation === 'messages'}
        title={ru.miniApp.community.deleteMessagesTitle}
        description={ru.miniApp.community.deleteMessagesDescription(selectedMessages.length)}
        confirmLabel={ru.miniApp.community.deleteAction}
        cancelLabel={ru.miniApp.community.cancelAction}
        loading={deleteMessages.isPending}
        onConfirm={() => deleteMessages.mutate()}
        onCancel={() => setConfirmation(null)}
      />
    </div>
  );
}

function ConversationAudioPlaylist({
  conversationId,
  messages,
}: {
  conversationId: string;
  messages: ConversationMessage[];
}) {
  const viewerTime = useViewerTime();
  const queryClient = useQueryClient();
  const settings = useQuery({ queryKey: ['settings'], queryFn: api.settings });
  const [trackIds, setTrackIds] = useState<string[]>([]);
  const [reactionMenuOpen, setReactionMenuOpen] = useState(false);
  const lastTapRef = useRef(0);
  const primary = messages[0]!;
  const react = useMessageReaction(conversationId, primary.id, () => setReactionMenuOpen(false));
  const share = useMutation({
    mutationFn: (conversationIds: string[]) =>
      api.sharePlaylist({
        sourceType: 'chat',
        sourceId: messages[0]?.media_group_id ?? '',
        trackIds,
        conversationIds,
        title: messages[0]?.playlist_title ?? null,
      }),
    onSuccess: () => {
      setTrackIds([]);
      void queryClient.invalidateQueries({ queryKey: ['conversations'] });
    },
  });
  const tracks = messages.slice(0, 20).map<PlaylistTrack>((message) => ({
    id: message.id,
    src: `/api/conversations/${conversationId}/messages/${message.id}/media`,
    title: message.track_title || message.file_name || ru.miniApp.search.trackUnknown,
    performer: message.track_performer || ru.miniApp.search.trackPerformerUnknown,
    ...(message.has_thumbnail
      ? {
          coverSrc: `/api/conversations/${conversationId}/messages/${message.id}/thumbnail`,
        }
      : {}),
  }));
  return (
    <article
      className={`chat-playlist ${primary.is_own ? 'is-own' : ''}`}
      onPointerUp={(event) => {
        if (
          (event.target as HTMLElement).closest('.chat-reaction-menu,.chat-reaction-summary,input')
        )
          return;
        const now = Date.now();
        if (now - lastTapRef.current < 320) {
          react.mutate(chatReaction(settings.data?.quick_reaction));
          lastTapRef.current = 0;
          return;
        }
        lastTapRef.current = now;
      }}
    >
      <ConversationMessageContext message={primary} />
      {messages[0]?.playlist_title ? <strong>{messages[0].playlist_title}</strong> : null}
      {primary.text_content && primary.caption_position === 'top' ? (
        <ProfileMarkdown className="chat-media-caption is-top" allowLinks dimEmphasis>
          {primary.text_content}
        </ProfileMarkdown>
      ) : null}
      <SwipePlaylist
        tracks={tracks}
        limit={20}
        emptyLabel={ru.miniApp.search.trackUnknown}
        onShare={setTrackIds}
      />
      {primary.text_content && primary.caption_position !== 'top' ? (
        <ProfileMarkdown className="chat-media-caption is-bottom" allowLinks dimEmphasis>
          {primary.text_content}
        </ProfileMarkdown>
      ) : null}
      <button
        className="chat-playlist-reaction-toggle"
        type="button"
        onClick={() => setReactionMenuOpen((open) => !open)}
        aria-label={ru.miniApp.community.chooseReaction}
      >
        +
      </button>
      {reactionMenuOpen ? (
        <ChatReactionMenu
          onReact={(reaction) => react.mutate(reaction)}
          onClose={() => setReactionMenuOpen(false)}
        />
      ) : null}
      <div className="chat-playlist-footer">
        <ChatReactionSummary message={primary} onReact={(reaction) => react.mutate(reaction)} />
        <ConversationReplyCount message={primary} />
        <time className="chat-playlist-meta" dateTime={primary.created_at}>
          {viewerTime.clock(primary.created_at)}
          {primary.is_own ? (
            <span
              className={`chat-receipt ${primary.read_at ? 'is-read' : ''}`}
              aria-label={
                primary.read_at
                  ? ru.miniApp.community.messageRead
                  : primary.delivered_at
                    ? ru.miniApp.community.messageDelivered
                    : ru.miniApp.community.messageSent
              }
            >
              {primary.delivered_at ? '✓✓' : '✓'}
            </span>
          ) : null}
        </time>
      </div>
      <ShareToChatsDialog
        open={trackIds.length > 0}
        loading={share.isPending}
        onClose={() => setTrackIds([])}
        onSend={(conversationIds) => share.mutate(conversationIds)}
      />
    </article>
  );
}

function ConversationMessageContent({
  conversationId,
  message,
  editingRequested,
  onEditingHandled,
}: {
  conversationId: string;
  message: ConversationMessage;
  editingRequested: boolean;
  onEditingHandled: () => void;
}) {
  const viewerTime = useViewerTime();
  const queryClient = useQueryClient();
  const settings = useQuery({ queryKey: ['settings'], queryFn: api.settings });
  const [editing, setEditing] = useState(false);
  const [editText, setEditText] = useState(message.text_content ?? '');
  const [telegramAvatarFailed, setTelegramAvatarFailed] = useState(false);
  const lastTapRef = useRef(0);
  const react = useMessageReaction(conversationId, message.id);
  const updateText = useMutation({
    mutationFn: () => api.updateConversationMessageText(conversationId, message.id, editText),
    onSuccess: () => {
      setEditing(false);
      void queryClient.invalidateQueries({ queryKey: ['conversation-messages', conversationId] });
      void queryClient.invalidateQueries({ queryKey: ['conversations'] });
    },
  });
  useEffect(() => {
    if (!editingRequested) return;
    setEditText(message.text_content ?? '');
    setEditing(true);
    onEditingHandled();
  }, [editingRequested, message.text_content, onEditingHandled]);
  const mediaUrl = `/api/conversations/${conversationId}/messages/${message.id}/media`;
  const telegramProfile = parseTelegramProfileShare(message.text_content);
  const sharedEntity = parseSharedEntity(message.text_content);
  const videoLike = isVideoChatMedia(message);
  const showPlainText =
    Boolean(message.text_content) &&
    message.message_type !== 'profile' &&
    !telegramProfile &&
    !sharedEntity &&
    !editing;
  const media =
    message.has_media && message.message_type === 'animation' ? (
      <ConversationGifMedia src={mediaUrl} video={videoLike} />
    ) : message.has_media && ['photo', 'sticker'].includes(message.message_type) ? (
      <img src={mediaUrl} alt={message.file_name ?? ru.miniApp.community.documentMessage} />
    ) : message.has_media && videoLike ? (
      <video src={mediaUrl} controls playsInline preload="metadata" />
    ) : message.has_media && message.message_type === 'audio' ? (
      <ChatAudioPlayer conversationId={conversationId} message={message} />
    ) : message.has_media && message.message_type === 'voice' ? (
      <ChatVoicePlayer src={mediaUrl} />
    ) : message.has_media ? (
      <a className="chat-document-link" href={mediaUrl} target="_blank" rel="noreferrer">
        {message.file_name ?? ru.miniApp.community.documentMessage}
      </a>
    ) : null;
  return (
    <article
      className={`telegram-message-bubble ${message.is_own ? 'is-own' : ''}`}
      onPointerUp={(event) => {
        if (
          (event.target as HTMLElement).closest('.chat-reaction-menu,.chat-reaction-summary,input')
        )
          return;
        const now = Date.now();
        if (now - lastTapRef.current < 320) {
          react.mutate(chatReaction(settings.data?.quick_reaction));
          lastTapRef.current = 0;
          return;
        }
        lastTapRef.current = now;
      }}
    >
      <ConversationMessageContext message={message} />
      {sharedEntity ? (
        <div className="chat-shared-post">
          <span className="chat-shared-post-label">{ru.miniApp.community.forwardedPost}</span>
          <Link
            className="chat-shared-post-card"
            href={
              sharedEntity.entityType === 'post'
                ? `/posts/${encodeURIComponent(sharedEntity.entityId)}`
                : `/search?questionnaire=${encodeURIComponent(sharedEntity.entityId)}`
            }
          >
            <span className="chat-shared-post-author">
              <ProfileAvatar
                mediaId={sharedEntity.avatarMediaId}
                renderMode={sharedEntity.avatarRenderMode}
                name={sharedEntity.authorName ?? ru.miniApp.community.sharedPostMessage}
              />
              <strong>{sharedEntity.authorName ?? ru.miniApp.community.sharedPostMessage}</strong>
            </span>
            {sharedEntity.title.trim() ? (
              <strong className="chat-shared-post-title">{sharedEntity.title}</strong>
            ) : null}
            <ProfileMarkdown className="chat-shared-post-body" allowLinks>
              {sharedEntity.body}
            </ProfileMarkdown>
            {sharedEntity.caption ? (
              <ProfileMarkdown className="chat-shared-post-caption" allowLinks dimEmphasis>
                {sharedEntity.caption}
              </ProfileMarkdown>
            ) : null}
            {sharedEntity.media.map((item) =>
              item.type === 'photo' || item.type === 'animation' ? (
                <img
                  key={item.id}
                  src={`/api/posts/${sharedEntity.entityId}/media/${item.id}`}
                  alt=""
                />
              ) : item.type === 'video' ? (
                <video
                  key={item.id}
                  src={`/api/posts/${sharedEntity.entityId}/media/${item.id}`}
                  controls
                  playsInline
                  preload="metadata"
                />
              ) : (
                <span className="chat-shared-track" key={item.id}>
                  🎵 {item.title ?? ru.miniApp.search.trackUnknown}
                  {item.performer ? ` — ${item.performer}` : ''}
                </span>
              ),
            )}
          </Link>
        </div>
      ) : telegramProfile ? (
        <a
          className="chat-telegram-profile-card"
          href={telegramProfile.url}
          onClick={(event) => {
            const telegram = getTelegram();
            if (telegram && telegramProfile.url.startsWith('https://t.me/')) {
              event.preventDefault();
              telegram.openTelegramLink(telegramProfile.url);
            }
          }}
        >
          {telegramProfile.hasAvatar && !telegramAvatarFailed ? (
            <img
              className="chat-telegram-profile-avatar"
              src={`/api/conversations/${conversationId}/messages/${message.id}/telegram-avatar`}
              alt=""
              onError={() => setTelegramAvatarFailed(true)}
            />
          ) : (
            <span className="chat-telegram-profile-icon">👤</span>
          )}
          <span>
            <strong>{telegramProfile.displayName}</strong>
            <small>
              {telegramProfile.username
                ? `@${telegramProfile.username}`
                : ru.miniApp.community.telegramProfileWithoutUsername}
            </small>
          </span>
          <span className="chat-telegram-profile-open">
            {ru.miniApp.community.openTelegramProfile} <ExternalLink />
          </span>
        </a>
      ) : message.message_type === 'profile' ? (
        <Link className="chat-profile-label" href={`/profiles/${message.sender_user_id}`}>
          {ru.miniApp.community.sharedProfileMessage}
        </Link>
      ) : null}
      {message.message_type === 'scenario' ? (
        <strong className="chat-profile-label">{ru.miniApp.community.sharedScenarioMessage}</strong>
      ) : null}
      {showPlainText && message.has_media && message.caption_position === 'top' ? (
        <ProfileMarkdown
          allowLinks
          className="chat-message-markdown chat-media-caption is-top"
          dimEmphasis
        >
          {message.text_content ?? ''}
        </ProfileMarkdown>
      ) : null}
      {media}
      {showPlainText && (!message.has_media || message.caption_position !== 'top') ? (
        <ProfileMarkdown allowLinks className="chat-message-markdown" dimEmphasis>
          {message.text_content ?? ''}
        </ProfileMarkdown>
      ) : null}
      {editing ? (
        <form
          className="chat-message-editor"
          onSubmit={(event) => {
            event.preventDefault();
            if (editText.trim()) updateText.mutate();
          }}
        >
          <textarea
            value={editText}
            maxLength={4_000}
            onChange={(event) => setEditText(event.target.value)}
          />
          <button
            type="submit"
            disabled={updateText.isPending}
            aria-label={ru.miniApp.community.saveMessageEdit}
          >
            <Save />
          </button>
          <button
            type="button"
            onClick={() => setEditing(false)}
            aria-label={ru.miniApp.community.cancelAction}
          >
            <X />
          </button>
        </form>
      ) : null}
      <ChatReactionSummary message={message} onReact={(reaction) => react.mutate(reaction)} />
      <ConversationReplyCount message={message} />
      <time dateTime={message.created_at}>
        {viewerTime.clock(message.created_at)}
        {message.is_own ? (
          <span
            className={`chat-receipt ${message.read_at ? 'is-read' : ''}`}
            aria-label={
              message.read_at
                ? ru.miniApp.community.messageRead
                : message.delivered_at
                  ? ru.miniApp.community.messageDelivered
                  : ru.miniApp.community.messageSent
            }
          >
            {message.delivered_at ? '✓✓' : '✓'}
          </span>
        ) : null}
      </time>
    </article>
  );
}

function isVideoChatMedia(message: ConversationMessage): boolean {
  return (
    message.message_type === 'video' ||
    (message.message_type === 'animation' && message.mime_type?.startsWith('video/') === true)
  );
}

function ConversationGifMedia({ src, video }: { src: string; video: boolean }) {
  return (
    <div className="chat-gif-media">
      {video ? (
        <video src={src} autoPlay loop muted playsInline preload="metadata" />
      ) : (
        <img src={src} alt={ru.miniApp.community.animationMessage} />
      )}
      <span>{ru.miniApp.community.animationMessage}</span>
    </div>
  );
}

function parseTelegramProfileShare(content?: string | null): {
  displayName: string;
  username: string | null;
  url: string;
  hasAvatar: boolean;
} | null {
  if (!content) return null;
  try {
    const value: unknown = JSON.parse(content);
    if (typeof value !== 'object' || value === null) return null;
    const record = value as Record<string, unknown>;
    const kind = record.kind;
    const displayName = record.displayName;
    const username = record.username;
    const url = record.url;
    if (
      kind !== 'telegram_profile' ||
      typeof displayName !== 'string' ||
      !displayName.trim() ||
      displayName.length > 128 ||
      (username !== null && typeof username !== 'string') ||
      typeof url !== 'string' ||
      !(/^https:\/\/t\.me\/[A-Za-z0-9_]{4,32}$/.test(url) || /^tg:\/\/user\?id=\d{1,20}$/.test(url))
    ) {
      return null;
    }
    return {
      displayName,
      username,
      url,
      hasAvatar: typeof record.avatarFileId === 'string' && record.avatarFileId.length > 0,
    };
  } catch {
    return null;
  }
}

type SharedEntity = {
  entityType: 'post' | 'questionnaire';
  entityId: string;
  authorName: string | null;
  avatarMediaId: string | null;
  avatarRenderMode: 'photo' | 'animation' | 'still' | null;
  title: string;
  body: string;
  caption: string | null;
  media: Array<{ id: string; type: string; title: string | null; performer: string | null }>;
};

function parseSharedEntity(content?: string | null): SharedEntity | null {
  if (!content) return null;
  try {
    const value: unknown = JSON.parse(content);
    if (!value || typeof value !== 'object') {
      return null;
    }
    const record: Record<string, unknown> = { ...value };
    if (record.kind !== 'shared_entity') return null;
    const entityType = record.entityType;
    const entityId = record.entityId;
    const title = record.title;
    const body = record.body;
    if (
      (entityType !== 'post' && entityType !== 'questionnaire') ||
      typeof entityId !== 'string' ||
      typeof title !== 'string' ||
      typeof body !== 'string'
    ) {
      return null;
    }
    const avatarRenderMode = record.avatarRenderMode;
    const rawMedia: unknown = record.media;
    const mediaItems: unknown[] = Array.isArray(rawMedia) ? (rawMedia as unknown[]) : [];
    const media = mediaItems.flatMap((item) => {
      if (!item || typeof item !== 'object') return [];
      const mediaItem: Record<string, unknown> = { ...item };
      const id = mediaItem.id;
      const type = mediaItem.type;
      if (typeof id !== 'string' || typeof type !== 'string') return [];
      const trackTitle = mediaItem.title;
      const performer = mediaItem.performer;
      return [
        {
          id,
          type,
          title: typeof trackTitle === 'string' ? trackTitle : null,
          performer: typeof performer === 'string' ? performer : null,
        },
      ];
    });
    return {
      entityType,
      entityId,
      authorName: typeof record.authorName === 'string' ? record.authorName : null,
      avatarMediaId: typeof record.avatarMediaId === 'string' ? record.avatarMediaId : null,
      avatarRenderMode:
        avatarRenderMode === 'photo' ||
        avatarRenderMode === 'animation' ||
        avatarRenderMode === 'still'
          ? avatarRenderMode
          : null,
      title,
      body,
      caption: typeof record.caption === 'string' ? record.caption : null,
      media,
    };
  } catch {
    return null;
  }
}

function groupConversationMessages(messages: ConversationMessage[]): ConversationMessage[][] {
  const groups: ConversationMessage[][] = [];
  for (const message of messages) {
    const previous = groups.at(-1);
    const messageCanGroup =
      message.message_type === 'photo' ||
      message.message_type === 'video' ||
      message.message_type === 'audio' ||
      message.message_type === 'voice';
    const previousCanGroup =
      previous?.[0]?.message_type === 'photo' ||
      previous?.[0]?.message_type === 'video' ||
      previous?.[0]?.message_type === 'audio' ||
      previous?.[0]?.message_type === 'voice';
    if (
      message.media_group_id &&
      previous?.[0]?.media_group_id === message.media_group_id &&
      previous[0].is_own === message.is_own &&
      messageCanGroup &&
      previousCanGroup &&
      ['audio', 'voice'].includes(message.message_type) ===
        ['audio', 'voice'].includes(previous[0].message_type)
    ) {
      previous.push(message);
    } else {
      groups.push([message]);
    }
  }
  return groups;
}

function repliedMessageSummary(message: ConversationMessage): string {
  if (message.reply_text_content?.trim()) return message.reply_text_content.trim();
  if (message.reply_file_name?.trim()) return message.reply_file_name.trim();
  const type = message.reply_message_type;
  if (type === 'photo') return ru.miniApp.community.photoMessage;
  if (type === 'video') return ru.miniApp.community.videoMessage;
  if (type === 'animation') return ru.miniApp.community.animationMessage;
  if (type === 'audio') return ru.miniApp.community.audioMessage;
  if (type === 'voice') return ru.miniApp.community.voiceMessage;
  return ru.miniApp.community.messageUnavailable;
}

function ConversationReplyQuote({ message }: { message: ConversationMessage }) {
  return (
    <button
      type="button"
      className="chat-reply-quote"
      onClick={() => {
        if (message.reply_to_message_id) {
          window.dispatchEvent(
            new CustomEvent<string>('rolemate:scroll-message', {
              detail: message.reply_to_message_id,
            }),
          );
        }
      }}
    >
      <strong>
        {message.reply_is_own
          ? ru.miniApp.community.you
          : message.reply_sender_name || ru.miniApp.community.roleplayer}
      </strong>
      <span>{repliedMessageSummary(message)}</span>
    </button>
  );
}

function ForwardedMessageAuthor({ message }: { message: ConversationMessage }) {
  const content = (
    <>
      {message.forwarded_author_user_id ? (
        <ProfileAvatar
          mediaId={message.forwarded_author_avatar_media_id}
          renderMode={message.forwarded_author_avatar_render_mode}
          name={message.forwarded_author_name ?? ru.miniApp.community.roleplayer}
        />
      ) : null}
      <span>
        <small>{ru.miniApp.community.forwardedMessage}</small>
        <strong>
          {message.forwarded_author_name || ru.miniApp.community.forwardedAuthorHidden}
          {message.forwarded_author_user_id ? (
            <VerificationBadge
              kind={message.forwarded_author_verification_kind}
              premium={message.forwarded_author_has_premium}
            />
          ) : null}
        </strong>
      </span>
    </>
  );
  return message.forwarded_author_user_id ? (
    <Link className="chat-forwarded-author" href={`/profiles/${message.forwarded_author_user_id}`}>
      {content}
    </Link>
  ) : (
    <div className="chat-forwarded-author is-hidden">{content}</div>
  );
}

function ConversationMessageContext({ message }: { message: ConversationMessage }) {
  if (!message.forwarded_from_message_id && !message.reply_to_message_id) return null;
  return (
    <div className="chat-message-context">
      {message.forwarded_from_message_id ? <ForwardedMessageAuthor message={message} /> : null}
      {message.reply_to_message_id ? <ConversationReplyQuote message={message} /> : null}
    </div>
  );
}

function ConversationReplyCount({ message }: { message: ConversationMessage }) {
  const count = Number(message.reply_count ?? 0);
  if (!count) return null;
  return (
    <button
      type="button"
      className="chat-reply-count"
      onClick={() => {
        window.dispatchEvent(
          new CustomEvent<string>('rolemate:scroll-message', { detail: message.id }),
        );
      }}
      aria-label={ru.miniApp.community.repliesToMessage(count)}
    >
      <Reply aria-hidden /> <span>{count}</span>
    </button>
  );
}

function ChatReactionMenu({
  onReact,
  onClose,
}: {
  onReact: (reaction: ChatReaction) => void;
  onClose?: () => void;
}) {
  return (
    <>
      {onClose ? (
        <button
          type="button"
          className="chat-reaction-backdrop"
          aria-label={ru.miniApp.community.cancelAction}
          onClick={onClose}
        />
      ) : null}
      <div className="chat-reaction-menu" data-no-section-swipe>
        <div
          className="chat-reaction-scroll"
          onWheel={(event) => {
            if (Math.abs(event.deltaY) <= Math.abs(event.deltaX)) return;
            event.currentTarget.scrollLeft += event.deltaY;
            event.preventDefault();
          }}
        >
          {Object.entries(ru.miniApp.community.reactionNames).map(([value, label]) => (
            <button key={value} type="button" onClick={() => onReact(value)} aria-label={label}>
              {reactionEmoji(value, label)}
            </button>
          ))}
        </div>
      </div>
    </>
  );
}

function reactionEmoji(value: string, label?: string): string {
  const legacy: Record<string, string> = {
    heart: '❤️',
    thumbs_up: '👍',
    fire: '🔥',
    laugh: '😂',
    sad: '😢',
  };
  return legacy[value] ?? label?.split(/\s/u)[0] ?? value;
}

function ChatReactionSummary({
  message,
  onReact,
}: {
  message: ConversationMessage;
  onReact: (reaction: ChatReaction) => void;
}) {
  let counts: Array<{ reaction: ChatReaction; count: number }> = [];
  try {
    const parsed: unknown = JSON.parse(message.reactions || '[]');
    if (Array.isArray(parsed)) {
      counts = parsed.filter(
        (item): item is { reaction: ChatReaction; count: number } =>
          typeof item === 'object' &&
          item !== null &&
          typeof Reflect.get(item, 'reaction') === 'string' &&
          String(Reflect.get(item, 'reaction')).trim().length > 0 &&
          String(Reflect.get(item, 'reaction')).length <= 16 &&
          typeof Reflect.get(item, 'count') === 'number',
      );
    }
  } catch {
    counts = [];
  }
  if (!counts.length) return null;
  return (
    <div className="chat-reaction-summary">
      {counts.map((item) => (
        <button
          className={message.own_reaction === item.reaction ? 'is-own' : ''}
          key={item.reaction}
          type="button"
          onClick={() => onReact(item.reaction)}
        >
          {reactionEmoji(
            item.reaction,
            (ru.miniApp.community.reactionNames as Record<string, string>)[item.reaction],
          )}{' '}
          {item.count}
        </button>
      ))}
    </div>
  );
}

function ChatVoicePlayer({ src }: { src: string }) {
  const audioRef = useRef<HTMLAudioElement>(null);
  const [playing, setPlaying] = useState(false);
  const [duration, setDuration] = useState(0);
  const [position, setPosition] = useState(0);
  const [rate, setRate] = useState<1 | 1.5 | 2>(1);
  return (
    <div className="chat-voice-player">
      <audio
        ref={audioRef}
        src={src}
        preload="metadata"
        onLoadedMetadata={(event) => setDuration(event.currentTarget.duration || 0)}
        onTimeUpdate={(event) => setPosition(event.currentTarget.currentTime)}
        onEnded={() => setPlaying(false)}
      />
      <button
        type="button"
        onClick={() => {
          const audio = audioRef.current;
          if (!audio) return;
          if (audio.paused) {
            void audio.play();
            setPlaying(true);
          } else {
            audio.pause();
            setPlaying(false);
          }
        }}
        aria-label={playing ? ru.miniApp.community.voicePause : ru.miniApp.community.voicePlay}
      >
        {playing ? <Pause /> : <Play />}
      </button>
      <input
        type="range"
        min={0}
        max={duration || 1}
        step={0.1}
        value={Math.min(position, duration || 1)}
        onChange={(event) => {
          const value = Number(event.target.value);
          if (audioRef.current) audioRef.current.currentTime = value;
          setPosition(value);
        }}
        aria-label={ru.miniApp.community.voiceSeek}
      />
      <button
        type="button"
        className="voice-rate"
        onClick={() => {
          const next = rate === 1 ? 1.5 : rate === 1.5 ? 2 : 1;
          setRate(next);
          if (audioRef.current) audioRef.current.playbackRate = next;
        }}
      >
        {rate}x
      </button>
    </div>
  );
}

function formatMediaTime(seconds: number): string {
  if (!Number.isFinite(seconds) || seconds < 0) return '0:00';
  const rounded = Math.floor(seconds);
  return `${Math.floor(rounded / 60)}:${String(rounded % 60).padStart(2, '0')}`;
}

function ChatAudioPlayer({
  conversationId,
  message,
}: {
  conversationId: string;
  message: ConversationMessage;
}) {
  const player = useMusicPlayer();
  const mediaUrl = `/api/conversations/${conversationId}/messages/${message.id}/media`;
  const thumbnailUrl = `/api/conversations/${conversationId}/messages/${message.id}/thumbnail`;
  const track: PlaylistTrack = {
    id: message.id,
    src: mediaUrl,
    title: message.track_title || message.file_name || ru.miniApp.search.trackUnknown,
    performer: message.track_performer || ru.miniApp.search.trackPerformerUnknown,
    ...(message.has_thumbnail ? { coverSrc: thumbnailUrl } : {}),
  };
  const active = player.currentTrack?.id === message.id;
  return (
    <div className="chat-audio-player">
      <button
        type="button"
        className={`chat-audio-cover ${message.has_thumbnail ? 'has-cover' : ''}`}
        style={message.has_thumbnail ? { backgroundImage: `url("${thumbnailUrl}")` } : undefined}
        onClick={() => {
          if (active) void player.toggle();
          else void player.playQueue([track]);
        }}
        aria-label={
          active && player.playing
            ? ru.miniApp.community.voicePause
            : ru.miniApp.community.voicePlay
        }
      >
        {active && player.playing ? <Pause /> : <Play />}
      </button>
      <div className="chat-audio-details">
        <strong>{track.title}</strong>
        <small>{track.performer}</small>
        <input
          type="range"
          min={0}
          max={active ? player.duration || 1 : 1}
          step={0.1}
          value={active ? Math.min(player.position, player.duration || 1) : 0}
          style={musicProgressStyle(active ? player.position : 0, active ? player.duration : 0)}
          onChange={(event) => {
            const nextPosition = Number(event.target.value);
            if (!active) void player.playQueue([track], 0, nextPosition);
            else player.seek(nextPosition);
          }}
          aria-label={ru.miniApp.community.voiceSeek}
        />
        <span className="chat-audio-time">
          {formatMediaTime(active ? player.position : 0)}/
          {formatMediaTime(
            active
              ? player.duration || message.duration_seconds || 0
              : message.duration_seconds || 0,
          )}
        </span>
      </div>
    </div>
  );
}

function ConversationMediaCarousel({
  conversationId,
  messages,
}: {
  conversationId: string;
  messages: ConversationMessage[];
}) {
  const viewerTime = useViewerTime();
  const queryClient = useQueryClient();
  const settings = useQuery({ queryKey: ['settings'], queryFn: api.settings });
  const [index, setIndex] = useState(0);
  const [fullscreen, setFullscreen] = useState(false);
  const [orderEditing, setOrderEditing] = useState(false);
  const [orderedIds, setOrderedIds] = useState<string[]>([]);
  const touchX = useRef(0);
  const touchY = useRef(0);
  const lastTapRef = useRef(0);
  const mediaOpenTapRef = useRef(0);
  const mediaOpenTimerRef = useRef<number | null>(null);
  const current = messages[index] ?? messages[0]!;
  const primary = messages[0]!;
  useEffect(
    () => () => {
      if (mediaOpenTimerRef.current) window.clearTimeout(mediaOpenTimerRef.current);
    },
    [],
  );
  useEffect(() => {
    if (!fullscreen) return;
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') setFullscreen(false);
      if (event.key === 'ArrowLeft' && messages.length > 1) {
        setIndex((value) => (value - 1 + messages.length) % messages.length);
      }
      if (event.key === 'ArrowRight' && messages.length > 1) {
        setIndex((value) => (value + 1) % messages.length);
      }
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [fullscreen, messages.length]);
  const react = useMessageReaction(conversationId, primary.id);
  const reorder = useMutation({
    mutationFn: () =>
      api.reorderConversationMedia(conversationId, primary.media_group_id ?? '', [
        ...orderedIds,
        ...messages.map((item) => item.id).filter((id) => !orderedIds.includes(id)),
      ]),
    onSuccess: () => {
      setOrderEditing(false);
      setOrderedIds([]);
      setIndex(0);
      void queryClient.invalidateQueries({ queryKey: ['conversation-messages', conversationId] });
    },
  });
  const replace = useMutation({
    mutationFn: async ({ message, file }: { message: ConversationMessage; file: File }) => {
      const kind: ChatMediaKind =
        file.type === 'image/gif'
          ? 'animation'
          : file.type.startsWith('video/')
            ? 'video'
            : file.type.startsWith('audio/')
              ? message.message_type === 'voice'
                ? 'voice'
                : 'audio'
              : 'photo';
      return api.replaceConversationMedia(conversationId, message.id, {
        kind,
        fileName: file.name,
        mimeType: file.type || 'application/octet-stream',
        dataBase64: await chatFileBase64(file),
      });
    },
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ['conversation-messages', conversationId] });
      void queryClient.invalidateQueries({ queryKey: ['conversations'] });
    },
  });
  const move = (direction: number) =>
    setIndex((value) => (value + direction + messages.length) % messages.length);
  const media = (message: ConversationMessage, fullscreenMedia = fullscreen) => {
    const src = `/api/conversations/${conversationId}/messages/${message.id}/media`;
    return message.message_type === 'animation' ? (
      <ConversationGifMedia src={src} video={isVideoChatMedia(message)} />
    ) : isVideoChatMedia(message) ? (
      <video
        src={src}
        controls={fullscreenMedia}
        autoPlay={!fullscreenMedia}
        muted={!fullscreenMedia}
        loop={!fullscreenMedia}
        playsInline
        preload="metadata"
      />
    ) : (
      <img src={src} alt={message.file_name ?? ru.miniApp.community.documentMessage} />
    );
  };
  const viewer = (
    <div
      className={
        fullscreen
          ? 'chat-media-lightbox'
          : `telegram-message-bubble chat-media-carousel ${primary.is_own ? 'is-own' : ''}`
      }
      onTouchStart={(event) => {
        if (!fullscreen) return;
        touchX.current = event.touches[0]?.clientX ?? 0;
        touchY.current = event.touches[0]?.clientY ?? 0;
      }}
      onTouchEnd={(event) => {
        if (!fullscreen) return;
        const touch = event.changedTouches[0];
        const delta = (touch?.clientX ?? 0) - touchX.current;
        const verticalDelta = (touch?.clientY ?? 0) - touchY.current;
        if (fullscreen && verticalDelta < -70 && Math.abs(verticalDelta) > Math.abs(delta)) {
          setFullscreen(false);
        } else if (Math.abs(delta) > 45) {
          move(delta < 0 ? 1 : -1);
        }
      }}
      onPointerUp={(event) => {
        if (
          fullscreen ||
          (event.target as HTMLElement).closest(
            '.chat-reaction-menu,.chat-reaction-summary,input,.chat-media-order',
          )
        )
          return;
        const now = Date.now();
        if (now - lastTapRef.current < 320) {
          react.mutate(chatReaction(settings.data?.quick_reaction));
          lastTapRef.current = 0;
          return;
        }
        lastTapRef.current = now;
      }}
      onMouseDown={(event) => {
        if (fullscreen && event.target === event.currentTarget) setFullscreen(false);
      }}
    >
      {fullscreen ? (
        <button
          className="media-lightbox-close"
          type="button"
          aria-label={ru.miniApp.search.closeMediaFullscreen}
          onClick={() => setFullscreen(false)}
        >
          <X aria-hidden />
        </button>
      ) : null}
      {fullscreen && messages.length > 1 ? (
        <>
          <button
            className="media-lightbox-nav media-lightbox-prev"
            type="button"
            aria-label={ru.miniApp.search.previousMedia}
            onClick={() => move(-1)}
          >
            <ChevronLeft aria-hidden />
          </button>
          <button
            className="media-lightbox-nav media-lightbox-next"
            type="button"
            aria-label={ru.miniApp.search.nextMedia}
            onClick={() => move(1)}
          >
            <ChevronRight aria-hidden />
          </button>
        </>
      ) : null}
      {!fullscreen ? <ConversationMessageContext message={primary} /> : null}
      {!fullscreen && primary.text_content && primary.caption_position === 'top' ? (
        <ProfileMarkdown className="chat-media-caption is-top" allowLinks dimEmphasis>
          {primary.text_content}
        </ProfileMarkdown>
      ) : null}
      <div
        className="chat-media-stage"
        onClick={(event) => {
          if (fullscreen || (event.target as HTMLElement).closest('.chat-media-order')) return;
          const row = event.currentTarget.closest<HTMLElement>('.telegram-message-row');
          if (row?.dataset.replySwiped === 'true') return;
          const now = Date.now();
          if (now - mediaOpenTapRef.current < 320) {
            if (mediaOpenTimerRef.current) window.clearTimeout(mediaOpenTimerRef.current);
            mediaOpenTimerRef.current = null;
            mediaOpenTapRef.current = 0;
            return;
          }
          mediaOpenTapRef.current = now;
          mediaOpenTimerRef.current = window.setTimeout(() => {
            setFullscreen(true);
            mediaOpenTimerRef.current = null;
            mediaOpenTapRef.current = 0;
          }, 330);
        }}
      >
        {!fullscreen && messages.length > 1 ? (
          <div className={`chat-media-collage count-${Math.min(messages.length, 4)}`}>
            {messages.slice(0, 4).map((item, itemIndex) => (
              <button
                type="button"
                className="chat-media-collage-item"
                key={item.id}
                onClick={(event) => {
                  event.stopPropagation();
                  const row = event.currentTarget.closest<HTMLElement>('.telegram-message-row');
                  if (row?.dataset.replySwiped === 'true') return;
                  setIndex(itemIndex);
                  setFullscreen(true);
                }}
                aria-label={ru.miniApp.community.openChatMediaFullscreen}
              >
                {media(item, false)}
                {itemIndex === 3 && messages.length > 4 ? (
                  <span className="chat-media-more">+{messages.length - 4}</span>
                ) : null}
              </button>
            ))}
          </div>
        ) : (
          media(current, fullscreen)
        )}
        {!fullscreen && primary.is_own && messages.length > 1 ? (
          <button
            type="button"
            className="chat-media-order"
            onClick={() => setOrderEditing(true)}
            aria-label={ru.miniApp.community.changeMediaOrder}
          >
            <CheckSquare />
          </button>
        ) : null}
        {fullscreen && messages.length > 1 ? (
          <span className="chat-media-counter">
            {index + 1}/{messages.length}
          </span>
        ) : null}
        {!fullscreen ? (
          <time className="chat-media-meta" dateTime={primary.created_at}>
            {viewerTime.clock(primary.created_at)}
            {primary.is_own ? (
              <span
                className={`chat-receipt ${primary.read_at ? 'is-read' : ''}`}
                aria-label={
                  primary.read_at
                    ? ru.miniApp.community.messageRead
                    : primary.delivered_at
                      ? ru.miniApp.community.messageDelivered
                      : ru.miniApp.community.messageSent
                }
              >
                {primary.delivered_at ? '✓✓' : '✓'}
              </span>
            ) : null}
          </time>
        ) : null}
      </div>
      {!fullscreen && primary.text_content && primary.caption_position !== 'top' ? (
        <ProfileMarkdown className="chat-media-caption is-bottom" allowLinks dimEmphasis>
          {primary.text_content}
        </ProfileMarkdown>
      ) : null}
      {!fullscreen ? (
        <div className="chat-message-secondary-actions">
          <ChatReactionSummary message={primary} onReact={(reaction) => react.mutate(reaction)} />
          <ConversationReplyCount message={primary} />
        </div>
      ) : null}
      {orderEditing ? (
        <div className="chat-media-order-dialog" role="dialog" aria-modal="true">
          <strong>{ru.miniApp.community.changeMediaOrder}</strong>
          <div className="chat-media-order-grid">
            {messages.map((item) => {
              const selectedIndex = orderedIds.indexOf(item.id);
              return (
                <div className="chat-media-order-item" key={item.id}>
                  <button
                    type="button"
                    onClick={() =>
                      setOrderedIds((current) =>
                        current.includes(item.id)
                          ? current.filter((id) => id !== item.id)
                          : [...current, item.id],
                      )
                    }
                  >
                    {media(item)}
                    {selectedIndex >= 0 ? <span>{selectedIndex + 1}</span> : null}
                  </button>
                  <label className="chat-media-replace">
                    <Pencil /> {ru.miniApp.community.replaceMedia}
                    <input
                      hidden
                      type="file"
                      accept="image/*,video/*,audio/*"
                      onChange={(event) => {
                        const file = event.target.files?.[0];
                        if (file) replace.mutate({ message: item, file });
                        event.target.value = '';
                      }}
                    />
                  </label>
                </div>
              );
            })}
          </div>
          <div className="confirm-dialog-actions">
            <Button
              disabled={orderedIds.length === 0}
              loading={reorder.isPending}
              onClick={() => reorder.mutate()}
            >
              {ru.miniApp.community.saveMessageEdit}
            </Button>
            <Button
              variant="secondary"
              onClick={() => {
                setOrderEditing(false);
                setOrderedIds([]);
              }}
            >
              {ru.miniApp.community.cancelAction}
            </Button>
          </div>
        </div>
      ) : null}
    </div>
  );
  return <>{fullscreen ? createPortal(viewer, document.body) : viewer}</>;
}

function ChatComposer({
  conversationId,
  premium,
  onSending,
  onSettled,
  onSent,
  replyTarget,
  onCancelReply,
}: {
  conversationId: string;
  premium: boolean;
  onSending: (message: string) => void;
  onSettled: () => void;
  onSent: () => void;
  replyTarget: ConversationMessage | null;
  onCancelReply: () => void;
}) {
  const queryClient = useQueryClient();
  const [text, setText] = useState('');
  const draftHydratedRef = useRef(false);
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const stopTypingRef = useRef<(() => void) | null>(null);
  const typingIdleTimerRef = useRef<number | null>(null);
  const draft = useQuery({
    queryKey: ['conversation-draft', conversationId],
    queryFn: () => api.conversationDraft(conversationId),
    staleTime: 0,
  });
  useEffect(() => {
    draftHydratedRef.current = false;
    setText('');
  }, [conversationId]);
  useEffect(() => {
    if (!draft.isSuccess || draftHydratedRef.current) return;
    setText(typeof draft.data?.text === 'string' ? draft.data.text : '');
    draftHydratedRef.current = true;
  }, [draft.data?.text, draft.isSuccess]);
  useEffect(() => {
    if (!draftHydratedRef.current) return;
    const timeout = window.setTimeout(() => {
      void api
        .saveConversationDraft(conversationId, text)
        .then(() => queryClient.invalidateQueries({ queryKey: ['conversations'] }))
        .catch(() => undefined);
    }, 550);
    return () => window.clearTimeout(timeout);
  }, [conversationId, queryClient, text]);
  const startTyping = () => {
    if (!stopTypingRef.current) {
      let stopped = false;
      const publish = () => {
        if (!stopped)
          void api.setConversationPresence(conversationId, 'typing').catch(() => undefined);
      };
      publish();
      const interval = window.setInterval(publish, 2_500);
      stopTypingRef.current = () => {
        if (stopped) return;
        stopped = true;
        window.clearInterval(interval);
        void api.setConversationPresence(conversationId, 'idle').catch(() => undefined);
      };
    }
    if (typingIdleTimerRef.current !== null) {
      window.clearTimeout(typingIdleTimerRef.current);
    }
    typingIdleTimerRef.current = window.setTimeout(() => {
      stopTypingRef.current?.();
      stopTypingRef.current = null;
      typingIdleTimerRef.current = null;
    }, 3_500);
  };
  const stopTyping = () => {
    if (typingIdleTimerRef.current !== null) window.clearTimeout(typingIdleTimerRef.current);
    typingIdleTimerRef.current = null;
    stopTypingRef.current?.();
    stopTypingRef.current = null;
  };
  useEffect(
    () => () => {
      if (typingIdleTimerRef.current !== null) {
        window.clearTimeout(typingIdleTimerRef.current);
      }
      stopTypingRef.current?.();
      stopTypingRef.current = null;
    },
    [conversationId],
  );
  useEffect(() => {
    const textarea = textareaRef.current;
    if (!textarea) return;
    textarea.style.height = 'auto';
    const nextHeight = Math.min(textarea.scrollHeight, 88);
    textarea.style.height = `${Math.max(38, nextHeight)}px`;
    textarea.style.overflowY = textarea.scrollHeight > 88 ? 'auto' : 'hidden';
  }, [text]);
  const send = useMutation({
    mutationFn: (message: string) =>
      api.sendConversationMessage(conversationId, message, replyTarget?.id),
    onMutate: (message) => onSending(message),
    onSuccess: async () => {
      stopTyping();
      setText('');
      void api.deleteConversationDraft(conversationId).catch(() => undefined);
      // The optimistic bubble is only cleared once the real message has been
      // fetched. Without this the text vanished and reappeared on the next poll.
      await queryClient.invalidateQueries({
        queryKey: ['conversation-messages', conversationId],
      });
      void queryClient.invalidateQueries({ queryKey: ['conversations'] });
      onSettled();
      onSent();
      onCancelReply();
    },
    onError: () => onSettled(),
  });
  return (
    <div className="telegram-composer-wrap">
      {replyTarget ? (
        <div className="chat-composer-reply">
          <Reply aria-hidden />
          <span>
            <strong>{ru.miniApp.community.replyingTo}</strong>
            <small>{chatMessageDisplayText(replyTarget)}</small>
          </span>
          <button
            type="button"
            aria-label={ru.miniApp.community.cancelReply}
            onClick={onCancelReply}
          >
            <X />
          </button>
        </div>
      ) : null}
      <form
        className="telegram-composer"
        onSubmit={(event) => {
          event.preventDefault();
          const message = text.trim();
          if (message) send.mutate(message);
        }}
      >
        <ChatTools
          conversationId={conversationId}
          premium={premium}
          {...(replyTarget ? { replyToMessageId: replyTarget.id } : {})}
          onSent={() => {
            onSent();
            onCancelReply();
          }}
        />
        <textarea
          ref={textareaRef}
          value={text}
          maxLength={4_000}
          rows={1}
          placeholder={ru.miniApp.community.messagePlaceholder}
          aria-label={ru.miniApp.community.messagePlaceholder}
          onChange={(event) => {
            const value = event.target.value;
            setText(value);
            if (value.trim()) startTyping();
            else stopTyping();
          }}
        />
        <VoiceRecorderButton
          conversationId={conversationId}
          premium={premium}
          {...(replyTarget ? { replyToMessageId: replyTarget.id } : {})}
          onSent={() => {
            onSent();
            onCancelReply();
          }}
        />
        <button
          type="submit"
          className="telegram-send-button"
          disabled={!text.trim() || send.isPending}
          aria-label={ru.miniApp.community.sendMessage}
        >
          <Send />
        </button>
      </form>
      {send.isError ? <span className="chat-composer-error">{send.error.message}</span> : null}
    </div>
  );
}

export function PremiumPage() {
  const viewerTime = useViewerTime();
  const premiumFeaturePreviewCount = 4;
  const queryClient = useQueryClient();
  const [promoCode, setPromoCode] = useState('');
  const products = useQuery({ queryKey: ['products'], queryFn: api.products });
  const status = useQuery({ queryKey: ['premium-status'], queryFn: api.premiumStatus });
  const stats = useQuery({
    queryKey: ['premium-stats'],
    queryFn: api.premiumStats,
    enabled: status.data?.premium === true,
  });
  const boost = useMutation({ mutationFn: api.premiumBoost });
  const promotion = useMutation({
    mutationFn: api.applyPromotion,
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ['premium-status'] });
      void queryClient.invalidateQueries({ queryKey: ['products'] });
    },
  });
  const invoice = useMutation({
    mutationFn: api.invoice,
    onSuccess: (result) => {
      if (result.invoiceLink) getTelegram()?.openInvoice(result.invoiceLink);
    },
  });
  const premiumEnd =
    status.data?.premium && status.data.endsAt ? new Date(status.data.endsAt) : null;
  const premiumEndValid = premiumEnd && !Number.isNaN(premiumEnd.getTime()) ? premiumEnd : null;
  const premiumDaysRemaining = premiumEndValid
    ? Math.max(0, Math.ceil((premiumEndValid.getTime() - Date.now()) / 86_400_000))
    : null;
  return (
    <div className="mx-auto max-w-2xl">
      <section className="premium-hero">
        <Crown className="h-10 w-10" />
        <p className="eyebrow">{ru.miniApp.community.premiumEyebrow}</p>
        <h1 className="font-display text-5xl font-semibold">{ru.miniApp.community.premiumTitle}</h1>
        <p>{ru.miniApp.community.premiumDescription}</p>
      </section>
      <div className="mt-6 grid gap-3 sm:grid-cols-2">
        {ru.miniApp.community.premiumFeatures.slice(0, premiumFeaturePreviewCount).map((item) => (
          <Card key={item} className="flex items-center gap-3 p-4">
            <Check className="h-4 w-4 text-lilac" />
            <span className="text-sm">{item}</span>
          </Card>
        ))}
      </div>
      <details className="info-disclosure premium-features-disclosure mt-3">
        <summary>
          <span>
            <strong>
              {ru.miniApp.community.premiumMoreFeatures(
                ru.miniApp.community.premiumFeatures.length - premiumFeaturePreviewCount,
              )}
            </strong>
          </span>
          <ChevronDown className="info-disclosure-chevron" aria-hidden />
        </summary>
        <div className="info-disclosure-content">
          <ul>
            {ru.miniApp.community.premiumFeatures.slice(premiumFeaturePreviewCount).map((item) => (
              <li key={item}>{item}</li>
            ))}
          </ul>
          <p>{ru.miniApp.community.premiumAuditNote}</p>
        </div>
      </details>
      {status.data?.premium ? (
        <Card className="mt-4 p-4">
          <div className="premium-active-status">
            <Check className="h-5 w-5" />
            <div>
              <strong>{ru.miniApp.community.premiumActive}</strong>
              {premiumEndValid ? (
                <p className="mt-1 text-sm text-soft">
                  {ru.miniApp.community.premiumActiveUntil(viewerTime.absolute(premiumEndValid))}
                  {premiumDaysRemaining === null
                    ? ''
                    : ` · ${ru.miniApp.community.premiumDaysRemaining(premiumDaysRemaining)}`}
                </p>
              ) : null}
            </div>
          </div>
          {stats.data ? (
            <p className="mt-3 text-sm text-soft">
              {ru.miniApp.community.premiumStats(
                stats.data.viewsToday,
                stats.data.viewsSevenDays,
                stats.data.viewsTotal,
                stats.data.incomingLikes,
              )}
            </p>
          ) : null}
          {status.data.earlyAccess ? (
            <p className="mt-2 text-sm text-lilac">{ru.miniApp.community.earlyAccessEnabled}</p>
          ) : null}
          <Button className="mt-3" onClick={() => boost.mutate()} loading={boost.isPending}>
            {ru.miniApp.community.activateBoost}
          </Button>
          {boost.isSuccess ? (
            <p className="mt-2 text-sm text-lilac">{ru.miniApp.community.boostActivated}</p>
          ) : null}
          {boost.isError ? (
            <p className="mt-2 text-sm text-red-300">
              {boost.error instanceof ApiError && boost.error.code === 'BOOST_COOLDOWN'
                ? ru.miniApp.community.boostDailyLimit
                : boost.error.message}
            </p>
          ) : null}
        </Card>
      ) : null}
      {status.data?.premium ? <PremiumProfileVariants /> : null}
      <SectionTitle eyebrow={ru.miniApp.community.paymentEyebrow}>
        {ru.miniApp.community.choosePlan}
      </SectionTitle>
      <Card className="mb-4 p-4">
        <strong>{ru.miniApp.community.promoTitle}</strong>
        <div className="mt-3 flex gap-2">
          <input
            className="input-field"
            value={promoCode}
            maxLength={40}
            onChange={(event) => setPromoCode(event.target.value.toUpperCase())}
            placeholder={ru.miniApp.community.promoPlaceholder}
          />
          <Button
            onClick={() => promotion.mutate(promoCode)}
            disabled={promoCode.trim().length < 3}
            loading={promotion.isPending}
          >
            {ru.miniApp.community.applyPromo}
          </Button>
        </div>
        {promotion.data ? (
          <p className="mt-2 text-sm text-lilac">
            {promotion.data.type === 'premium_days'
              ? ru.miniApp.community.promoPremiumApplied(promotion.data.premiumDays ?? 0)
              : ru.miniApp.community.promoDiscountApplied(
                  promotion.data.discountStars ?? 0,
                  promotion.data.discountRubles ?? 0,
                )}
          </p>
        ) : null}
        {promotion.isError ? (
          <p className="mt-2 text-sm text-red-300">{promotion.error.message}</p>
        ) : null}
      </Card>
      <div className="grid gap-3">
        {products.data?.map((product) => (
          <Card key={product.id} className="product-card">
            <div>
              <strong>{product.name}</strong>
              <p>{product.description}</p>
            </div>
            <Button onClick={() => invoice.mutate(product.id)} loading={invoice.isPending}>
              {(product.effective_stars_amount ?? product.stars_amount) < product.stars_amount ? (
                <span className="flex flex-col items-end leading-tight">
                  <span>{product.effective_stars_amount} ⭐</span>
                  <span className="text-xs opacity-70 line-through">{product.stars_amount} ⭐</span>
                </span>
              ) : (
                `${product.stars_amount} ⭐`
              )}
            </Button>
          </Card>
        ))}
      </div>
      <p className="mt-6 text-center text-xs text-muted">{ru.miniApp.attribution}</p>
    </div>
  );
}

function PremiumProfileVariants() {
  const queryClient = useQueryClient();
  const variants = useQuery({ queryKey: ['profile-variants'], queryFn: api.profileVariants });
  const [name, setName] = useState('');
  const [shortHeadline, setShortHeadline] = useState('');
  const [about, setAbout] = useState('');
  const [plots, setPlots] = useState('');
  const save = useMutation({
    mutationFn: api.saveProfileVariant,
    onSuccess: () => {
      setName('');
      setShortHeadline('');
      setAbout('');
      setPlots('');
      void queryClient.invalidateQueries({ queryKey: ['profile-variants'] });
    },
  });
  const activate = useMutation({
    mutationFn: api.activateProfileVariant,
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ['profile-variants'] });
      void queryClient.invalidateQueries({ queryKey: ['profile'] });
    },
  });
  const remove = useMutation({
    mutationFn: api.deleteProfileVariant,
    onSuccess: () => void queryClient.invalidateQueries({ queryKey: ['profile-variants'] }),
  });
  return (
    <Card className="mt-4 space-y-3 p-4">
      <h2 className="font-display text-2xl">{ru.miniApp.community.profileVariantsTitle}</h2>
      <p className="mt-2 text-sm leading-relaxed text-muted">
        {ru.miniApp.community.profileVariantsDescription}
      </p>
      <input
        className="input-field"
        value={name}
        maxLength={40}
        onChange={(event) => setName(event.target.value)}
        placeholder={ru.miniApp.community.profileVariantName}
      />
      <input
        className="input-field"
        value={shortHeadline}
        maxLength={120}
        onChange={(event) => setShortHeadline(event.target.value)}
        placeholder={ru.miniApp.community.profileVariantHeadline}
      />
      <textarea
        className="input-field min-h-24"
        value={about}
        maxLength={2_000}
        onChange={(event) => setAbout(event.target.value)}
        placeholder={ru.miniApp.community.profileVariantAbout}
      />
      <textarea
        className="input-field min-h-20"
        value={plots}
        maxLength={2_000}
        onChange={(event) => setPlots(event.target.value)}
        placeholder={ru.miniApp.community.profileVariantPlots}
      />
      <Button
        loading={save.isPending}
        disabled={!name.trim() || shortHeadline.trim().length < 3 || about.trim().length < 20}
        onClick={() => save.mutate({ name, shortHeadline, about, plots })}
      >
        {ru.miniApp.community.saveProfileVariant}
      </Button>
      <div className="space-y-2">
        {variants.data?.map((variant) => (
          <div className="setting-row" key={variant.id}>
            <span>
              {variant.name}
              {variant.is_active ? ' ✓' : ''}
            </span>
            <span className="flex gap-2">
              <button onClick={() => activate.mutate(variant.id)}>
                {ru.miniApp.community.activateProfileVariant}
              </button>
              <button onClick={() => remove.mutate(variant.id)}>
                {ru.miniApp.community.deleteProfileVariant}
              </button>
            </span>
          </div>
        ))}
      </div>
    </Card>
  );
}

export function ReferralsPage() {
  const referrals = useQuery({ queryKey: ['referrals'], queryFn: api.referrals });
  if (referrals.isLoading) return <Skeleton className="h-96" />;
  const data = referrals.data;
  if (!data) return null;
  return (
    <div className="mx-auto max-w-xl">
      <SectionTitle eyebrow={ru.miniApp.community.referralEyebrow}>
        {ru.miniApp.community.inviteFriends}
      </SectionTitle>
      <Card className="referral-card">
        <Gift className="h-10 w-10 text-lilac" />
        <h2 className="font-display text-3xl">{ru.miniApp.community.referralReward}</h2>
        <p>{ru.miniApp.community.referralCondition}</p>
        <div className="referral-link">
          <code>{data.link}</code>
          <Button variant="secondary" onClick={() => void navigator.clipboard.writeText(data.link)}>
            <Copy className="h-4 w-4" />
          </Button>
        </div>
      </Card>
      <div className="stats-grid mt-4">
        <Card>
          <strong>{data.invited ?? 0}</strong>
          <small>{ru.miniApp.community.invited}</small>
        </Card>
        <Card>
          <strong>{data.qualified ?? 0}</strong>
          <small>{ru.miniApp.community.qualified}</small>
        </Card>
        <Card>
          <strong>{data.rewardDays}</strong>
          <small>{ru.miniApp.community.daysGranted}</small>
        </Card>
      </div>
      <p className="mt-6 text-center text-xs text-muted">{ru.miniApp.attribution}</p>
    </div>
  );
}

export function SettingsPage() {
  const queryClient = useQueryClient();
  const settings = useQuery({ queryKey: ['settings'], queryFn: api.settings });
  const premium = useQuery({ queryKey: ['premium-status'], queryFn: api.premiumStatus });
  const publicProfile = useQuery({ queryKey: ['public-profile'], queryFn: api.publicProfile });
  const [form, setForm] = useState<SettingsInput | null>(null);
  const [privacyForm, setPrivacyForm] = useState<PublicProfilePrivacyInput | null>(null);
  const save = useMutation({
    mutationFn: async (input: { settings: SettingsInput; privacy: PublicProfilePrivacyInput }) =>
      Promise.all([api.saveSettings(input.settings), api.savePublicProfilePrivacy(input.privacy)]),
    onSuccess: (_result, submitted) => {
      applyThemePreference(submitted.settings.theme);
      void queryClient.invalidateQueries({ queryKey: ['settings'] });
      void queryClient.invalidateQueries({ queryKey: ['public-profile'] });
    },
  });
  const searchState = useMutation({
    mutationFn: api.setSearchEnabled,
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ['settings'] });
    },
  });
  const searchEnabled = searchState.isPending
    ? Boolean(searchState.variables)
    : Boolean(settings.data?.search_enabled);
  const deleteAccount = useMutation({ mutationFn: api.deleteAccount });
  useEffect(() => {
    if (!settings.data) return;
    setForm({
      notificationsEnabled: Boolean(settings.data.notifications_enabled),
      telegramNotificationsEnabled: Boolean(settings.data.telegram_notifications_enabled),
      matchNotificationsEnabled: Boolean(settings.data.match_notifications_enabled),
      messageNotificationsEnabled: Boolean(settings.data.message_notifications_enabled),
      mentionNotificationsEnabled: Boolean(settings.data.mention_notifications_enabled),
      commentNotificationsEnabled: Boolean(settings.data.comment_notifications_enabled),
      referralNotificationsEnabled: Boolean(settings.data.referral_notifications_enabled),
      premiumNotificationsEnabled: Boolean(settings.data.premium_notifications_enabled),
      followerPostNotificationsEnabled: Boolean(settings.data.follower_post_notifications_enabled),
      followerQuestionnaireNotificationsEnabled: Boolean(
        settings.data.follower_questionnaire_notifications_enabled,
      ),
      privacyShieldEnabled: Boolean(settings.data.privacy_shield_enabled),
      showOnlineStatus: Boolean(settings.data.show_online_status),
      showPremiumBadge: Boolean(settings.data.show_premium_badge),
      hideDemographics: Boolean(settings.data.hide_demographics),
      chatArchiveVisible: Boolean(settings.data.chat_archive_visible),
      autoArchiveNewChats: Boolean(settings.data.auto_archive_new_chats),
      hideForwardAuthor: Boolean(settings.data.hide_forward_author),
      quickReaction: settings.data.quick_reaction || 'heart',
      theme: settings.data.theme,
    });
  }, [settings.data]);
  useEffect(() => {
    if (!publicProfile.data || privacyForm) return;
    setPrivacyForm({
      visibilityMode: publicProfile.data.visibility_mode ?? 'public',
      showFollowers: publicProfile.data.show_followers !== 0,
      showFollowing: publicProfile.data.show_following !== 0,
      showQuestionnaires: publicProfile.data.show_questionnaires !== 0,
      showPosts: publicProfile.data.show_posts !== 0,
      showLastSeen: publicProfile.data.show_last_seen !== 0,
      directMessagePolicy: publicProfile.data.direct_message_policy ?? 'everyone',
    });
  }, [privacyForm, publicProfile.data]);
  if (!form || !privacyForm) return <Skeleton className="h-96" />;
  type BooleanSettingKey = {
    [Key in keyof SettingsInput]: SettingsInput[Key] extends boolean ? Key : never;
  }[keyof SettingsInput];
  const notificationToggles: Array<[BooleanSettingKey, string]> = [
    ['notificationsEnabled', ru.miniApp.community.settingLabels[0]],
    ['telegramNotificationsEnabled', ru.miniApp.community.telegramNotificationSetting],
    ['matchNotificationsEnabled', ru.miniApp.community.settingLabels[1]],
    ['messageNotificationsEnabled', ru.miniApp.community.settingLabels[2]],
    ['mentionNotificationsEnabled', ru.miniApp.community.settingLabels[3]],
    ['commentNotificationsEnabled', ru.miniApp.community.settingLabels[4]],
    ['referralNotificationsEnabled', ru.miniApp.community.settingLabels[5]],
    ['premiumNotificationsEnabled', ru.miniApp.community.settingLabels[6]],
    ['followerPostNotificationsEnabled', ru.miniApp.community.followerPostNotifications],
    [
      'followerQuestionnaireNotificationsEnabled',
      ru.miniApp.community.followerQuestionnaireNotifications,
    ],
  ];
  const privacyToggles: Array<[BooleanSettingKey, string]> = [
    ['privacyShieldEnabled', ru.miniApp.community.settingLabels[7]],
    ['hideForwardAuthor', ru.miniApp.community.hideForwardAuthorSetting],
  ];
  const premiumToggles: Array<[BooleanSettingKey, string]> = [
    ['showOnlineStatus', ru.miniApp.community.settingLabels[8]],
    ['showPremiumBadge', ru.miniApp.community.settingLabels[9]],
    ['hideDemographics', ru.miniApp.community.settingLabels[10]],
    ['autoArchiveNewChats', ru.miniApp.community.autoArchiveNewChatsSetting],
  ];
  const setBooleanSetting = (key: BooleanSettingKey, value: boolean) =>
    setForm((current) => (current ? { ...current, [key]: value } : current));
  const premiumDays = premium.data?.endsAt
    ? Math.max(0, Math.ceil((new Date(premium.data.endsAt).getTime() - Date.now()) / 86_400_000))
    : 0;
  return (
    <div className="settings-page">
      <SectionTitle eyebrow={ru.miniApp.community.settingsEyebrow}>
        {ru.miniApp.community.settingsTitle}
      </SectionTitle>
      <div className="settings-grid">
        <Card className="settings-section">
          <header className="settings-section-header">
            <BellOff aria-hidden />
            <div>
              <strong>{ru.miniApp.community.notificationsSettingsTitle}</strong>
              <p>{ru.miniApp.community.notificationsSettingsDescription}</p>
            </div>
          </header>
          <div className="settings-list">
            {notificationToggles.map(([key, label]) => (
              <label className="setting-row" key={key}>
                <span>{label}</span>
                <input
                  type="checkbox"
                  checked={form[key]}
                  onChange={(event) => setBooleanSetting(key, event.target.checked)}
                />
              </label>
            ))}
          </div>
        </Card>

        <Card className="settings-section">
          <header className="settings-section-header">
            <ShieldCheck aria-hidden />
            <div>
              <strong>{ru.miniApp.community.privacySettingsTitle}</strong>
              <p>{ru.miniApp.community.privacySettingsDescription}</p>
            </div>
          </header>
          <div className="settings-list">
            {privacyToggles.map(([key, label]) => (
              <label className="setting-row" key={key}>
                <span>{label}</span>
                <input
                  type="checkbox"
                  checked={form[key]}
                  onChange={(event) => setBooleanSetting(key, event.target.checked)}
                />
              </label>
            ))}
            <label className="setting-row setting-choice-row" htmlFor="settings-profile-visibility">
              <span>{ru.miniApp.social.visibilityTitle}</span>
              <select
                id="settings-profile-visibility"
                className="input-field"
                value={privacyForm.visibilityMode}
                onChange={(event) =>
                  setPrivacyForm({
                    ...privacyForm,
                    visibilityMode: event.target.value as 'public' | 'following_only',
                  })
                }
              >
                <option value="public">{ru.miniApp.social.publicVisibility}</option>
                <option value="following_only" disabled={!premium.data?.premium}>
                  {ru.miniApp.social.followingOnlyVisibility}
                </option>
              </select>
            </label>
            <div className="settings-subsection-heading">
              <span>{ru.miniApp.social.sectionPrivacyTitle}</span>
              <button
                type="button"
                onClick={() =>
                  setPrivacyForm({
                    ...privacyForm,
                    showFollowers: false,
                    showFollowing: false,
                    showQuestionnaires: false,
                    showPosts: false,
                  })
                }
              >
                {ru.miniApp.social.hideAllSections}
              </button>
            </div>
            {(
              [
                ['showFollowers', ru.miniApp.social.followers],
                ['showFollowing', ru.miniApp.social.following],
                ['showQuestionnaires', ru.miniApp.social.activeQuestionnaires],
                ['showPosts', ru.miniApp.social.profilePosts],
                ['showLastSeen', ru.miniApp.social.showLastSeen],
              ] as const
            ).map(([key, label]) => (
              <label className="setting-row" key={key}>
                <span>{label}</span>
                <input
                  type="checkbox"
                  checked={privacyForm[key]}
                  onChange={(event) =>
                    setPrivacyForm({ ...privacyForm, [key]: event.target.checked })
                  }
                />
              </label>
            ))}
            <label className="setting-row setting-choice-row" htmlFor="settings-dm-policy">
              <span>{ru.miniApp.social.directMessagePolicyTitle}</span>
              <select
                id="settings-dm-policy"
                className="input-field"
                value={privacyForm.directMessagePolicy}
                onChange={(event) =>
                  setPrivacyForm({
                    ...privacyForm,
                    directMessagePolicy: event.target.value as 'everyone' | 'following_and_staff',
                  })
                }
              >
                <option value="everyone">{ru.miniApp.social.directMessagesEveryone}</option>
                <option value="following_and_staff">
                  {ru.miniApp.social.directMessagesFollowingAndStaff}
                </option>
              </select>
            </label>
            {!premium.data?.premium ? (
              <p className="settings-hint">{ru.miniApp.social.visibilityPremiumHint}</p>
            ) : null}
          </div>
        </Card>

        <Card className="settings-section">
          <header className="settings-section-header">
            <MessageCircle aria-hidden />
            <div>
              <strong>{ru.miniApp.community.chatsSettingsTitle}</strong>
              <p>{ru.miniApp.community.chatsSettingsDescription}</p>
            </div>
          </header>
          <div className="settings-list">
            <label className="setting-row">
              <span>{ru.miniApp.community.archiveVisibleSetting}</span>
              <input
                type="checkbox"
                checked={form.chatArchiveVisible}
                onChange={(event) => setBooleanSetting('chatArchiveVisible', event.target.checked)}
              />
            </label>
            <label className="setting-row setting-choice-row">
              <span>{ru.miniApp.community.quickReactionSetting}</span>
              <select
                aria-label={ru.miniApp.community.quickReactionSetting}
                className="input-field"
                value={form.quickReaction}
                onChange={(event) => setForm({ ...form, quickReaction: event.target.value })}
              >
                {Object.entries(ru.miniApp.community.reactionNames).map(([value, label]) => (
                  <option key={value} value={value}>
                    {label}
                  </option>
                ))}
              </select>
            </label>
            <label className="setting-row setting-choice-row">
              <span>{ru.miniApp.community.theme}</span>
              <select
                aria-label={ru.miniApp.community.theme}
                className="input-field"
                value={form.theme}
                onChange={(event) => {
                  const theme = event.target.value as SettingsInput['theme'];
                  setForm({ ...form, theme });
                  applyThemePreference(theme);
                }}
              >
                <option value="telegram">Telegram</option>
                <option value="light">{ru.miniApp.community.lightTheme}</option>
                <option value="dark">{ru.miniApp.community.darkTheme}</option>
              </select>
            </label>
          </div>
        </Card>

        <Card className="settings-section settings-section-premium">
          <header className="settings-section-header">
            <Crown aria-hidden />
            <div>
              <strong>{ru.miniApp.community.premiumSettingsTitle}</strong>
              <p>{ru.miniApp.community.premiumSettingsDescription}</p>
            </div>
          </header>
          <div className="settings-premium-status">
            <span>
              {premium.data?.premium
                ? ru.miniApp.community.premiumSettingsActive(premiumDays)
                : ru.miniApp.community.premiumSettingsInactive}
            </span>
            <Link href="/premium">{ru.miniApp.community.openPremiumSettings}</Link>
          </div>
          <div className="settings-list">
            {premiumToggles.map(([key, label]) => (
              <label className="setting-row" key={key}>
                <span>{label}</span>
                <input
                  type="checkbox"
                  checked={form[key]}
                  disabled={!premium.data?.premium}
                  onChange={(event) => setBooleanSetting(key, event.target.checked)}
                />
              </label>
            ))}
          </div>
          {!premium.data?.premium ? (
            <p className="settings-hint">{ru.miniApp.community.premiumPrivacyOnly}</p>
          ) : null}
        </Card>

        <Card className="settings-section">
          <header className="settings-section-header">
            <Search aria-hidden />
            <div>
              <strong>{ru.miniApp.community.searchSettingsTitle}</strong>
              <p>{ru.miniApp.community.searchSettingsDescription}</p>
            </div>
          </header>
          <div
            className={`search-state-banner${searchEnabled ? ' is-live' : ' is-paused'}`}
            role="status"
          >
            <span className="search-state-dot" aria-hidden />
            <span>
              {searchEnabled
                ? ru.miniApp.community.searchStateActive
                : ru.miniApp.community.searchStatePaused}
            </span>
          </div>
          <div className="settings-segmented" role="group">
            <button
              type="button"
              className={`settings-segment${searchEnabled ? '' : ' is-selected'}`}
              aria-pressed={!searchEnabled}
              disabled={searchState.isPending}
              onClick={() => searchState.mutate(false)}
            >
              {ru.miniApp.community.pauseSearch}
            </button>
            <button
              type="button"
              className={`settings-segment${searchEnabled ? ' is-selected' : ''}`}
              aria-pressed={searchEnabled}
              disabled={searchState.isPending}
              onClick={() => searchState.mutate(true)}
            >
              {ru.miniApp.community.resumeSearch}
            </button>
          </div>
          {searchState.isError ? (
            <p className="settings-hint settings-hint-error">
              {ru.miniApp.community.searchStateFailed}
            </p>
          ) : null}
        </Card>
      </div>
      <div className="settings-save-bar">
        <Button
          onClick={() => save.mutate({ settings: form, privacy: privacyForm })}
          loading={save.isPending}
        >
          <Save className="h-4 w-4" /> {ru.miniApp.community.save}
        </Button>
      </div>
      {save.isSuccess ? (
        <p className="mt-3 text-sm text-soft">{ru.miniApp.community.settingsSaved}</p>
      ) : null}
      <Card className="mt-4 settings-info-card">
        <div className="flex gap-3">
          <ShieldCheck className="text-lilac" />
          <div>
            <strong>{ru.miniApp.community.anonymityEnabled}</strong>
            <p className="mt-1 text-sm text-muted">{ru.miniApp.community.anonymityDescription}</p>
          </div>
        </div>
      </Card>
      <Card className="mt-4 border border-red-400/20 p-5">
        <strong>{ru.miniApp.community.deleteAccountTitle}</strong>
        <p className="mt-1 text-sm text-muted">{ru.miniApp.community.deleteAccountDescription}</p>
        <Button
          className="mt-3"
          variant="secondary"
          loading={deleteAccount.isPending}
          disabled={deleteAccount.isSuccess}
          onClick={() => {
            const confirmation = window.prompt(ru.miniApp.community.deleteAccountPrompt);
            if (confirmation === ru.api.deleteConfirmation) deleteAccount.mutate();
          }}
        >
          {ru.miniApp.community.deleteAccountButton}
        </Button>
        {deleteAccount.isSuccess ? (
          <p className="mt-3 text-sm text-soft">{ru.miniApp.community.deleteAccountDone}</p>
        ) : null}
      </Card>
      <p className="mt-6 text-center text-xs text-muted">{ru.miniApp.attribution}</p>
    </div>
  );
}
