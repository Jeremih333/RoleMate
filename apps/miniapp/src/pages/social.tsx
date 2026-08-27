import { useEffect, useRef, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import type { QueryClient } from '@tanstack/react-query';
import {
  Ban,
  ChevronDown,
  ChevronLeft,
  ChevronRight,
  FileText,
  Flag,
  Heart,
  Eye,
  Info,
  ImagePlus,
  MessageCircle,
  Music2,
  MoreVertical,
  Pencil,
  Plus,
  Power,
  Save,
  Share2,
  Shield,
  Settings2,
  Star,
  ThumbsDown,
  Trash2,
  UserMinus,
  UserPlus,
  X,
} from 'lucide-react';
import { ru } from '@rolemate/shared';
import {
  api,
  type PostComment,
  type PostEngagementUser,
  type ProfileMedia,
  type PublicUserProfile,
  type SocialPost,
} from '../api.js';
import { ProfileAvatar } from '../components/profile-avatar.js';
import { ShareToChatsDialog } from '../components/share-to-chats.js';
import {
  parseAvatarMediaItems,
  ProfileAvatarGallery,
} from '../components/profile-avatar-gallery.js';
import { SwipePlaylist, type PlaylistTrack } from '../components/music-player.js';
import { ProfileMarkdown } from '../components/markdown.js';
import { ExpandableText } from '../components/expandable-text.js';
import { VerificationBadge } from '../components/verification-badge.js';
import {
  Button,
  Card,
  ConfirmDialog,
  EmptyState,
  InfoDialog,
  SectionTitle,
  Skeleton,
} from '../components/ui.js';
import { getTelegram } from '../telegram.js';
import { useViewerTime } from '../components/viewer-time.js';
import { ProfileCard } from './search.js';
import { Link, useLocation, useRoute } from 'wouter';

const POST_LIST_KEYS = new Set(['posts', 'own-posts', 'public-profile-posts']);

/** Post lists live under several query keys; a change to one post must refresh them all. */
function invalidatePostLists(queryClient: QueryClient) {
  void queryClient.invalidateQueries({
    predicate: (query) => POST_LIST_KEYS.has(String(query.queryKey[0])),
  });
}

function formatMetric(value: number | undefined, exact: boolean): string {
  const count = Math.max(0, Number(value ?? 0));
  if (!exact && count >= 10_000) return '10 000+';
  return new Intl.NumberFormat('ru-RU').format(count);
}

export function PublicProfilePage() {
  const queryClient = useQueryClient();
  const profile = useQuery({
    queryKey: ['public-profile'],
    queryFn: api.publicProfile,
    refetchOnMount: 'always',
    refetchOnWindowFocus: 'always',
    refetchInterval: 30_000,
  });
  const media = useQuery({ queryKey: ['profile-media'], queryFn: api.profileMedia });
  const ownPosts = useQuery({ queryKey: ['own-posts'], queryFn: api.ownPosts });
  const usernames = useQuery({
    queryKey: ['public-profile-usernames'],
    queryFn: api.publicProfileUsernames,
  });
  const [displayName, setDisplayName] = useState('');
  const [bio, setBio] = useState('');
  const [avatarMediaIds, setAvatarMediaIds] = useState<string[]>([]);
  const [avatarPickerIndex, setAvatarPickerIndex] = useState(0);
  const [botUploadNotice, setBotUploadNotice] = useState(false);
  const [profileIdOpen, setProfileIdOpen] = useState(false);
  const [editing, setEditing] = useState(false);
  const [confirmEditorClose, setConfirmEditorClose] = useState(false);
  const [initialized, setInitialized] = useState(false);
  const [username, setUsername] = useState('');
  const [usernameInitialized, setUsernameInitialized] = useState(false);
  const [profileMediaToDelete, setProfileMediaToDelete] = useState<string | null>(null);
  const [openPeopleSection, setOpenPeopleSection] = useState<'followers' | 'following' | null>(
    null,
  );
  const editorRef = useRef<HTMLDivElement>(null);
  const displayNameRef = useRef<HTMLInputElement>(null);
  const avatarSwipeStart = useRef<number | null>(null);
  const profilePeople = useQuery({
    queryKey: ['own-profile-people', openPeopleSection, profile.data?.id],
    queryFn: () =>
      openPeopleSection === 'followers'
        ? api.profileFollowers(profile.data?.id ?? '')
        : api.profileFollowing(profile.data?.id ?? ''),
    enabled: Boolean(openPeopleSection && profile.data?.id),
  });
  useEffect(() => {
    if (!profile.data || initialized) return;
    setDisplayName(profile.data.display_name);
    setBio(profile.data.bio);
    setAvatarMediaIds(
      parseAvatarMediaItems(
        profile.data.avatar_media_items,
        profile.data.avatar_media_id,
        profile.data.avatar_render_mode,
      ).map((item) => item.id),
    );
    setInitialized(true);
  }, [initialized, profile.data]);
  useEffect(() => {
    if (usernameInitialized || !usernames.data) return;
    setUsername(usernames.data[0]?.username ?? '');
    setUsernameInitialized(true);
  }, [usernameInitialized, usernames.data]);
  const save = useMutation({
    mutationFn: async () => {
      await api.savePublicProfile({
        displayName,
        bio,
        avatarMediaIds,
        visibilityMode: profile.data?.visibility_mode ?? 'public',
        showFollowers: profile.data?.show_followers !== 0,
        showFollowing: profile.data?.show_following !== 0,
        showQuestionnaires: profile.data?.show_questionnaires !== 0,
        showPosts: profile.data?.show_posts !== 0,
        showLastSeen: profile.data?.show_last_seen !== 0,
        directMessagePolicy: profile.data?.direct_message_policy ?? 'everyone',
      });
      // A username typed but never claimed used to be silently dropped when the
      // editor closed, so saving the profile claims it too.
      const typed = username.trim().replace(/^@/, '').toLowerCase();
      const current = (usernames.data?.[0]?.username ?? '').toLowerCase();
      if (typed && typed !== current) await api.claimPublicProfileUsername(typed);
    },
    onSuccess: () => {
      setEditing(false);
      setUsernameInitialized(false);
      void queryClient.invalidateQueries({ queryKey: ['public-profile'] });
      void queryClient.invalidateQueries({ queryKey: ['public-profile-usernames'] });
      void queryClient.invalidateQueries({ queryKey: ['own-posts'] });
    },
  });
  const claimUsername = useMutation({
    mutationFn: () =>
      api.claimPublicProfileUsername(username.trim().replace(/^@/, '').toLowerCase()),
    onSuccess: () => {
      setUsernameInitialized(false);
      void queryClient.invalidateQueries({ queryKey: ['public-profile-usernames'] });
      void queryClient.invalidateQueries({ queryKey: ['public-profile'] });
    },
  });
  const releaseUsername = useMutation({
    mutationFn: (value: string) => api.releasePublicProfileUsername(value),
    onSuccess: () => {
      setUsername('');
      setUsernameInitialized(false);
      void queryClient.invalidateQueries({ queryKey: ['public-profile-usernames'] });
      void queryClient.invalidateQueries({ queryKey: ['public-profile'] });
    },
  });
  const deleteProfileMedia = useMutation({
    mutationFn: api.deleteProfileMedia,
    onSuccess: (_, mediaId) => {
      setAvatarMediaIds((ids) => ids.filter((id) => id !== mediaId));
      setProfileMediaToDelete(null);
      queryClient.setQueryData<PublicUserProfile>(['public-profile'], (current) => {
        if (!current) return current;
        const remaining = parseAvatarMediaItems(
          current.avatar_media_items,
          current.avatar_media_id,
          current.avatar_render_mode,
        ).filter((item) => item.id !== mediaId);
        const nextAvatar = remaining[0];
        return {
          ...current,
          avatar_media_id: nextAvatar?.id ?? null,
          avatar_render_mode: nextAvatar?.render_mode ?? null,
          avatar_media_items: JSON.stringify(remaining),
        };
      });
      queryClient.setQueryData<ProfileMedia[]>(['profile-media'], (current) =>
        current?.filter((item) => item.id !== mediaId),
      );
      void queryClient.invalidateQueries({ queryKey: ['profile-media'] });
      void queryClient.invalidateQueries({ queryKey: ['public-profile'] });
      void queryClient.invalidateQueries({ queryKey: ['profile'] });
      void queryClient.invalidateQueries({ queryKey: ['questionnaires'] });
      void queryClient.invalidateQueries({ queryKey: ['search'] });
    },
  });
  const reorderProfileAudio = useMutation({
    mutationFn: api.reorderProfileAudio,
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ['profile-media'] });
      void queryClient.invalidateQueries({ queryKey: ['public-profile'] });
    },
  });
  const avatarChoices = (media.data ?? []).filter(
    (item) =>
      item.moderation_status === 'approved' &&
      (item.media_type === 'photo' || item.media_type === 'video'),
  );
  useEffect(() => {
    setAvatarPickerIndex((index) =>
      avatarChoices.length ? Math.min(index, avatarChoices.length - 1) : 0,
    );
  }, [avatarChoices.length]);
  useEffect(() => {
    if (!editing) return;
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    return () => {
      document.body.style.overflow = previousOverflow;
    };
  }, [editing]);
  useEffect(() => {
    if (!botUploadNotice) return;
    const timeout = window.setTimeout(() => setBotUploadNotice(false), 3_500);
    return () => window.clearTimeout(timeout);
  }, [botUploadNotice]);
  // Media is uploaded in the bot chat, so anything sent while the mini app was
  // in the background has to be picked up the moment the user comes back.
  useEffect(() => {
    const refresh = () => {
      if (document.visibilityState !== 'visible') return;
      void queryClient.invalidateQueries({ queryKey: ['profile-media'] });
      void queryClient.invalidateQueries({ queryKey: ['public-profile'] });
    };
    document.addEventListener('visibilitychange', refresh);
    window.addEventListener('focus', refresh);
    return () => {
      document.removeEventListener('visibilitychange', refresh);
      window.removeEventListener('focus', refresh);
    };
  }, [queryClient]);
  if (profile.isLoading) return <Skeleton className="h-80" />;
  if (!profile.data) return null;
  const avatarItems = parseAvatarMediaItems(
    profile.data.avatar_media_items,
    profile.data.avatar_media_id,
    profile.data.avatar_render_mode,
  );
  const currentAvatarChoice = avatarChoices[avatarPickerIndex];
  const aliases = parseStringArray(profile.data.usernames ?? '[]');
  const featuredAudio = parseFeaturedAudio(profile.data.featured_audio_items ?? '[]');
  const openBot = (parameter: 'profile_photo' | 'profile_music' | 'create_post') => {
    setBotUploadNotice(true);
    const link = `https://t.me/r0lemate_bot?start=${parameter}`;
    const telegram = getTelegram();
    if (telegram) telegram.openTelegramLink(link);
    else window.open(link, '_blank', 'noopener,noreferrer');
  };
  const resetProfileDraft = () => {
    setDisplayName(profile.data.display_name);
    setBio(profile.data.bio);
    setAvatarMediaIds(avatarItems.map((item) => item.id));
    setUsername(usernames.data?.[0]?.username ?? '');
    save.reset();
    claimUsername.reset();
    releaseUsername.reset();
  };
  const openEditor = () => {
    resetProfileDraft();
    setEditing(true);
    window.requestAnimationFrame(() => {
      window.setTimeout(() => displayNameRef.current?.focus({ preventScroll: true }), 350);
    });
  };
  const cancelProfileEditing = () => {
    resetProfileDraft();
    setEditing(false);
    setConfirmEditorClose(false);
  };
  const profileDraftDirty =
    displayName !== profile.data.display_name ||
    bio !== profile.data.bio ||
    JSON.stringify(avatarMediaIds) !== JSON.stringify(avatarItems.map((item) => item.id)) ||
    username !== (usernames.data?.[0]?.username ?? '');
  const requestEditorClose = () => {
    if (profileDraftDirty) setConfirmEditorClose(true);
    else cancelProfileEditing();
  };
  return (
    <div>
      <SectionTitle eyebrow={ru.miniApp.social.profileEyebrow}>
        {ru.miniApp.social.profileTitle}
      </SectionTitle>
      <Card className="public-profile-own-card p-5">
        <div className="public-profile-header">
          <ProfileAvatarGallery
            items={avatarItems}
            name={displayName}
            className="profile-avatar-large"
          />
          <div className="public-profile-identity">
            <strong className="flex items-center gap-1 break-words">
              {displayName}
              <VerificationBadge
                kind={profile.data.verification_kind}
                premium={profile.data.has_premium}
              />
            </strong>
            <ProfileUsernamesLine aliases={aliases} />
          </div>
          <button
            className="profile-id-button"
            type="button"
            aria-label={ru.miniApp.social.showInternalId}
            onClick={() => setProfileIdOpen(true)}
          >
            <Info aria-hidden />
          </button>
        </div>
        <div className="profile-about-block">
          <strong>{ru.miniApp.social.aboutLabel}</strong>
          <p>{profile.data.bio || ru.miniApp.social.bioEmpty}</p>
        </div>
        {featuredAudio.length ? (
          <SwipePlaylist
            emptyLabel={ru.miniApp.search.trackUnknown}
            onReorder={(trackIds) =>
              reorderProfileAudio.mutateAsync(trackIds).then(() => undefined)
            }
            tracks={featuredAudio.slice(0, 10).map<PlaylistTrack>((track) => ({
              id: track.id,
              src: `/api/profile-media/${track.id}`,
              title: track.track_title || ru.miniApp.search.trackUnknown,
              performer: track.track_performer || ru.miniApp.search.performerUnknown,
              ...(track.file_size_bytes !== undefined
                ? { fileSizeBytes: track.file_size_bytes }
                : {}),
              ...(track.has_thumbnail
                ? { coverSrc: `/api/profile-media/${track.id}/thumbnail` }
                : {}),
            }))}
          />
        ) : null}
        {profile.data.owner_liked ? (
          <p className="owner-blessing">{ru.miniApp.social.ownerBlessing}</p>
        ) : null}
        <div className="profile-section-links mt-4">
          <button
            className="status-pill"
            type="button"
            onClick={() =>
              setOpenPeopleSection((value) => (value === 'followers' ? null : 'followers'))
            }
          >
            {ru.miniApp.social.followers}: {profile.data.followers_count ?? 0}
          </button>
          <button
            className="status-pill"
            type="button"
            onClick={() =>
              setOpenPeopleSection((value) => (value === 'following' ? null : 'following'))
            }
          >
            {ru.miniApp.social.following}: {profile.data.following_count ?? 0}
          </button>
          <button
            className="status-pill"
            type="button"
            onClick={() =>
              document
                .getElementById('own-profile-questionnaires')
                ?.scrollIntoView({ behavior: 'smooth' })
            }
          >
            {ru.miniApp.social.questionnaireCount(profile.data.questionnaire_count)}
          </button>
          <button
            className="status-pill"
            type="button"
            onClick={() =>
              document.getElementById('own-profile-posts')?.scrollIntoView({ behavior: 'smooth' })
            }
          >
            {ru.miniApp.social.postCount(profile.data.post_count)}
          </button>
        </div>
        {openPeopleSection ? (
          <ProfilePeopleList
            title={
              openPeopleSection === 'followers'
                ? ru.miniApp.social.followers
                : ru.miniApp.social.following
            }
            loading={profilePeople.isLoading}
            people={profilePeople.data ?? []}
          />
        ) : null}
        {profile.data.moderation_status === 'blocked' ? (
          <div className="error-box mt-4">
            {ru.miniApp.social.profileBlocked}
            {profile.data.moderation_reason ? `: ${profile.data.moderation_reason}` : ''}
          </div>
        ) : null}
        <Button
          className="public-profile-edit-button mt-5"
          variant="secondary"
          aria-expanded={editing}
          aria-controls="public-profile-editor"
          onClick={openEditor}
        >
          <Pencil className="h-4 w-4" /> {ru.miniApp.social.editProfile}
        </Button>
        {editing ? (
          <div id="public-profile-editor" ref={editorRef} className="public-profile-editor">
            <header className="public-profile-editor-header">
              <strong>{ru.miniApp.social.editProfile}</strong>
              <button
                type="button"
                aria-label={ru.miniApp.social.cancelEditing}
                onClick={requestEditorClose}
              >
                <X aria-hidden />
              </button>
            </header>
            <div className="public-profile-editor-content">
              <p className="mb-5 text-sm leading-relaxed text-muted">
                {ru.miniApp.social.profileDescription}
              </p>
              <label className="field-label" htmlFor="public-display-name">
                {ru.miniApp.social.displayName}
              </label>
              <input
                id="public-display-name"
                ref={displayNameRef}
                className="input"
                maxLength={80}
                value={displayName}
                onChange={(event) => setDisplayName(event.target.value)}
              />
              <label className="field-label mt-4" htmlFor="public-bio">
                {ru.miniApp.social.bio}
              </label>
              <textarea
                id="public-bio"
                className="input min-h-32"
                maxLength={1500}
                value={bio}
                onChange={(event) => setBio(event.target.value)}
              />
              <div className="mt-5 rounded-2xl border border-white/10 p-4">
                <strong>{ru.miniApp.social.usernameTitle}</strong>
                <p className="mt-1 text-sm text-muted">{ru.miniApp.social.usernameDescription}</p>
                <div className="mt-3 flex min-w-0 flex-col gap-2 sm:flex-row">
                  <input
                    className="input min-w-0 flex-1"
                    value={username}
                    maxLength={33}
                    placeholder={ru.miniApp.social.usernamePlaceholder}
                    onChange={(event) => setUsername(event.target.value)}
                  />
                  <Button
                    variant="secondary"
                    disabled={username.trim().replace(/^@/, '').length < 5}
                    loading={claimUsername.isPending}
                    onClick={() => claimUsername.mutate()}
                  >
                    {ru.miniApp.social.usernameClaim}
                  </Button>
                </div>
                {usernames.data?.[0] ? (
                  <Button
                    className="mt-2"
                    variant="ghost"
                    loading={releaseUsername.isPending}
                    onClick={() => releaseUsername.mutate(usernames.data[0]!.username)}
                  >
                    {ru.miniApp.social.usernameRelease}
                  </Button>
                ) : null}
                {claimUsername.isError ? (
                  <div className="error-box mt-3">{claimUsername.error.message}</div>
                ) : null}
              </div>
              <div className="mt-5">
                <strong>{ru.miniApp.social.avatarTitle}</strong>
                <p className="mt-1 text-sm text-muted">{ru.miniApp.social.avatarDescription}</p>
                {currentAvatarChoice ? (
                  <div className="avatar-media-selector mt-3">
                    <div
                      className="avatar-media-selector-stage"
                      onTouchStart={(event) => {
                        avatarSwipeStart.current = event.touches[0]?.clientX ?? null;
                      }}
                      onTouchEnd={(event) => {
                        const end = event.changedTouches[0]?.clientX;
                        if (avatarSwipeStart.current === null || end === undefined) return;
                        const distance = end - avatarSwipeStart.current;
                        avatarSwipeStart.current = null;
                        if (Math.abs(distance) < 45) return;
                        setAvatarPickerIndex((index) =>
                          distance > 0
                            ? (index - 1 + avatarChoices.length) % avatarChoices.length
                            : (index + 1) % avatarChoices.length,
                        );
                      }}
                    >
                      {currentAvatarChoice.media_type === 'video' ? (
                        <video
                          key={currentAvatarChoice.id}
                          src={`/api/profile-media/${currentAvatarChoice.id}`}
                          muted
                          loop
                          autoPlay
                          playsInline
                        />
                      ) : (
                        <img src={`/api/profile-media/${currentAvatarChoice.id}`} alt="" />
                      )}
                      {avatarMediaIds.includes(currentAvatarChoice.id) ? (
                        <span className="profile-media-picker-number">
                          {avatarMediaIds.indexOf(currentAvatarChoice.id) + 1}
                        </span>
                      ) : null}
                      {avatarChoices.length > 1 ? (
                        <>
                          <button
                            className="avatar-media-selector-arrow is-previous"
                            type="button"
                            aria-label={ru.miniApp.social.previousAvatar}
                            onClick={() =>
                              setAvatarPickerIndex(
                                (index) =>
                                  (index - 1 + avatarChoices.length) % avatarChoices.length,
                              )
                            }
                          >
                            <ChevronLeft aria-hidden />
                          </button>
                          <button
                            className="avatar-media-selector-arrow is-next"
                            type="button"
                            aria-label={ru.miniApp.social.nextAvatar}
                            onClick={() =>
                              setAvatarPickerIndex((index) => (index + 1) % avatarChoices.length)
                            }
                          >
                            <ChevronRight aria-hidden />
                          </button>
                        </>
                      ) : null}
                    </div>
                    <div className="avatar-media-selector-toolbar">
                      <span>
                        {ru.miniApp.social.avatarPosition(
                          avatarPickerIndex + 1,
                          avatarChoices.length,
                        )}
                      </span>
                      <Button
                        variant={
                          avatarMediaIds.includes(currentAvatarChoice.id) ? 'secondary' : 'primary'
                        }
                        disabled={
                          !avatarMediaIds.includes(currentAvatarChoice.id) &&
                          avatarMediaIds.length >= 8
                        }
                        onClick={() =>
                          setAvatarMediaIds((ids) =>
                            ids.includes(currentAvatarChoice.id)
                              ? ids.filter((id) => id !== currentAvatarChoice.id)
                              : [...ids, currentAvatarChoice.id],
                          )
                        }
                      >
                        {avatarMediaIds.includes(currentAvatarChoice.id)
                          ? ru.miniApp.social.removeAvatarMedia
                          : ru.miniApp.social.addAvatarMedia}
                      </Button>
                    </div>
                    <div className="avatar-media-selector-rail">
                      {avatarChoices.map((item, index) => (
                        <button
                          type="button"
                          className={index === avatarPickerIndex ? 'is-current' : ''}
                          key={item.id}
                          aria-label={ru.miniApp.social.avatarPosition(
                            index + 1,
                            avatarChoices.length,
                          )}
                          onClick={() => setAvatarPickerIndex(index)}
                        >
                          {item.media_type === 'video' ? (
                            <video
                              src={`/api/profile-media/${item.id}`}
                              muted
                              playsInline
                              preload="metadata"
                            />
                          ) : (
                            <img src={`/api/profile-media/${item.id}`} alt="" />
                          )}
                          {avatarMediaIds.includes(item.id) ? (
                            <span>{avatarMediaIds.indexOf(item.id) + 1}</span>
                          ) : null}
                        </button>
                      ))}
                    </div>
                    <p className="text-xs text-muted">
                      {ru.miniApp.social.selectedAvatarMedia(avatarMediaIds.length)}
                    </p>
                  </div>
                ) : null}
                <div className="mt-3 flex flex-wrap gap-2">
                  <Button variant="secondary" onClick={() => openBot('profile_photo')}>
                    <ImagePlus className="h-4 w-4" /> {ru.miniApp.social.uploadVisualMedia}
                  </Button>
                  {avatarMediaIds.length ? (
                    <Button variant="ghost" onClick={() => setAvatarMediaIds([])}>
                      {ru.miniApp.social.removeAvatar}
                    </Button>
                  ) : null}
                </div>
              </div>
              <div className="profile-upload-actions mt-5">
                <Button variant="secondary" onClick={() => openBot('profile_music')}>
                  <Music2 className="h-4 w-4" /> {ru.miniApp.profile.uploadMusic}
                </Button>
              </div>
              {media.data?.length ? (
                <div className="mt-5">
                  <strong>{ru.miniApp.profile.mediaTitle}</strong>
                  <div className="post-media-manager mt-3">
                    {media.data.map((item, index) => (
                      <div className="post-media-manager-item" key={item.id}>
                        <FileText aria-hidden />
                        <span>
                          <strong>
                            {item.track_title || `${ru.miniApp.profile.mediaTitle} ${index + 1}`}
                          </strong>
                          <small>
                            {item.track_performer
                              ? `${item.track_performer} · ${item.media_type}`
                              : item.media_type}
                          </small>
                        </span>
                        <button
                          type="button"
                          aria-label={ru.miniApp.profile.deleteMedia}
                          onClick={() => setProfileMediaToDelete(item.id)}
                        >
                          <Trash2 aria-hidden />
                        </button>
                      </div>
                    ))}
                  </div>
                </div>
              ) : null}
              <div className="mt-5 flex flex-wrap gap-2">
                <Button
                  loading={save.isPending}
                  disabled={displayName.trim().length < 2}
                  onClick={() => save.mutate()}
                >
                  <Save className="h-4 w-4" /> {ru.miniApp.social.save}
                </Button>
                <Button variant="secondary" onClick={requestEditorClose}>
                  <X className="h-4 w-4" /> {ru.miniApp.social.cancelEditing}
                </Button>
              </div>
              {save.isSuccess ? (
                <p className="mt-3 text-sm text-emerald-400">{ru.miniApp.social.saved}</p>
              ) : null}
              {save.isError ? <div className="error-box mt-3">{save.error.message}</div> : null}
            </div>
          </div>
        ) : null}
        <ConfirmDialog
          open={confirmEditorClose}
          title={ru.miniApp.social.unsavedProfileTitle}
          description={ru.miniApp.social.unsavedProfileDescription}
          confirmLabel={ru.miniApp.social.discardProfileChanges}
          cancelLabel={ru.miniApp.social.continueProfileEditing}
          onConfirm={cancelProfileEditing}
          onCancel={() => setConfirmEditorClose(false)}
        />
      </Card>
      <InfoDialog
        open={profileIdOpen}
        title={ru.miniApp.social.internalId}
        description={profile.data.id}
        closeLabel={ru.miniApp.social.closeInfo}
        onClose={() => setProfileIdOpen(false)}
      />
      {botUploadNotice ? (
        <div className="profile-upload-toast" role="status" aria-live="polite">
          {ru.miniApp.social.botMediaUploadNotice}
        </div>
      ) : null}
      {deleteProfileMedia.isError ? (
        <div className="error-box" role="alert">
          {deleteProfileMedia.error.message}
        </div>
      ) : null}
      <div id="own-profile-questionnaires">
        <QuestionnairesPage />
      </div>
      <div id="own-profile-posts" className="own-profile-posts-section">
        <SectionTitle
          eyebrow={ru.miniApp.social.ownPostsEyebrow}
          action={
            <Button variant="secondary" onClick={() => openBot('create_post')}>
              <Plus className="h-4 w-4" /> {ru.miniApp.social.createPost}
            </Button>
          }
        >
          {ru.miniApp.social.ownPostsTitle}
        </SectionTitle>
        <div className="space-y-4">
          {ownPosts.data?.map((post) => (
            <PostCard key={post.id} post={post} own />
          ))}
          {!ownPosts.isLoading && !ownPosts.data?.length ? (
            <EmptyState
              icon={<FileText className="h-7 w-7" />}
              title={ru.miniApp.social.ownPostsTitle}
              description={ru.miniApp.social.ownPostsEmpty}
            />
          ) : null}
          {ownPosts.isError ? <div className="error-box">{ownPosts.error.message}</div> : null}
        </div>
      </div>
      <ConfirmDialog
        open={Boolean(profileMediaToDelete)}
        title={ru.miniApp.profile.deleteMediaConfirmTitle}
        description={ru.miniApp.profile.deleteMediaConfirmDescription}
        confirmLabel={ru.miniApp.profile.deleteMedia}
        cancelLabel={ru.miniApp.profile.cancelMediaDeletion}
        loading={deleteProfileMedia.isPending}
        onCancel={() => setProfileMediaToDelete(null)}
        onConfirm={() => {
          if (profileMediaToDelete) deleteProfileMedia.mutate(profileMediaToDelete);
        }}
      />
    </div>
  );
}

function parseStringArray(value: string): string[] {
  try {
    const parsed: unknown = JSON.parse(value);
    return Array.isArray(parsed)
      ? parsed.filter((item): item is string => typeof item === 'string')
      : [];
  } catch {
    return [];
  }
}

function parseCommaList(value: string): string[] {
  return [
    ...new Set(
      value
        .split(',')
        .map((item) => item.trim())
        .filter(Boolean),
    ),
  ];
}

function parseFeaturedAudio(value: string): Array<{
  id: string;
  track_title: string | null;
  track_performer: string | null;
  has_thumbnail: number;
  file_size_bytes?: number | null;
}> {
  try {
    const parsed: unknown = JSON.parse(value);
    if (!Array.isArray(parsed)) return [];
    return parsed.filter(
      (
        item,
      ): item is {
        id: string;
        track_title: string | null;
        track_performer: string | null;
        has_thumbnail: number;
        file_size_bytes?: number | null;
      } =>
        typeof item === 'object' &&
        item !== null &&
        typeof (item as Record<string, unknown>).id === 'string',
    );
  } catch {
    return [];
  }
}

function ProfileUsernamesLine({ aliases }: { aliases: string[] }) {
  const [primary, ...additional] = aliases;
  if (!primary) return null;
  return (
    <p className="profile-usernames-line">
      <Link href={`/u/${encodeURIComponent(primary)}`}>@{primary}</Link>
      {additional.length ? (
        <>
          {ru.miniApp.social.additionalUsernames}{' '}
          {additional.map((alias, index) => (
            <span key={alias}>
              {index > 0 ? ', ' : ''}
              <Link href={`/u/${encodeURIComponent(alias)}`}>@{alias}</Link>
            </span>
          ))}
        </>
      ) : null}
    </p>
  );
}

function ProfilePeopleList({
  title,
  loading,
  people,
}: {
  title: string;
  loading: boolean;
  people: PublicUserProfile[];
}) {
  return (
    <div className="profile-people-panel mt-4">
      <strong>{title}</strong>
      {loading ? <Skeleton className="mt-3 h-16" /> : null}
      {!loading && !people.length ? (
        <p className="mt-2 text-sm text-muted">{ru.miniApp.social.peopleListEmpty}</p>
      ) : null}
      {people.map((person) => (
        <Link className="profile-people-row" href={`/profiles/${person.id}`} key={person.id}>
          <ProfileAvatar
            mediaId={person.avatar_media_id}
            renderMode={person.avatar_render_mode}
            name={person.display_name}
          />
          <span>
            {person.display_name}
            <VerificationBadge kind={person.verification_kind} premium={person.has_premium} />
          </span>
          <ChevronRight aria-hidden />
        </Link>
      ))}
    </div>
  );
}

export function PublicProfileViewerPage() {
  const queryClient = useQueryClient();
  const [, navigate] = useLocation();
  const [idMatch, idParams] = useRoute('/profiles/:userId');
  const [, usernameParams] = useRoute('/u/:username');
  const userId = idMatch ? idParams?.userId : undefined;
  const username = idMatch ? undefined : usernameParams?.username;
  const [blockConfirmOpen, setBlockConfirmOpen] = useState(false);
  const [reportSent, setReportSent] = useState(false);
  const [profileActionsOpen, setProfileActionsOpen] = useState(false);
  const [profileIdOpen, setProfileIdOpen] = useState(false);
  const [mediaAccessVersion, setMediaAccessVersion] = useState(0);
  const [openPeopleSection, setOpenPeopleSection] = useState<'followers' | 'following' | null>(
    null,
  );
  const profile = useQuery({
    queryKey: ['public-profile-view', userId ?? username],
    queryFn: () =>
      userId ? api.publicProfileByUserId(userId) : api.publicProfileByUsername(username ?? ''),
    enabled: Boolean(userId || username),
    refetchOnMount: 'always',
    refetchOnWindowFocus: 'always',
    refetchInterval: 30_000,
  });
  const resolvedUserId = profile.data?.id;
  const profilePeople = useQuery({
    queryKey: ['profile-people', resolvedUserId, openPeopleSection],
    queryFn: () =>
      openPeopleSection === 'followers'
        ? api.profileFollowers(resolvedUserId ?? '')
        : api.profileFollowing(resolvedUserId ?? ''),
    enabled: Boolean(resolvedUserId && openPeopleSection),
  });
  const questionnaires = useQuery({
    queryKey: ['public-profile-questionnaires', resolvedUserId],
    queryFn: () => api.publicQuestionnaires(resolvedUserId ?? ''),
    enabled:
      Boolean(resolvedUserId) &&
      profile.data?.content_access !== 0 &&
      profile.data?.show_questionnaires !== 0,
  });
  const posts = useQuery({
    queryKey: ['public-profile-posts', resolvedUserId],
    queryFn: () => api.publicPosts(resolvedUserId ?? ''),
    enabled:
      Boolean(resolvedUserId) &&
      profile.data?.content_access !== 0 &&
      profile.data?.show_posts !== 0,
  });
  const directChat = useMutation({
    mutationFn: async () => {
      const started = await api.startDirectConversation(resolvedUserId ?? '');
      const conversations = await api.conversations();
      return { ...started, conversations };
    },
    onSuccess: ({ conversationId, conversations }) => {
      queryClient.setQueryData(['conversations'], conversations);
      navigate(`/chats?conversation=${encodeURIComponent(conversationId)}`);
    },
  });
  const rate = useMutation({
    mutationFn: (value: -1 | 1) => api.ratePublicProfile(resolvedUserId ?? '', value),
    onSuccess: () =>
      void queryClient.invalidateQueries({
        queryKey: ['public-profile-view', userId ?? username],
      }),
  });
  const refreshProfile = () =>
    queryClient.invalidateQueries({ queryKey: ['public-profile-view', userId ?? username] });
  const follow = useMutation({
    mutationFn: () =>
      profile.data?.is_following
        ? api.unfollowProfile(resolvedUserId ?? '')
        : api.followProfile(resolvedUserId ?? ''),
    onSuccess: () => void refreshProfile(),
  });
  const block = useMutation({
    mutationFn: () => api.block(resolvedUserId ?? ''),
    onSuccess: () => {
      setBlockConfirmOpen(false);
      void refreshProfile();
      void queryClient.invalidateQueries({ queryKey: ['conversations'] });
      invalidatePostLists(queryClient);
      void queryClient.invalidateQueries({ queryKey: ['search'] });
    },
  });
  const unblock = useMutation({
    mutationFn: () => api.unblock(resolvedUserId ?? ''),
    onSuccess: async () => {
      setMediaAccessVersion((version) => version + 1);
      await Promise.all([
        refreshProfile(),
        queryClient.invalidateQueries({
          queryKey: ['public-profile-questionnaires', resolvedUserId],
        }),
        queryClient.invalidateQueries({ queryKey: ['public-profile-posts', resolvedUserId] }),
        queryClient.invalidateQueries({ queryKey: ['search'] }),
        queryClient.invalidateQueries({ queryKey: ['posts'] }),
      ]);
    },
  });
  const reportProfile = useMutation({
    mutationFn: (description: string) =>
      api.report({
        reportedUserId: resolvedUserId ?? '',
        profileUserId: resolvedUserId ?? '',
        category: 'other',
        description,
      }),
    onSuccess: () => setReportSent(true),
  });
  if (profile.isLoading) return <Skeleton className="h-80" />;
  if (profile.isError) return <div className="error-box">{profile.error.message}</div>;
  if (!profile.data) return null;
  const aliases = parseStringArray(profile.data.usernames);
  const blockedMe = Boolean(profile.data.blocked_me);
  const blockedByMe = Boolean(profile.data.blocked_by_me);
  const contentAccess = profile.data.content_access !== 0;
  const avatarItems = parseAvatarMediaItems(
    profile.data.avatar_media_items,
    profile.data.avatar_media_id,
    profile.data.avatar_render_mode,
  );
  const featuredAudio = parseFeaturedAudio(profile.data.featured_audio_items ?? '[]');
  const returnToPreviousView = () => {
    if (window.history.length > 1) window.history.back();
    else navigate('/search');
  };
  return (
    <div>
      <div className="public-profile-viewer-title">
        <button
          type="button"
          className="icon-button"
          aria-label={ru.miniApp.community.back}
          onClick={returnToPreviousView}
        >
          <ChevronLeft aria-hidden />
        </button>
        <SectionTitle eyebrow={ru.miniApp.social.profileEyebrow}>
          {profile.data.display_name}
        </SectionTitle>
      </div>
      <Card className="p-5">
        <div className="public-profile-header">
          <ProfileAvatarGallery
            items={avatarItems}
            name={profile.data.display_name}
            className="profile-avatar-large"
            accessVersion={mediaAccessVersion}
          />
          <div className="public-profile-identity">
            <strong className="flex items-center gap-1 break-words">
              {profile.data.display_name}
              <VerificationBadge
                kind={profile.data.verification_kind}
                premium={profile.data.has_premium}
              />
            </strong>
            <ProfileUsernamesLine aliases={aliases} />
          </div>
          <div className="public-profile-actions-menu">
            <button
              className="icon-button"
              type="button"
              aria-label={ru.miniApp.social.profileActions}
              aria-expanded={profileActionsOpen}
              onClick={() => setProfileActionsOpen((open) => !open)}
            >
              <MoreVertical aria-hidden />
            </button>
            {profileActionsOpen ? (
              <div className="public-profile-actions-popover">
                <button
                  type="button"
                  onClick={() => {
                    setProfileActionsOpen(false);
                    setProfileIdOpen(true);
                  }}
                >
                  <Info aria-hidden /> {ru.miniApp.social.showInternalId}
                </button>
                {blockedByMe ? (
                  <button
                    type="button"
                    disabled={unblock.isPending}
                    onClick={() => {
                      setProfileActionsOpen(false);
                      unblock.mutate();
                    }}
                  >
                    <Ban aria-hidden /> {ru.miniApp.social.unblock}
                  </button>
                ) : (
                  <button
                    type="button"
                    disabled={blockedMe}
                    onClick={() => {
                      setProfileActionsOpen(false);
                      setBlockConfirmOpen(true);
                    }}
                  >
                    <Ban aria-hidden /> {ru.miniApp.social.block}
                  </button>
                )}
                <button
                  type="button"
                  disabled={blockedMe || reportProfile.isPending}
                  onClick={() => {
                    setProfileActionsOpen(false);
                    const description = window
                      .prompt(ru.miniApp.social.reportProfilePrompt)
                      ?.trim();
                    if (description) reportProfile.mutate(description);
                  }}
                >
                  <Flag aria-hidden /> {ru.miniApp.social.reportProfile}
                </button>
              </div>
            ) : null}
          </div>
        </div>
        <div className="profile-about-block">
          <strong>{ru.miniApp.social.aboutLabel}</strong>
          <ExpandableText text={profile.data.bio} emptyText={ru.miniApp.social.bioEmpty} />
        </div>
        {contentAccess && featuredAudio.length ? (
          <SwipePlaylist
            emptyLabel={ru.miniApp.search.trackUnknown}
            tracks={featuredAudio.slice(0, 10).map<PlaylistTrack>((track) => ({
              id: track.id,
              src: `/api/profile-media/${track.id}?access=${mediaAccessVersion}`,
              title: track.track_title || ru.miniApp.search.trackUnknown,
              performer: track.track_performer || ru.miniApp.search.performerUnknown,
              ...(track.file_size_bytes !== undefined
                ? { fileSizeBytes: track.file_size_bytes }
                : {}),
              ...(track.has_thumbnail
                ? {
                    coverSrc: `/api/profile-media/${track.id}/thumbnail?access=${mediaAccessVersion}`,
                  }
                : {}),
            }))}
          />
        ) : null}
        <div className="profile-section-links mt-4">
          {profile.data.show_followers !== 0 ? (
            <button
              className="status-pill"
              type="button"
              onClick={() =>
                setOpenPeopleSection((value) => (value === 'followers' ? null : 'followers'))
              }
            >
              {ru.miniApp.social.followers}: {profile.data.followers_count ?? 0}
            </button>
          ) : null}
          {profile.data.show_following !== 0 ? (
            <button
              className="status-pill"
              type="button"
              onClick={() =>
                setOpenPeopleSection((value) => (value === 'following' ? null : 'following'))
              }
            >
              {ru.miniApp.social.following}: {profile.data.following_count ?? 0}
            </button>
          ) : null}
          {profile.data.show_questionnaires !== 0 ? (
            <button
              className="status-pill"
              type="button"
              onClick={() =>
                document
                  .getElementById('view-profile-questionnaires')
                  ?.scrollIntoView({ behavior: 'smooth' })
              }
            >
              {ru.miniApp.social.questionnaireCount(profile.data.questionnaire_count)}
            </button>
          ) : null}
          {profile.data.show_posts !== 0 ? (
            <button
              className="status-pill"
              type="button"
              onClick={() =>
                document
                  .getElementById('view-profile-posts')
                  ?.scrollIntoView({ behavior: 'smooth' })
              }
            >
              {ru.miniApp.social.postCount(profile.data.post_count)}
            </button>
          ) : null}
        </div>
        {openPeopleSection ? (
          <ProfilePeopleList
            title={
              openPeopleSection === 'followers'
                ? ru.miniApp.social.followers
                : ru.miniApp.social.following
            }
            loading={profilePeople.isLoading}
            people={profilePeople.data ?? []}
          />
        ) : null}
        {blockedMe ? <div className="error-box mt-4">{ru.miniApp.social.blockedMe}</div> : null}
        {blockedByMe ? <div className="error-box mt-4">{ru.miniApp.social.blockedByMe}</div> : null}
        {!blockedMe && !blockedByMe && !contentAccess ? (
          <div className="error-box mt-4">{ru.miniApp.social.privateProfile}</div>
        ) : null}
        <div className="mt-5 flex flex-wrap gap-2">
          <Button
            disabled={!contentAccess || profile.data.can_direct_message === 0}
            loading={directChat.isPending}
            onClick={() => directChat.mutate()}
          >
            <MessageCircle className="h-4 w-4" /> {ru.miniApp.social.writeToProfile}
          </Button>
          <Button
            variant="secondary"
            disabled={blockedMe || blockedByMe}
            loading={follow.isPending}
            onClick={() => follow.mutate()}
          >
            {profile.data.is_following ? (
              <UserMinus className="h-4 w-4" />
            ) : (
              <UserPlus className="h-4 w-4" />
            )}
            {profile.data.is_following ? ru.miniApp.social.unfollow : ru.miniApp.social.follow}
          </Button>
          <Button
            variant={profile.data.own_rating === 1 ? 'primary' : 'secondary'}
            disabled={!contentAccess}
            loading={rate.isPending}
            onClick={() => rate.mutate(1)}
          >
            <Heart className="h-4 w-4" /> {profile.data.rating_likes}
          </Button>
          <Button
            variant={profile.data.own_rating === -1 ? 'danger' : 'secondary'}
            disabled={!contentAccess}
            loading={rate.isPending}
            onClick={() => rate.mutate(-1)}
          >
            <ThumbsDown className="h-4 w-4" /> {profile.data.rating_dislikes}
          </Button>
        </div>
        {reportSent ? (
          <p className="mt-3 text-sm text-emerald-400">{ru.miniApp.social.reportSent}</p>
        ) : null}
        {directChat.isError ? (
          <div className="error-box mt-3">{ru.miniApp.social.directChatError}</div>
        ) : null}
        {profile.data.owner_liked ? (
          <p className="owner-blessing">{ru.miniApp.social.ownerBlessing}</p>
        ) : null}
      </Card>
      <InfoDialog
        open={profileIdOpen}
        title={ru.miniApp.social.internalId}
        description={profile.data.id}
        closeLabel={ru.miniApp.social.closeInfo}
        onClose={() => setProfileIdOpen(false)}
      />
      {contentAccess ? (
        <>
          <div id="view-profile-questionnaires">
            <SectionTitle eyebrow={ru.miniApp.social.profileEyebrow}>
              {ru.miniApp.social.activeQuestionnaires}
            </SectionTitle>
            {profile.data.show_questionnaires !== 0 ? (
              <div className="space-y-4">
                {questionnaires.data?.map((questionnaire) => (
                  <ProfileCard
                    key={questionnaire.id}
                    profile={questionnaire}
                    expanded
                    messagePending={directChat.isPending}
                    onMessage={() => directChat.mutate()}
                  />
                ))}
                {!questionnaires.isLoading && !questionnaires.data?.length ? (
                  <EmptyState
                    icon={<FileText className="h-7 w-7" />}
                    title={ru.miniApp.social.activeQuestionnaires}
                    description={ru.miniApp.social.activeQuestionnairesEmpty}
                  />
                ) : null}
              </div>
            ) : (
              <div className="notice-box">{ru.miniApp.social.hiddenProfileSection}</div>
            )}
          </div>
          <div id="view-profile-posts">
            <SectionTitle eyebrow={ru.miniApp.social.profileEyebrow}>
              {ru.miniApp.social.profilePosts}
            </SectionTitle>
            {profile.data.show_posts !== 0 ? (
              <div className="space-y-4">
                {posts.data?.map((post) => (
                  <PostCard key={post.id} post={post} />
                ))}
                {!posts.isLoading && !posts.data?.length ? (
                  <EmptyState
                    icon={<FileText className="h-7 w-7" />}
                    title={ru.miniApp.social.profilePosts}
                    description={ru.miniApp.social.profilePostsEmpty}
                  />
                ) : null}
              </div>
            ) : (
              <div className="notice-box">{ru.miniApp.social.hiddenProfileSection}</div>
            )}
          </div>
        </>
      ) : null}
      <ConfirmDialog
        open={blockConfirmOpen}
        title={ru.miniApp.social.blockConfirmTitle}
        description={ru.miniApp.social.blockConfirmDescription}
        confirmLabel={ru.miniApp.social.block}
        cancelLabel={ru.miniApp.social.cancelEditing}
        loading={block.isPending}
        onCancel={() => setBlockConfirmOpen(false)}
        onConfirm={() => block.mutate()}
      />
    </div>
  );
}

export function QuestionnairesPage() {
  const queryClient = useQueryClient();
  const [previewQuestionnaireId, setPreviewQuestionnaireId] = useState<string | null>(null);
  const [questionnaireToDelete, setQuestionnaireToDelete] = useState<{
    id: string;
    title: string;
  } | null>(null);
  const collection = useQuery({ queryKey: ['questionnaires'], queryFn: api.questionnaires });
  const preview = useQuery({
    queryKey: ['questionnaire-preview', previewQuestionnaireId],
    queryFn: () => api.questionnairePreview(previewQuestionnaireId!),
    enabled: previewQuestionnaireId !== null,
  });
  const clone = useMutation({
    mutationFn: () => {
      const title = window.prompt(ru.miniApp.social.titlePrompt)?.trim();
      if (!title) return Promise.reject(new Error(ru.miniApp.social.titlePrompt));
      return api.cloneQuestionnaire(title);
    },
    onSuccess: () => void queryClient.invalidateQueries({ queryKey: ['questionnaires'] }),
  });
  const setActive = useMutation({
    mutationFn: ({ id, active }: { id: string; active: boolean }) =>
      api.setQuestionnaireActive(id, active),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ['questionnaires'] });
      void queryClient.invalidateQueries({ queryKey: ['search'] });
    },
  });
  const setPrimary = useMutation({
    mutationFn: api.setPrimaryQuestionnaire,
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ['questionnaires'] });
      void queryClient.invalidateQueries({ queryKey: ['profile'] });
      void queryClient.invalidateQueries({ queryKey: ['search'] });
    },
  });
  const remove = useMutation({
    mutationFn: (questionnaireId: string) => api.deleteQuestionnaire(questionnaireId),
    onSuccess: () => {
      setQuestionnaireToDelete(null);
      void queryClient.invalidateQueries({ queryKey: ['questionnaires'] });
      void queryClient.invalidateQueries({ queryKey: ['profile'] });
      void queryClient.invalidateQueries({ queryKey: ['profile-preview'] });
      void queryClient.invalidateQueries({ queryKey: ['search'] });
    },
  });
  if (collection.isLoading) return <Skeleton className="h-80" />;
  const data = collection.data;
  if (!data) return null;
  return (
    <div>
      <SectionTitle
        eyebrow={ru.miniApp.social.questionnairesEyebrow}
        action={
          <span className="status-pill">
            {ru.miniApp.social.questionnaireLimit(data.questionnaires.length, data.limit)}
          </span>
        }
      >
        {ru.miniApp.social.questionnairesTitle}
      </SectionTitle>
      <div className="questionnaire-own-carousel">
        {data.questionnaires.map((questionnaire) => (
          <Card className="questionnaire-own-card p-5" key={questionnaire.id}>
            <div className="flex min-w-0 items-start justify-between gap-3">
              <div className="min-w-0">
                <strong className="break-words">
                  {questionnaire.title || questionnaire.short_headline}
                </strong>
                <p className="mt-1 break-words text-sm text-muted">
                  {questionnaire.short_headline}
                </p>
              </div>
              <div className="questionnaire-own-badges">
                {questionnaire.is_primary ? (
                  <span className="status-pill">{ru.miniApp.social.primaryQuestionnaire}</span>
                ) : null}
                <span
                  className={`status-pill questionnaire-state-pill${
                    questionnaire.is_active ? ' is-live' : ' is-hidden'
                  }`}
                >
                  {questionnaire.is_active
                    ? ru.miniApp.social.questionnaireLive
                    : ru.miniApp.social.questionnaireHidden}
                </span>
              </div>
            </div>
            <div className="mt-4 flex flex-wrap items-center gap-2">
              <a
                className="button button-secondary questionnaire-icon-action"
                href={`/questionnaires/${questionnaire.id}/edit`}
                aria-label={ru.miniApp.profile.edit}
                title={ru.miniApp.profile.edit}
              >
                <Pencil className="h-4 w-4" />
              </a>
              <Button
                className="questionnaire-icon-action"
                variant="secondary"
                aria-expanded={previewQuestionnaireId === questionnaire.id}
                aria-label={ru.miniApp.profile.openProfilePreview}
                title={ru.miniApp.profile.openProfilePreview}
                onClick={() =>
                  setPreviewQuestionnaireId((current) =>
                    current === questionnaire.id ? null : questionnaire.id,
                  )
                }
              >
                <Eye className="h-4 w-4" />
              </Button>
              <Button
                className="questionnaire-state-action"
                variant={questionnaire.is_active ? 'danger' : 'secondary'}
                loading={setActive.isPending}
                aria-pressed={Boolean(questionnaire.is_active)}
                title={
                  questionnaire.is_active
                    ? ru.miniApp.social.disableQuestionnaire
                    : ru.miniApp.social.enableQuestionnaire
                }
                onClick={() =>
                  setActive.mutate({ id: questionnaire.id, active: !questionnaire.is_active })
                }
              >
                <Power className="h-4 w-4" />
                <span>
                  {questionnaire.is_active
                    ? ru.miniApp.social.disableQuestionnaire
                    : ru.miniApp.social.enableQuestionnaire}
                </span>
              </Button>
              {data.premium && !questionnaire.is_primary ? (
                <Button
                  className="questionnaire-icon-action"
                  variant="secondary"
                  loading={setPrimary.isPending}
                  aria-label={ru.miniApp.social.makePrimaryQuestionnaire}
                  title={ru.miniApp.social.makePrimaryQuestionnaire}
                  onClick={() => setPrimary.mutate(questionnaire.id)}
                >
                  <Star className="h-4 w-4" />
                </Button>
              ) : null}
              <Button
                className="questionnaire-delete-action questionnaire-icon-action"
                variant="ghost"
                aria-label={ru.miniApp.social.deleteQuestionnaire}
                title={ru.miniApp.social.deleteQuestionnaire}
                onClick={() =>
                  setQuestionnaireToDelete({
                    id: questionnaire.id,
                    title: questionnaire.title || questionnaire.short_headline,
                  })
                }
              >
                <Trash2 className="h-4 w-4" />
              </Button>
              <span className="text-xs text-muted">
                👍 {questionnaire.rating_likes} · 👎 {questionnaire.rating_dislikes}
              </span>
            </div>
          </Card>
        ))}
      </div>
      {previewQuestionnaireId ? (
        <section className="questionnaire-own-preview mt-4" aria-live="polite">
          {preview.isLoading ? <Skeleton className="h-96" /> : null}
          {preview.isError ? <div className="error-box">{preview.error.message}</div> : null}
          {preview.data ? (
            <div className="space-y-3">
              <div className="questionnaire-preview-toolbar">
                <span
                  className="status-pill questionnaire-preview-views"
                  aria-label={ru.miniApp.community.questionnaireViews(preview.data.view_count ?? 0)}
                >
                  <Eye className="h-4 w-4" aria-hidden />
                  {preview.data.view_count ?? 0}
                </span>
                <Button variant="ghost" onClick={() => setPreviewQuestionnaireId(null)}>
                  <X className="h-4 w-4" /> {ru.miniApp.profile.closePreview}
                </Button>
              </div>
              <ProfileCard profile={preview.data} preview expanded />
            </div>
          ) : null}
        </section>
      ) : null}
      <Card className="mt-4 p-5">
        <p className="text-sm text-muted">
          {data.questionnaires.length === 0
            ? ru.miniApp.social.firstQuestionnaireHint
            : data.premium
              ? ru.miniApp.social.cloneHint
              : ru.miniApp.social.premiumRequired}
        </p>
        {data.questionnaires.length === 0 ? (
          <Link
            className="button button-primary mt-4"
            href="/questionnaires/edit"
            aria-label={ru.miniApp.social.createFirstQuestionnaire}
            title={ru.miniApp.social.createFirstQuestionnaire}
          >
            <Plus className="h-5 w-5" />
            <span>{ru.miniApp.social.createFirstQuestionnaire}</span>
          </Link>
        ) : (
          <Button
            className="questionnaire-create-icon mt-4"
            disabled={!data.premium || data.questionnaires.length >= data.limit}
            loading={clone.isPending}
            aria-label={ru.miniApp.social.createQuestionnaire}
            title={ru.miniApp.social.createQuestionnaire}
            onClick={() => clone.mutate()}
          >
            <Plus className="h-5 w-5" />
          </Button>
        )}
        {clone.isError ? <div className="error-box mt-3">{clone.error.message}</div> : null}
        {remove.isError ? <div className="error-box mt-3">{remove.error.message}</div> : null}
      </Card>
      <ConfirmDialog
        open={questionnaireToDelete !== null}
        title={ru.miniApp.social.deleteQuestionnaireConfirmTitle}
        description={ru.miniApp.social.deleteQuestionnaireConfirmDescription(
          questionnaireToDelete?.title ?? '',
        )}
        confirmLabel={ru.miniApp.social.deleteQuestionnaire}
        cancelLabel={ru.miniApp.social.cancelQuestionnaireDeletion}
        loading={remove.isPending}
        onCancel={() => setQuestionnaireToDelete(null)}
        onConfirm={() => {
          if (questionnaireToDelete) remove.mutate(questionnaireToDelete.id);
        }}
      />
    </div>
  );
}

export function PostCard({
  post,
  own = false,
  canModerate = false,
  initialOpen = false,
}: {
  post: SocialPost;
  own?: boolean;
  canModerate?: boolean;
  initialOpen?: boolean;
}) {
  const queryClient = useQueryClient();
  const viewerTime = useViewerTime();
  const [mediaIndex, setMediaIndex] = useState(0);
  const [mediaFullscreen, setMediaFullscreen] = useState(false);
  const [mediaMotion, setMediaMotion] = useState<'next' | 'previous' | null>(null);
  const [mediaMotionSequence, setMediaMotionSequence] = useState(0);
  const mediaTouchStart = useRef<{ x: number; y: number } | null>(null);
  const mediaWasSwiped = useRef(false);
  const mediaThumbnailRefs = useRef<Array<HTMLButtonElement | null>>([]);
  const [open, setOpen] = useState(initialOpen);
  useEffect(() => {
    if (initialOpen) setOpen(true);
  }, [initialOpen]);
  const [viewRecorded, setViewRecorded] = useState(false);
  const [viewDelta, setViewDelta] = useState(0);
  const [body, setBody] = useState('');
  const [replyTo, setReplyTo] = useState<{ id: string; name: string } | null>(null);
  const [editingCommentId, setEditingCommentId] = useState<string | null>(null);
  const [editingCommentBody, setEditingCommentBody] = useState('');
  const [commentSort, setCommentSort] = useState<'interesting' | 'new'>('interesting');
  const [commentSortOpen, setCommentSortOpen] = useState(false);
  const [interestingCommentIndex, setInterestingCommentIndex] = useState(0);
  const [commentMenuId, setCommentMenuId] = useState<string | null>(null);
  const [expandedThreads, setExpandedThreads] = useState<Set<string>>(() => new Set());
  const [ownCommentToDelete, setOwnCommentToDelete] = useState<string | null>(null);
  const [postMediaToDelete, setPostMediaToDelete] = useState<string | null>(null);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [postMenuOpen, setPostMenuOpen] = useState(false);
  const [moderationOpen, setModerationOpen] = useState(false);
  const [engagementKind, setEngagementKind] = useState<'ratings' | 'shares' | null>(null);
  const [failedMediaIds, setFailedMediaIds] = useState<Set<string>>(() => new Set());
  const [legacyAnimationImageIds, setLegacyAnimationImageIds] = useState<Set<string>>(
    () => new Set(),
  );
  const [shareOpen, setShareOpen] = useState(false);
  const [playlistShareTrackIds, setPlaylistShareTrackIds] = useState<string[]>([]);
  const [postTitle, setPostTitle] = useState(post.title ?? '');
  const [postPlaylistTitle, setPostPlaylistTitle] = useState(post.playlist_title ?? '');
  const [postBody, setPostBody] = useState(post.body_markdown || post.text_preview);
  const [postTags, setPostTags] = useState(parseStringArray(post.tags || '[]').join(', '));
  const [postFandoms, setPostFandoms] = useState(parseStringArray(post.fandoms || '[]').join(', '));
  const [postHashtags, setPostHashtags] = useState(
    parseStringArray(post.hashtags || '[]')
      .map((item) => `#${item}`)
      .join(', '),
  );
  const [ratingPreview, setRatingPreview] = useState({
    ownRating: post.own_rating,
    likes: Number(post.likes),
    dislikes: Number(post.dislikes),
  });
  useEffect(() => {
    setRatingPreview({
      ownRating: post.own_rating,
      likes: Number(post.likes),
      dislikes: Number(post.dislikes),
    });
  }, [post.dislikes, post.likes, post.own_rating]);
  const comments = useQuery({
    queryKey: ['post-comments', post.id, commentSort],
    queryFn: () => api.postComments(post.id, commentSort),
    enabled: open,
  });
  const me = useQuery({ queryKey: ['me'], queryFn: api.me });
  const isOwnPost = own || me.data?.userId === post.author_user_id;
  const engagement = useQuery({
    queryKey: ['post-engagement', post.id, engagementKind],
    queryFn: () => api.postEngagement(post.id, engagementKind ?? 'ratings'),
    enabled: engagementKind !== null,
  });
  const followAuthor = useMutation({
    mutationFn: () =>
      post.is_following
        ? api.unfollowProfile(post.author_user_id)
        : api.followProfile(post.author_user_id),
    onSuccess: () => invalidatePostLists(queryClient),
  });
  const hidePost = useMutation({
    mutationFn: () => api.hidePost(post.id),
    onSuccess: () => {
      setPostMenuOpen(false);
      invalidatePostLists(queryClient);
    },
  });
  const rate = useMutation({
    mutationFn: (value: -1 | 1) => api.ratePost(post.id, value),
    onMutate: (value) => {
      const previous = ratingPreview;
      const nextRating = previous.ownRating === value ? null : value;
      setRatingPreview({
        ownRating: nextRating,
        likes: previous.likes - (previous.ownRating === 1 ? 1 : 0) + (nextRating === 1 ? 1 : 0),
        dislikes:
          previous.dislikes - (previous.ownRating === -1 ? 1 : 0) + (nextRating === -1 ? 1 : 0),
      });
      return { previous };
    },
    onError: (_error, _value, context) => {
      if (context) setRatingPreview(context.previous);
    },
    onSuccess: (result) => {
      setRatingPreview((current) => ({ ...current, ownRating: result.value }));
    },
    onSettled: () => invalidatePostLists(queryClient),
  });
  const sharePost = useMutation({
    mutationFn: ({ conversationIds, caption }: { conversationIds: string[]; caption?: string }) =>
      api.shareEntity({
        entityType: 'post',
        entityId: post.id,
        conversationIds,
        ...(caption ? { caption } : {}),
      }),
    onSuccess: () => {
      setShareOpen(false);
      invalidatePostLists(queryClient);
    },
  });
  const sharePlaylist = useMutation({
    mutationFn: (conversationIds: string[]) =>
      api.sharePlaylist({
        sourceType: 'post',
        sourceId: post.id,
        trackIds: playlistShareTrackIds,
        conversationIds,
        title: post.playlist_title,
      }),
    onSuccess: () => {
      setPlaylistShareTrackIds([]);
      invalidatePostLists(queryClient);
    },
  });
  const comment = useMutation({
    mutationFn: () => api.addPostComment(post.id, body, replyTo?.id),
    onSuccess: () => {
      setBody('');
      setReplyTo(null);
      void queryClient.invalidateQueries({ queryKey: ['post-comments', post.id] });
      invalidatePostLists(queryClient);
    },
  });
  const rateComment = useMutation({
    mutationFn: ({ id, value }: { id: string; value: -1 | 1 }) => api.ratePostComment(id, value),
    onSuccess: () => void queryClient.invalidateQueries({ queryKey: ['post-comments', post.id] }),
  });
  const updateComment = useMutation({
    mutationFn: () => {
      if (!editingCommentId) throw new Error(ru.miniApp.social.commentNotSelected);
      return api.updatePostComment(editingCommentId, editingCommentBody.trim());
    },
    onSuccess: () => {
      setEditingCommentId(null);
      setEditingCommentBody('');
      void queryClient.invalidateQueries({ queryKey: ['post-comments', post.id] });
      invalidatePostLists(queryClient);
    },
  });
  const deleteComment = useMutation({
    mutationFn: ({ commentId, reason }: { commentId: string; reason: string }) =>
      api.adminDeleteComment(commentId, reason),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ['post-comments', post.id] });
      invalidatePostLists(queryClient);
    },
  });
  const deleteOwnComment = useMutation({
    mutationFn: (commentId: string) => api.deleteOwnPostComment(commentId),
    onSuccess: () => {
      setOwnCommentToDelete(null);
      void queryClient.invalidateQueries({ queryKey: ['post-comments', post.id] });
      invalidatePostLists(queryClient);
    },
  });
  const report = useMutation({
    mutationFn: (input: {
      reportedUserId: string;
      postId?: string;
      commentId?: string;
      description: string;
    }) =>
      api.report({
        ...input,
        category: 'other',
      }),
  });
  const updatePost = useMutation({
    mutationFn: () =>
      api.updateOwnPost(post.id, {
        title: postTitle.trim(),
        bodyMarkdown: postBody.trim(),
        tags: parseCommaList(postTags),
        fandoms: parseCommaList(postFandoms),
        hashtags: parseCommaList(postHashtags),
        playlistTitle: postPlaylistTitle.trim() || null,
      }),
    onSuccess: () => {
      setSettingsOpen(false);
      void queryClient.invalidateQueries({ queryKey: ['own-posts'] });
      invalidatePostLists(queryClient);
    },
  });
  const removeMedia = useMutation({
    mutationFn: (mediaId: string | undefined) => api.removeOwnPostMedia(post.id, mediaId),
    onSuccess: () => {
      setPostMediaToDelete(null);
      setMediaIndex(0);
      void queryClient.invalidateQueries({ queryKey: ['own-posts'] });
      invalidatePostLists(queryClient);
    },
  });
  const deletePost = useMutation({
    mutationFn: () => api.deleteOwnPost(post.id),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ['own-posts'] });
      invalidatePostLists(queryClient);
    },
  });
  const moderatePost = useMutation({
    mutationFn: (status: 'active' | 'blocked' | 'limited' | 'shadow_banned') =>
      api.adminModeratePost(
        post.id,
        status,
        status === 'limited'
          ? ru.miniApp.admin.limitPostReason
          : status === 'shadow_banned'
            ? ru.miniApp.admin.shadowBanPostReason
            : status === 'blocked'
              ? ru.miniApp.admin.blockPostPrompt
              : ru.miniApp.admin.restorePostReachReason,
      ),
    onSuccess: () => {
      setModerationOpen(false);
      invalidatePostLists(queryClient);
    },
  });
  const addMedia = () => {
    const link = `https://t.me/r0lemate_bot?start=post_media_${post.id}`;
    const telegram = getTelegram();
    if (telegram) telegram.openTelegramLink(link);
    else window.open(link, '_blank', 'noopener,noreferrer');
  };
  const resetPostDraft = () => {
    setPostTitle(post.title ?? '');
    setPostPlaylistTitle(post.playlist_title ?? '');
    setPostBody(post.body_markdown || post.text_preview);
    setPostTags(parseStringArray(post.tags || '[]').join(', '));
    setPostFandoms(parseStringArray(post.fandoms || '[]').join(', '));
    setPostHashtags(
      parseStringArray(post.hashtags || '[]')
        .map((item) => `#${item}`)
        .join(', '),
    );
    updatePost.reset();
    removeMedia.reset();
  };
  const togglePostSettings = () => {
    resetPostDraft();
    setSettingsOpen((value) => !value);
  };
  const cancelPostEditing = () => {
    resetPostDraft();
    setSettingsOpen(false);
  };
  const cancelCommentEditing = () => {
    setEditingCommentId(null);
    setEditingCommentBody('');
    updateComment.reset();
  };
  const mediaItems = parsePostMedia(post);
  const audioItems = mediaItems.filter(
    (item) => item.media_type === 'audio' || item.media_type === 'voice',
  );
  const carouselItems = mediaItems.filter(
    (item) => item.media_type !== 'audio' && item.media_type !== 'voice',
  );
  const currentMedia = carouselItems[mediaIndex] ?? carouselItems[0];
  const currentMediaUrl = currentMedia
    ? currentMedia.id
      ? `/api/posts/${post.id}/media/${currentMedia.id}`
      : `/api/posts/${post.id}/media`
    : '';
  const interestingComments = parseTopComments(post.top_comments ?? post.top_comment);
  const topComment = interestingComments[interestingCommentIndex] ?? interestingComments[0] ?? null;
  useEffect(() => {
    setInterestingCommentIndex(0);
    if (open || interestingComments.length < 2) return;
    const timer = window.setInterval(
      () => setInterestingCommentIndex((index) => (index + 1) % interestingComments.length),
      4_500,
    );
    return () => window.clearInterval(timer);
  }, [interestingComments.length, open, post.top_comment, post.top_comments]);
  const renderPostCollageItem = (
    item: ReturnType<typeof parsePostMedia>[number],
    itemIndex: number,
  ) => {
    const url = item.id ? `/api/posts/${post.id}/media/${item.id}` : `/api/posts/${post.id}/media`;
    const className = 'post-media-collage-content';
    const mediaKey = item.id ?? `${post.id}-${itemIndex}`;
    if (failedMediaIds.has(mediaKey)) {
      return <span className="post-media-error">{ru.miniApp.social.imageLoadError}</span>;
    }
    if (item.media_type === 'photo') {
      return (
        <img
          className={className}
          src={url}
          alt=""
          onError={() => setFailedMediaIds((current) => new Set(current).add(mediaKey))}
        />
      );
    }
    if (item.media_type === 'animation' && item.mime_type === 'image/gif') {
      return (
        <img
          className={className}
          src={url}
          alt=""
          onError={() => setFailedMediaIds((current) => new Set(current).add(mediaKey))}
        />
      );
    }
    return (
      <video
        className={className}
        src={url}
        autoPlay
        muted
        loop
        playsInline
        preload="metadata"
        aria-label={`${ru.miniApp.search.openMediaFullscreen} ${itemIndex + 1}`}
        onError={() => setFailedMediaIds((current) => new Set(current).add(mediaKey))}
      />
    );
  };
  const movePostMedia = (direction: -1 | 1, animated: boolean) => {
    if (carouselItems.length < 2) return;
    setMediaMotion(animated ? (direction > 0 ? 'next' : 'previous') : null);
    if (animated) setMediaMotionSequence((value) => value + 1);
    setMediaIndex((index) => (index + direction + carouselItems.length) % carouselItems.length);
  };
  const selectPostMedia = (nextIndex: number, animated: boolean) => {
    if (nextIndex === mediaIndex || nextIndex < 0 || nextIndex >= carouselItems.length) return;
    const direction = nextIndex > mediaIndex ? 1 : -1;
    setMediaMotion(animated ? (direction > 0 ? 'next' : 'previous') : null);
    if (animated) setMediaMotionSequence((value) => value + 1);
    setMediaIndex(nextIndex);
  };
  const finishPostMediaSwipe = (clientX: number, clientY: number, fullscreen: boolean) => {
    const start = mediaTouchStart.current;
    mediaTouchStart.current = null;
    if (!start) return;
    const deltaX = clientX - start.x;
    const deltaY = clientY - start.y;
    mediaWasSwiped.current = Math.abs(deltaX) > 12 || Math.abs(deltaY) > 12;
    if (fullscreen && deltaY < -70 && Math.abs(deltaY) > Math.abs(deltaX)) {
      setMediaFullscreen(false);
      return;
    }
    if (carouselItems.length < 2 || Math.abs(deltaX) < 55 || Math.abs(deltaX) <= Math.abs(deltaY)) {
      return;
    }
    movePostMedia(deltaX < 0 ? 1 : -1, fullscreen);
  };
  useEffect(() => {
    if (!mediaFullscreen) return;
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') setMediaFullscreen(false);
      if (event.key === 'ArrowLeft' && carouselItems.length > 1) {
        movePostMedia(-1, false);
      }
      if (event.key === 'ArrowRight' && carouselItems.length > 1) {
        movePostMedia(1, false);
      }
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [carouselItems.length, mediaFullscreen]);
  useEffect(() => {
    if (!mediaFullscreen) return;
    mediaThumbnailRefs.current[mediaIndex]?.scrollIntoView({
      behavior: 'smooth',
      block: 'nearest',
      inline: 'center',
    });
  }, [mediaFullscreen, mediaIndex]);
  useEffect(() => {
    if ((!open && !mediaFullscreen) || isOwnPost || viewRecorded) return;
    setViewRecorded(true);
    void api
      .recordPostView(post.id)
      .then(({ recorded }) => setViewDelta(recorded ? 1 : 0))
      .catch(() => setViewRecorded(false));
  }, [isOwnPost, mediaFullscreen, open, post.id, viewRecorded]);
  const renderCurrentMedia = (fullscreen = false) => {
    if (!currentMedia) return null;
    const mediaKey = currentMedia.id ?? `${post.id}-${mediaIndex}`;
    if (failedMediaIds.has(mediaKey)) {
      return <div className="post-media-error">{ru.miniApp.social.imageLoadError}</div>;
    }
    if (currentMedia.media_type === 'photo') {
      return (
        <img
          className={fullscreen ? 'media-lightbox-content' : 'post-media-content'}
          src={currentMediaUrl}
          alt=""
          loading="lazy"
          onError={() => setFailedMediaIds((current) => new Set(current).add(mediaKey))}
        />
      );
    }
    if (currentMedia.media_type === 'animation') {
      const knownVideo = currentMedia.mime_type?.startsWith('video/') === true;
      const knownImage = currentMedia.mime_type === 'image/gif';
      const renderAsImage = knownImage || (!knownVideo && legacyAnimationImageIds.has(mediaKey));
      const mediaClass = fullscreen ? 'media-lightbox-content' : 'post-media-content';
      return (
        <div className={`post-gif-media${fullscreen ? ' post-gif-media-fullscreen' : ''}`}>
          {renderAsImage ? (
            <img
              className={mediaClass}
              src={currentMediaUrl}
              alt=""
              loading="lazy"
              onError={() => setFailedMediaIds((current) => new Set(current).add(mediaKey))}
            />
          ) : (
            <video
              className={mediaClass}
              src={currentMediaUrl}
              autoPlay
              loop
              muted
              playsInline
              preload="metadata"
              onError={() => {
                if (!currentMedia.mime_type) {
                  setLegacyAnimationImageIds((current) => new Set(current).add(mediaKey));
                  return;
                }
                setFailedMediaIds((current) => new Set(current).add(mediaKey));
              }}
            />
          )}
          <span>{ru.miniApp.community.animationMessage}</span>
        </div>
      );
    }
    if (currentMedia.media_type === 'video') {
      return (
        <video
          className={fullscreen ? 'media-lightbox-content' : 'post-media-content'}
          src={currentMediaUrl}
          controls={fullscreen}
          playsInline
          preload="metadata"
          onError={() => setFailedMediaIds((current) => new Set(current).add(mediaKey))}
        />
      );
    }
    if (currentMedia.media_type === 'audio' || currentMedia.media_type === 'voice') {
      return (
        <div className={fullscreen ? 'post-audio-fullscreen' : 'p-4'}>
          {currentMedia.track_title || currentMedia.track_performer ? (
            <p className="mb-2 break-words text-sm">
              {currentMedia.track_title ?? ru.miniApp.social.postsTitle}
              {currentMedia.track_performer ? ` — ${currentMedia.track_performer}` : ''}
            </p>
          ) : null}
          <audio className="w-full" src={currentMediaUrl} controls preload="none" />
        </div>
      );
    }
    return fullscreen ? (
      <a className="button button-secondary m-4" href={currentMediaUrl}>
        {ru.miniApp.profile.openMedia}
      </a>
    ) : (
      <span className="button button-secondary m-4">{ru.miniApp.profile.openMedia}</span>
    );
  };
  return (
    <Card className="post-card overflow-hidden">
      <div className="post-card-header border-b border-white/10 p-4">
        {post.repost_source_post_id ? (
          <span className="post-repost-attribution">
            <Share2 aria-hidden /> {ru.miniApp.social.repostedBy(post.display_name)}
          </span>
        ) : null}
        <Link
          className="profile-author-link flex min-w-0 flex-1 items-center gap-3"
          href={`/profiles/${post.original_author_user_id ?? post.author_user_id}`}
        >
          <ProfileAvatar
            mediaId={post.original_author_avatar_media_id ?? post.avatar_media_id}
            renderMode={post.original_author_avatar_render_mode ?? post.avatar_render_mode}
            name={post.original_author_name ?? post.display_name}
          />
          <div className="min-w-0">
            <strong className="inline-flex items-center gap-1 break-words">
              {post.original_author_name ?? post.display_name}
              <VerificationBadge kind={post.verification_kind} premium={post.has_premium} />
            </strong>
            <p className="text-xs text-muted" title={viewerTime.absolute(post.published_at)}>
              {viewerTime.relative(post.published_at)}
            </p>
          </div>
        </Link>
        {!me.isLoading && !isOwnPost ? (
          <button
            type="button"
            className={`post-follow-toggle ${post.is_following ? 'is-following' : ''}`}
            disabled={followAuthor.isPending}
            onClick={() => followAuthor.mutate()}
          >
            {post.is_following ? ru.miniApp.social.followingAuthor : ru.miniApp.social.followAuthor}
          </button>
        ) : null}
        <div className="post-card-menu">
          <button
            className="post-report-button"
            type="button"
            aria-label={ru.miniApp.social.postMenu}
            aria-expanded={postMenuOpen}
            onClick={() => setPostMenuOpen((value) => !value)}
          >
            <MoreVertical aria-hidden />
          </button>
          {postMenuOpen ? (
            <>
              <button
                type="button"
                className="post-menu-backdrop"
                aria-label={ru.miniApp.community.cancelAction}
                onClick={() => setPostMenuOpen(false)}
              />
              <div className="post-card-menu-popover post-action-sheet" role="menu">
                {isOwnPost ? (
                  <button
                    type="button"
                    onClick={() => {
                      setPostMenuOpen(false);
                      togglePostSettings();
                    }}
                  >
                    <Settings2 /> {ru.miniApp.social.postSettings}
                  </button>
                ) : (
                  <>
                    <button type="button" onClick={() => setEngagementKind('ratings')}>
                      <Heart /> {ru.miniApp.social.postRatedBy}
                    </button>
                    <button type="button" onClick={() => setEngagementKind('shares')}>
                      <Share2 /> {ru.miniApp.social.postSharedBy}
                    </button>
                    <button type="button" onClick={() => hidePost.mutate()}>
                      <Eye /> {ru.miniApp.social.hidePost}
                    </button>
                    <button
                      type="button"
                      className="danger"
                      onClick={() => {
                        const description = window
                          .prompt(ru.miniApp.social.reportPostPrompt)
                          ?.trim();
                        if (description) {
                          report.mutate({
                            reportedUserId: post.author_user_id,
                            postId: post.id,
                            description,
                          });
                        }
                        setPostMenuOpen(false);
                      }}
                    >
                      <Flag /> {ru.miniApp.social.report}
                    </button>
                  </>
                )}
              </div>
            </>
          ) : null}
        </div>
      </div>
      <div className="p-5">
        {post.title ? (
          <h2 className="mb-3 break-words font-display text-2xl">{post.title}</h2>
        ) : null}
        <ProfileMarkdown className="break-words text-sm leading-relaxed" allowLinks>
          {post.body_markdown || post.text_preview}
        </ProfileMarkdown>
      </div>
      {currentMedia ? (
        <div
          className={`post-media-carousel border-y border-white/10 bg-black/20${
            currentMedia.media_type === 'animation' ? ' has-gif' : ''
          }`}
          role="button"
          tabIndex={0}
          aria-label={ru.miniApp.search.openMediaFullscreen}
          onClick={() => {
            if (mediaWasSwiped.current) {
              mediaWasSwiped.current = false;
              return;
            }
            setMediaFullscreen(true);
          }}
          onKeyDown={(event) => {
            if (event.key !== 'Enter' && event.key !== ' ') return;
            event.preventDefault();
            setMediaFullscreen(true);
          }}
        >
          {carouselItems.length > 1 ? (
            <div className={`post-media-collage count-${Math.min(carouselItems.length, 4)}`}>
              {carouselItems.slice(0, 4).map((item, itemIndex) => (
                <button
                  type="button"
                  className="post-media-collage-item"
                  key={item.id ?? itemIndex}
                  onClick={(event) => {
                    event.stopPropagation();
                    setMediaIndex(itemIndex);
                    setMediaFullscreen(true);
                  }}
                >
                  {renderPostCollageItem(item, itemIndex)}
                  {itemIndex === 3 && carouselItems.length > 4 ? (
                    <span>+{carouselItems.length - 4}</span>
                  ) : null}
                </button>
              ))}
            </div>
          ) : (
            renderCurrentMedia()
          )}
        </div>
      ) : null}
      {audioItems.length ? (
        <div className="post-playlist-block px-5 pb-5">
          {post.playlist_title && audioItems.length > 1 ? <h3>{post.playlist_title}</h3> : null}
          <SwipePlaylist
            emptyLabel={ru.miniApp.search.trackUnknown}
            limit={20}
            onShare={setPlaylistShareTrackIds}
            tracks={audioItems.slice(0, 20).map<PlaylistTrack>((item) => ({
              id: item.id ?? `${post.id}-audio`,
              src: item.id
                ? `/api/posts/${post.id}/media/${item.id}`
                : `/api/posts/${post.id}/media`,
              title: item.track_title || ru.miniApp.search.trackUnknown,
              performer: item.track_performer || ru.miniApp.search.performerUnknown,
              ...(item.has_thumbnail && item.id
                ? { coverSrc: `/api/posts/${post.id}/media/${item.id}/thumbnail` }
                : item.has_thumbnail
                  ? { coverSrc: `/api/posts/${post.id}/thumbnail` }
                  : {}),
            }))}
          />
        </div>
      ) : null}
      {mediaFullscreen && currentMedia ? (
        <div
          className="media-lightbox"
          role="dialog"
          aria-modal="true"
          aria-label={ru.miniApp.search.openMediaFullscreen}
          onMouseDown={(event) => {
            if (event.target === event.currentTarget) setMediaFullscreen(false);
          }}
          onTouchStart={(event) => {
            const touch = event.touches[0];
            if (touch) mediaTouchStart.current = { x: touch.clientX, y: touch.clientY };
          }}
          onTouchEnd={(event) => {
            const touch = event.changedTouches[0];
            if (touch) finishPostMediaSwipe(touch.clientX, touch.clientY, true);
          }}
        >
          <button
            className="media-lightbox-close"
            type="button"
            aria-label={ru.miniApp.musicPlayer.close}
            onClick={() => setMediaFullscreen(false)}
          >
            <X aria-hidden />
          </button>
          {carouselItems.length > 1 ? (
            <>
              <button
                className="media-lightbox-nav media-lightbox-prev"
                type="button"
                aria-label={ru.miniApp.search.previousMedia}
                onClick={() => movePostMedia(-1, false)}
              >
                <ChevronLeft aria-hidden />
              </button>
              <button
                className="media-lightbox-nav media-lightbox-next"
                type="button"
                aria-label={ru.miniApp.search.nextMedia}
                onClick={() => movePostMedia(1, false)}
              >
                <ChevronRight aria-hidden />
              </button>
            </>
          ) : null}
          <div
            className={`post-media-lightbox-stage${mediaMotion ? ` is-swipe-${mediaMotion}` : ''}`}
            key={`${currentMedia.id ?? mediaIndex}-${mediaMotionSequence}`}
          >
            {renderCurrentMedia(true)}
            {carouselItems.length > 1 ? (
              <>
                <button
                  type="button"
                  className="post-media-tap-zone is-previous"
                  aria-hidden="true"
                  tabIndex={-1}
                  onClick={() => movePostMedia(-1, false)}
                />
                <button
                  type="button"
                  className="post-media-tap-zone is-next"
                  aria-hidden="true"
                  tabIndex={-1}
                  onClick={() => movePostMedia(1, false)}
                />
              </>
            ) : null}
          </div>
          {carouselItems.length > 1 ? (
            <div
              className="post-media-thumbnail-strip"
              aria-label={ru.miniApp.search.openMediaFullscreen}
            >
              {carouselItems.map((item, index) => (
                <button
                  type="button"
                  className={index === mediaIndex ? 'is-active' : ''}
                  key={item.id ?? index}
                  ref={(element) => {
                    mediaThumbnailRefs.current[index] = element;
                  }}
                  aria-label={`${ru.miniApp.search.openMediaFullscreen} ${index + 1}`}
                  aria-current={index === mediaIndex ? 'true' : undefined}
                  onClick={() => selectPostMedia(index, false)}
                >
                  {renderPostCollageItem(item, index)}
                </button>
              ))}
            </div>
          ) : null}
        </div>
      ) : null}
      <div className="post-card-metadata px-5 pb-5">
        {[
          ...parseStringArray(post.tags || '[]'),
          ...parseStringArray(post.fandoms || '[]'),
          ...parseStringArray(post.hashtags || '[]').map((item) => `#${item}`),
        ].map((item) => (
          <span className="status-pill" key={item}>
            {item}
          </span>
        ))}
      </div>
      {post.owner_liked ? (
        <p className="owner-blessing owner-blessing-post mx-5 mb-5">
          {ru.miniApp.social.postOwnerBlessing}
        </p>
      ) : null}
      <div className="post-card-actions px-5 pb-5">
        <div className="post-metrics">
          {isOwnPost ? (
            <>
              <span className="status-pill post-metric">
                <Heart className="h-4 w-4" /> {formatMetric(post.likes, open)}
              </span>
              <span className="status-pill post-metric">
                <ThumbsDown className="h-4 w-4" /> {formatMetric(post.dislikes, open)}
              </span>
            </>
          ) : (
            <>
              <Button
                className="post-metric"
                variant={ratingPreview.ownRating === 1 ? 'primary' : 'secondary'}
                aria-pressed={ratingPreview.ownRating === 1}
                disabled={rate.isPending}
                onClick={() => rate.mutate(1)}
              >
                <Heart className="h-4 w-4" /> {formatMetric(ratingPreview.likes, open)}
              </Button>
              <Button
                className="post-metric"
                variant={ratingPreview.ownRating === -1 ? 'danger' : 'secondary'}
                aria-pressed={ratingPreview.ownRating === -1}
                disabled={rate.isPending}
                onClick={() => rate.mutate(-1)}
              >
                <ThumbsDown className="h-4 w-4" /> {formatMetric(ratingPreview.dislikes, open)}
              </Button>
            </>
          )}
          <Button
            className="post-comments-action"
            variant="secondary"
            onClick={() => setOpen((value) => !value)}
          >
            <MessageCircle className="h-4 w-4" /> {ru.miniApp.social.comments} ·{' '}
            {formatMetric(post.comment_count, open)}
          </Button>
          <Button className="post-metric" variant="secondary" onClick={() => setShareOpen(true)}>
            <Share2 className="h-4 w-4" aria-hidden /> {formatMetric(post.share_count, open)}
          </Button>
        </div>
        {!open && topComment ? (
          <button
            type="button"
            className="post-top-comment"
            key={topComment.id}
            onClick={() => setOpen(true)}
          >
            <ProfileAvatar
              mediaId={topComment.avatarMediaId}
              renderMode={topComment.avatarRenderMode}
              name={topComment.displayName}
            />
            <span>
              <small>{ru.miniApp.social.interestingComment}</small>
              <strong>{topComment.displayName}</strong>
              <span>{topComment.body}</span>
            </span>
            <MessageCircle aria-hidden />
          </button>
        ) : null}
        {canModerate ? (
          <div className="quick-moderation-control">
            <button
              type="button"
              className="quick-moderation-trigger"
              aria-label={ru.miniApp.search.quickModeration}
              aria-expanded={moderationOpen}
              onClick={() => setModerationOpen((value) => !value)}
            >
              <Shield aria-hidden />
            </button>
            {moderationOpen ? (
              <>
                <button
                  type="button"
                  className="quick-moderation-backdrop"
                  aria-label={ru.miniApp.community.cancelAction}
                  onClick={() => setModerationOpen(false)}
                />
                <div className="quick-moderation-menu" role="menu">
                  <strong>{ru.miniApp.search.quickModeration}</strong>
                  <Button
                    variant="secondary"
                    loading={moderatePost.isPending}
                    onClick={() => moderatePost.mutate('limited')}
                  >
                    {ru.miniApp.admin.limitPost}
                  </Button>
                  <Button
                    variant="secondary"
                    loading={moderatePost.isPending}
                    onClick={() => moderatePost.mutate('shadow_banned')}
                  >
                    {ru.miniApp.admin.shadowBanPost}
                  </Button>
                  <Button
                    variant="danger"
                    loading={moderatePost.isPending}
                    onClick={() => moderatePost.mutate('blocked')}
                  >
                    {ru.miniApp.admin.blockPost}
                  </Button>
                </div>
              </>
            ) : null}
          </div>
        ) : null}
        <span
          className="post-view-count"
          title={formatMetric(Number(post.view_count ?? 0) + viewDelta, true)}
          aria-label={ru.miniApp.community.postViews(Number(post.view_count ?? 0) + viewDelta)}
        >
          <Eye aria-hidden />
          {formatMetric(Number(post.view_count ?? 0) + viewDelta, open)}
        </span>
      </div>
      {isOwnPost && settingsOpen ? (
        <div className="border-t border-white/10 p-5" data-testid={`post-settings-${post.id}`}>
          <label className="field-label" htmlFor={`post-title-${post.id}`}>
            {ru.miniApp.social.postTitle}
          </label>
          <input
            id={`post-title-${post.id}`}
            className="input"
            maxLength={120}
            value={postTitle}
            onChange={(event) => setPostTitle(event.target.value)}
          />
          <label className="field-label mt-4" htmlFor={`post-body-${post.id}`}>
            {ru.miniApp.social.postBody}
          </label>
          <textarea
            id={`post-body-${post.id}`}
            className="input min-h-48"
            maxLength={8000}
            value={postBody}
            onChange={(event) => setPostBody(event.target.value)}
          />
          <p className="mt-2 text-xs text-muted">{ru.miniApp.social.postMarkdownHint}</p>
          <label className="field-label mt-4" htmlFor={`post-playlist-title-${post.id}`}>
            {ru.miniApp.social.postPlaylistTitle}
          </label>
          <input
            id={`post-playlist-title-${post.id}`}
            className="input"
            maxLength={120}
            value={postPlaylistTitle}
            onChange={(event) => setPostPlaylistTitle(event.target.value)}
          />
          <p className="mt-2 text-xs text-muted">{ru.miniApp.social.postPlaylistTitleHint}</p>
          <label className="field-label mt-4" htmlFor={`post-tags-${post.id}`}>
            {ru.miniApp.social.postTags}
          </label>
          <input
            id={`post-tags-${post.id}`}
            className="input"
            value={postTags}
            onChange={(event) => setPostTags(event.target.value)}
          />
          <label className="field-label mt-4" htmlFor={`post-fandoms-${post.id}`}>
            {ru.miniApp.social.postFandoms}
          </label>
          <input
            id={`post-fandoms-${post.id}`}
            className="input"
            value={postFandoms}
            onChange={(event) => setPostFandoms(event.target.value)}
          />
          <label className="field-label mt-4" htmlFor={`post-hashtags-${post.id}`}>
            {ru.miniApp.social.postHashtags}
          </label>
          <input
            id={`post-hashtags-${post.id}`}
            className="input"
            value={postHashtags}
            onChange={(event) => setPostHashtags(event.target.value)}
          />
          <p className="mt-2 text-xs text-muted">{ru.miniApp.social.postMetadataHint}</p>
          {mediaItems.length ? (
            <div className="post-media-manager mt-4">
              {mediaItems.map((item, index) => (
                <div className="post-media-manager-item" key={item.id ?? `legacy-${index}`}>
                  <FileText aria-hidden />
                  <span>
                    <strong>
                      {item.track_title || `${ru.miniApp.profile.mediaTitle} ${index + 1}`}
                    </strong>
                    <small>
                      {item.track_performer
                        ? `${item.track_performer} · ${item.media_type}`
                        : item.media_type}
                    </small>
                  </span>
                  {item.id ? (
                    <button
                      type="button"
                      aria-label={ru.miniApp.social.removePostMediaItem}
                      onClick={() => setPostMediaToDelete(item.id)}
                    >
                      <Trash2 aria-hidden />
                    </button>
                  ) : null}
                </div>
              ))}
            </div>
          ) : null}
          <div className="mt-4 flex flex-wrap gap-2">
            <Button
              loading={updatePost.isPending}
              disabled={!postBody.trim()}
              onClick={() => updatePost.mutate()}
            >
              <Save className="h-4 w-4" /> {ru.miniApp.social.savePost}
            </Button>
            <Button variant="secondary" onClick={cancelPostEditing}>
              <X className="h-4 w-4" /> {ru.miniApp.social.cancelPostEditing}
            </Button>
            <Button variant="secondary" onClick={addMedia}>
              <ImagePlus className="h-4 w-4" /> {ru.miniApp.social.addPostMedia}
            </Button>
            {mediaItems.length ? (
              <Button
                variant="danger"
                loading={removeMedia.isPending}
                onClick={() => setPostMediaToDelete('all')}
              >
                <Trash2 className="h-4 w-4" /> {ru.miniApp.social.removePostMedia}
              </Button>
            ) : null}
            <Button
              variant="danger"
              loading={deletePost.isPending}
              onClick={() => {
                if (window.confirm(ru.miniApp.social.deletePostConfirm)) {
                  deletePost.mutate();
                }
              }}
            >
              <Trash2 className="h-4 w-4" /> {ru.miniApp.social.deletePost}
            </Button>
          </div>
          {updatePost.isError ? (
            <div className="error-box mt-3">{updatePost.error.message}</div>
          ) : null}
          {removeMedia.isError ? (
            <div className="error-box mt-3">{removeMedia.error.message}</div>
          ) : null}
          {deletePost.isError ? (
            <div className="error-box mt-3">{deletePost.error.message}</div>
          ) : null}
        </div>
      ) : null}
      {open ? (
        <div className="border-t border-white/10 p-5">
          <div className="comment-sort-toolbar">
            <strong>{ru.miniApp.social.comments}</strong>
            <div className="comment-sort">
              <button
                type="button"
                aria-haspopup="menu"
                aria-expanded={commentSortOpen}
                onClick={() => setCommentSortOpen((value) => !value)}
              >
                {commentSort === 'interesting'
                  ? ru.miniApp.social.commentsInteresting
                  : ru.miniApp.social.commentsNewest}
                <ChevronDown aria-hidden />
              </button>
              {commentSortOpen ? (
                <div className="comment-sort-menu" role="menu">
                  {(['interesting', 'new'] as const).map((value) => (
                    <button
                      type="button"
                      role="menuitemradio"
                      aria-checked={commentSort === value}
                      key={value}
                      onClick={() => {
                        setCommentSort(value);
                        setCommentSortOpen(false);
                      }}
                    >
                      {value === 'interesting'
                        ? ru.miniApp.social.commentsInteresting
                        : ru.miniApp.social.commentsNewest}
                    </button>
                  ))}
                </div>
              ) : null}
            </div>
          </div>
          {replyTo ? (
            <div className="comment-reply-context">
              <span>{ru.miniApp.social.replyPlaceholder(replyTo.name)}</span>
              <button type="button" onClick={() => setReplyTo(null)}>
                {ru.miniApp.social.cancelReply}
              </button>
            </div>
          ) : null}
          <div className="comment-composer comment-composer-primary">
            <textarea
              className="comment-textarea"
              maxLength={1000}
              placeholder={
                replyTo
                  ? ru.miniApp.social.replyPlaceholder(replyTo.name)
                  : ru.miniApp.social.commentPlaceholder
              }
              value={body}
              onChange={(event) => setBody(event.target.value)}
            />
            <div className="comment-composer-footer">
              <span>{body.length}/1000</span>
              <Button
                disabled={!body.trim()}
                loading={comment.isPending}
                onClick={() => comment.mutate()}
              >
                {ru.miniApp.social.sendComment}
              </Button>
            </div>
          </div>
          <div className="space-y-3">
            {comments.data
              ?.filter(
                (item) => !item.parent_comment_id || expandedThreads.has(item.parent_comment_id),
              )
              .map((item: PostComment) => (
                <div
                  key={item.id}
                  className={`comment-thread-item relative ${
                    item.parent_comment_id ? 'reply' : ''
                  }`}
                >
                  <Link className="comment-avatar-link" href={`/profiles/${item.author_user_id}`}>
                    <ProfileAvatar
                      mediaId={item.avatar_media_id}
                      renderMode={item.avatar_render_mode}
                      name={item.display_name}
                    />
                  </Link>
                  <div className="comment-content">
                    <Link
                      className="profile-author-link comment-author-link"
                      href={`/profiles/${item.author_user_id}`}
                    >
                      <strong>{item.display_name}</strong>
                      <VerificationBadge kind={item.verification_kind} premium={item.has_premium} />
                    </Link>
                    <button
                      className="comment-menu-trigger"
                      type="button"
                      aria-label={ru.miniApp.social.commentMenu}
                      aria-haspopup="menu"
                      aria-expanded={commentMenuId === item.id}
                      onClick={() =>
                        setCommentMenuId((current) => (current === item.id ? null : item.id))
                      }
                    >
                      <MoreVertical aria-hidden />
                    </button>
                    {commentMenuId === item.id ? (
                      <div className="comment-item-menu" role="menu">
                        <button
                          type="button"
                          role="menuitem"
                          onClick={() => {
                            setCommentMenuId(null);
                            const description = window
                              .prompt(ru.miniApp.social.reportCommentPrompt)
                              ?.trim();
                            if (description) {
                              report.mutate({
                                reportedUserId: item.author_user_id,
                                commentId: item.id,
                                description,
                              });
                            }
                          }}
                        >
                          <Flag aria-hidden /> {ru.miniApp.social.report}
                        </button>
                      </div>
                    ) : null}
                    {editingCommentId === item.id ? (
                      <div className="comment-composer mt-2">
                        <textarea
                          className="comment-textarea"
                          maxLength={1000}
                          value={editingCommentBody}
                          onChange={(event) => setEditingCommentBody(event.target.value)}
                        />
                        <div className="comment-composer-footer">
                          <span>{editingCommentBody.length}/1000</span>
                          <div className="flex flex-wrap gap-2">
                            <Button
                              disabled={!editingCommentBody.trim()}
                              loading={updateComment.isPending}
                              onClick={() => updateComment.mutate()}
                            >
                              <Save className="h-3.5 w-3.5" /> {ru.miniApp.social.saveComment}
                            </Button>
                            <Button variant="secondary" onClick={cancelCommentEditing}>
                              <X className="h-3.5 w-3.5" /> {ru.miniApp.social.cancelCommentEditing}
                            </Button>
                          </div>
                        </div>
                        {updateComment.isError ? (
                          <div className="error-box mt-2">{updateComment.error.message}</div>
                        ) : null}
                      </div>
                    ) : (
                      <ProfileMarkdown
                        className="whitespace-pre-wrap break-words text-sm text-soft"
                        allowLinks
                      >
                        {item.body}
                      </ProfileMarkdown>
                    )}
                    {item.owner_liked ? (
                      <p className="owner-blessing owner-blessing-comment">
                        {ru.miniApp.social.commentOwnerBlessing}
                      </p>
                    ) : null}
                    <div className="comment-action-row mt-2">
                      <Button
                        variant={item.own_rating === 1 ? 'primary' : 'ghost'}
                        onClick={() => rateComment.mutate({ id: item.id, value: 1 })}
                      >
                        <Heart className="h-3.5 w-3.5" /> {item.likes}
                      </Button>
                      <Button
                        variant={item.own_rating === -1 ? 'danger' : 'ghost'}
                        onClick={() => rateComment.mutate({ id: item.id, value: -1 })}
                      >
                        <ThumbsDown className="h-3.5 w-3.5" /> {item.dislikes}
                      </Button>
                      <Button
                        variant="ghost"
                        aria-label={ru.miniApp.social.replyToComment}
                        title={ru.miniApp.social.replyToComment}
                        onClick={() => setReplyTo({ id: item.id, name: item.display_name })}
                      >
                        <MessageCircle className="h-3.5 w-3.5" aria-hidden />
                      </Button>
                      {item.author_user_id === me.data?.userId && editingCommentId !== item.id ? (
                        <Button
                          variant="ghost"
                          onClick={() => {
                            setEditingCommentId(item.id);
                            setEditingCommentBody(item.body);
                            updateComment.reset();
                          }}
                        >
                          <Pencil className="h-3.5 w-3.5" /> {ru.miniApp.social.editComment}
                        </Button>
                      ) : null}
                      {item.author_user_id === me.data?.userId ? (
                        <Button
                          variant="ghost"
                          aria-label={ru.miniApp.social.deleteComment}
                          title={ru.miniApp.social.deleteComment}
                          onClick={() => setOwnCommentToDelete(item.id)}
                        >
                          <Trash2 className="h-3.5 w-3.5" aria-hidden />
                        </Button>
                      ) : null}
                      {canModerate && item.author_user_id !== me.data?.userId ? (
                        <Button
                          variant="danger"
                          loading={deleteComment.isPending}
                          onClick={() => {
                            const reason = window
                              .prompt(ru.miniApp.social.deleteCommentReason)
                              ?.trim();
                            if (reason && reason.length >= 3) {
                              deleteComment.mutate({ commentId: item.id, reason });
                            }
                          }}
                        >
                          <Trash2 className="h-3.5 w-3.5" /> {ru.miniApp.social.deleteComment}
                        </Button>
                      ) : null}
                    </div>
                    {!item.parent_comment_id && item.thread_reply_count > 0 ? (
                      <button
                        className="comment-replies-toggle"
                        type="button"
                        aria-expanded={expandedThreads.has(item.id)}
                        onClick={() =>
                          setExpandedThreads((current) => {
                            const next = new Set(current);
                            if (next.has(item.id)) next.delete(item.id);
                            else next.add(item.id);
                            return next;
                          })
                        }
                      >
                        <ChevronRight aria-hidden />
                        {expandedThreads.has(item.id)
                          ? ru.miniApp.social.hideCommentReplies
                          : ru.miniApp.social.commentReplies(item.thread_reply_count)}
                      </button>
                    ) : null}
                  </div>
                </div>
              ))}
          </div>
        </div>
      ) : null}
      <ConfirmDialog
        open={Boolean(postMediaToDelete)}
        title={
          postMediaToDelete === 'all'
            ? ru.miniApp.social.removePostMedia
            : ru.miniApp.social.removePostMediaItem
        }
        description={
          postMediaToDelete === 'all'
            ? ru.miniApp.social.removePostMediaConfirm
            : ru.miniApp.social.removePostMediaItemConfirm
        }
        confirmLabel={
          postMediaToDelete === 'all'
            ? ru.miniApp.social.removePostMedia
            : ru.miniApp.social.removePostMediaItem
        }
        cancelLabel={ru.miniApp.profile.cancelMediaDeletion}
        loading={removeMedia.isPending}
        onCancel={() => setPostMediaToDelete(null)}
        onConfirm={() => {
          if (postMediaToDelete) {
            removeMedia.mutate(postMediaToDelete === 'all' ? undefined : postMediaToDelete);
          }
        }}
      />
      <ConfirmDialog
        open={Boolean(ownCommentToDelete)}
        title={ru.miniApp.social.deleteOwnCommentConfirmTitle}
        description={ru.miniApp.social.deleteOwnCommentConfirmDescription}
        confirmLabel={ru.miniApp.social.deleteComment}
        cancelLabel={ru.miniApp.social.cancelCommentDeletion}
        loading={deleteOwnComment.isPending}
        onCancel={() => setOwnCommentToDelete(null)}
        onConfirm={() => {
          if (ownCommentToDelete) deleteOwnComment.mutate(ownCommentToDelete);
        }}
      />
      {engagementKind ? (
        <div className="confirm-dialog-backdrop" role="presentation">
          <Card className="confirm-dialog post-engagement-dialog" role="dialog" aria-modal="true">
            <header>
              <h2>
                {engagementKind === 'ratings'
                  ? ru.miniApp.social.postRatedBy
                  : ru.miniApp.social.postSharedBy}
              </h2>
              <button type="button" onClick={() => setEngagementKind(null)}>
                <X aria-hidden />
              </button>
            </header>
            {engagement.isLoading ? <Skeleton className="h-32" /> : null}
            <div className="post-engagement-list">
              {engagement.data?.map((person: PostEngagementUser) => (
                <Link
                  key={person.id}
                  href={`/profiles/${person.id}`}
                  onClick={() => setEngagementKind(null)}
                >
                  <span className="post-engagement-kind" aria-hidden>
                    {engagementKind === 'ratings' ? (
                      person.value && person.value < 0 ? (
                        <ThumbsDown />
                      ) : (
                        <Heart />
                      )
                    ) : (
                      <Share2 />
                    )}
                  </span>
                  <ProfileAvatar
                    mediaId={person.avatar_media_id}
                    renderMode={person.avatar_render_mode}
                    name={person.display_name}
                  />
                  <strong>
                    {person.display_name}
                    <VerificationBadge
                      kind={person.verification_kind}
                      premium={person.has_premium}
                    />
                  </strong>
                </Link>
              ))}
              {!engagement.isLoading && !engagement.data?.length ? (
                <p className="post-engagement-empty">{ru.miniApp.social.engagementEmpty}</p>
              ) : null}
            </div>
          </Card>
        </div>
      ) : null}
      <ShareToChatsDialog
        open={shareOpen}
        loading={sharePost.isPending}
        onClose={() => setShareOpen(false)}
        allowCaption
        onSend={(conversationIds, caption) =>
          sharePost.mutate({ conversationIds, ...(caption ? { caption } : {}) })
        }
      />
      <ShareToChatsDialog
        open={playlistShareTrackIds.length > 0}
        loading={sharePlaylist.isPending}
        onClose={() => setPlaylistShareTrackIds([])}
        onSend={(conversationIds) => sharePlaylist.mutate(conversationIds)}
      />
    </Card>
  );
}

function parsePostMedia(post: SocialPost): Array<{
  id: string | null;
  media_type: string;
  mime_type?: string | null;
  track_title: string | null;
  track_performer: string | null;
  has_thumbnail?: number;
}> {
  try {
    const parsed: unknown = JSON.parse(post.media_items || '[]');
    if (Array.isArray(parsed)) {
      const items = parsed.filter(
        (
          item,
        ): item is {
          id: string;
          media_type: string;
          mime_type?: string | null;
          track_title: string | null;
          track_performer: string | null;
          has_thumbnail?: number;
        } =>
          typeof item === 'object' &&
          item !== null &&
          typeof (item as Record<string, unknown>).id === 'string' &&
          typeof (item as Record<string, unknown>).media_type === 'string',
      );
      if (items.length) return items;
    }
  } catch {
    // Legacy posts use their original single-media columns.
  }
  return post.media_telegram_file_id
    ? [
        {
          id: null,
          media_type: post.content_type,
          mime_type: post.media_mime_type ?? null,
          track_title: post.track_title,
          track_performer: post.track_performer,
          has_thumbnail: post.media_thumbnail_file_id ? 1 : 0,
        },
      ]
    : [];
}

type InterestingPostComment = {
  id: string;
  body: string;
  displayName: string;
  avatarMediaId: string | null;
  avatarRenderMode: 'photo' | 'animation' | 'still' | null;
};

function parseTopComments(value: string | null | undefined): InterestingPostComment[] {
  if (!value) return [];
  try {
    const parsed: unknown = JSON.parse(value);
    const values = Array.isArray(parsed) ? parsed : [parsed];
    return values.flatMap((candidate): InterestingPostComment[] => {
      if (!candidate || typeof candidate !== 'object') return [];
      const item = candidate as Record<string, unknown>;
      if (
        typeof item.id !== 'string' ||
        typeof item.body !== 'string' ||
        typeof item.display_name !== 'string'
      ) {
        return [];
      }
      const renderMode = item.avatar_render_mode;
      return [
        {
          id: item.id,
          body: item.body,
          displayName: item.display_name,
          avatarMediaId: typeof item.avatar_media_id === 'string' ? item.avatar_media_id : null,
          avatarRenderMode:
            renderMode === 'photo' || renderMode === 'animation' || renderMode === 'still'
              ? renderMode
              : null,
        },
      ];
    });
  } catch {
    return [];
  }
}

export function PostsPage() {
  const [location] = useLocation();
  const [postPathMatched, postPathParams] = useRoute('/posts/:postId');
  const postFromPath = postPathMatched ? (postPathParams?.postId ?? null) : null;
  const postQuery = location.includes('?')
    ? (location.split('?')[1] ?? '')
    : window.location.search;
  const postFromLink = postFromPath ?? new URLSearchParams(postQuery).get('post');
  const linkedPostId =
    postFromLink &&
    /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(postFromLink)
      ? postFromLink
      : null;
  const [feedSort, setFeedSort] = useState<'interesting' | 'new'>(() =>
    window.localStorage.getItem('rm_post_feed_sort') === 'new' ? 'new' : 'interesting',
  );
  const [followingOnly, setFollowingOnly] = useState(
    () => window.localStorage.getItem('rm_post_feed_following_only') === 'true',
  );
  const [feedMenuOpen, setFeedMenuOpen] = useState(false);
  const feedMenuRef = useRef<HTMLDivElement>(null);
  const posts = useQuery({
    queryKey: ['posts', feedSort, followingOnly],
    queryFn: () => api.posts(feedSort, followingOnly),
  });
  const linkedPost = useQuery({
    queryKey: ['post', linkedPostId],
    queryFn: () => api.post(linkedPostId!),
    enabled: Boolean(linkedPostId),
  });
  const me = useQuery({ queryKey: ['me'], queryFn: api.me });
  useEffect(() => {
    window.localStorage.setItem('rm_post_feed_sort', feedSort);
  }, [feedSort]);
  useEffect(() => {
    window.localStorage.setItem('rm_post_feed_following_only', String(followingOnly));
  }, [followingOnly]);
  useEffect(() => {
    if (!feedMenuOpen) return;
    const closeOutside = (event: PointerEvent) => {
      if (!feedMenuRef.current?.contains(event.target as Node)) setFeedMenuOpen(false);
    };
    document.addEventListener('pointerdown', closeOutside);
    return () => document.removeEventListener('pointerdown', closeOutside);
  }, [feedMenuOpen]);
  if (posts.isLoading || (linkedPostId && linkedPost.isLoading))
    return <Skeleton className="h-80" />;
  const visiblePosts = linkedPost.data
    ? [linkedPost.data, ...(posts.data ?? []).filter((post) => post.id !== linkedPost.data.id)]
    : posts.data;
  return (
    <div>
      <SectionTitle
        eyebrow={ru.miniApp.social.postsEyebrow}
        action={
          <div className="post-feed-settings" ref={feedMenuRef}>
            <button
              type="button"
              className="icon-button"
              aria-label={ru.miniApp.social.postFeedSettings}
              aria-haspopup="menu"
              aria-expanded={feedMenuOpen}
              onClick={() => setFeedMenuOpen((value) => !value)}
            >
              <MoreVertical aria-hidden />
            </button>
            {feedMenuOpen ? (
              <div className="post-feed-settings-menu" role="menu">
                {(['interesting', 'new'] as const).map((value) => (
                  <button
                    type="button"
                    role="menuitemradio"
                    aria-checked={feedSort === value}
                    key={value}
                    onClick={() => {
                      setFeedSort(value);
                      setFeedMenuOpen(false);
                    }}
                  >
                    {value === 'interesting'
                      ? ru.miniApp.social.commentsInteresting
                      : ru.miniApp.social.commentsNewest}
                  </button>
                ))}
                <button
                  type="button"
                  role="menuitemcheckbox"
                  aria-checked={followingOnly}
                  onClick={() => {
                    setFollowingOnly((value) => {
                      const enabled = !value;
                      if (enabled) setFeedSort('interesting');
                      return enabled;
                    });
                    setFeedMenuOpen(false);
                  }}
                >
                  {ru.miniApp.social.postsFollowingOnly}
                </button>
              </div>
            ) : null}
          </div>
        }
      >
        {ru.miniApp.social.postsTitle}
      </SectionTitle>
      <p className="mb-4 text-sm text-muted">{ru.miniApp.social.createPostHint}</p>
      <div className="space-y-4">
        {visiblePosts?.map((post) => (
          <PostCard
            key={post.id}
            post={post}
            initialOpen={linkedPostId === post.id}
            canModerate={Boolean(me.data?.isAdmin)}
          />
        ))}
        {!visiblePosts?.length ? (
          <EmptyState
            icon={<FileText className="h-7 w-7" />}
            title={ru.miniApp.social.postsTitle}
            description={ru.miniApp.social.postsEmpty}
          />
        ) : null}
      </div>
    </div>
  );
}
