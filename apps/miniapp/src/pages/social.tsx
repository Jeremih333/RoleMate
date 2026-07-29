import { useEffect, useRef, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import {
  FileText,
  Heart,
  ImagePlus,
  MessageCircle,
  Pencil,
  Plus,
  Save,
  Settings2,
  ThumbsDown,
  Trash2,
} from 'lucide-react';
import { ru } from '@rolemate/shared';
import { api, type SocialPost } from '../api.js';
import { ProfileAvatar } from '../components/profile-avatar.js';
import { ProfileMarkdown } from '../components/markdown.js';
import { VerificationBadge } from '../components/verification-badge.js';
import { Button, Card, EmptyState, SectionTitle, Skeleton } from '../components/ui.js';
import { getTelegram } from '../telegram.js';
import { useRoute } from 'wouter';

export function PublicProfilePage() {
  const queryClient = useQueryClient();
  const profile = useQuery({ queryKey: ['public-profile'], queryFn: api.publicProfile });
  const media = useQuery({ queryKey: ['profile-media'], queryFn: api.profileMedia });
  const ownPosts = useQuery({ queryKey: ['own-posts'], queryFn: api.ownPosts });
  const usernames = useQuery({
    queryKey: ['public-profile-usernames'],
    queryFn: api.publicProfileUsernames,
  });
  const [displayName, setDisplayName] = useState('');
  const [bio, setBio] = useState('');
  const [avatarMediaId, setAvatarMediaId] = useState<string | null>(null);
  const [editing, setEditing] = useState(false);
  const [initialized, setInitialized] = useState(false);
  const [username, setUsername] = useState('');
  const [usernameInitialized, setUsernameInitialized] = useState(false);
  const editorRef = useRef<HTMLDivElement>(null);
  const displayNameRef = useRef<HTMLInputElement>(null);
  useEffect(() => {
    if (!profile.data || initialized) return;
    setDisplayName(profile.data.display_name);
    setBio(profile.data.bio);
    setAvatarMediaId(profile.data.avatar_media_id);
    setInitialized(true);
  }, [initialized, profile.data]);
  useEffect(() => {
    if (usernameInitialized || !usernames.data) return;
    setUsername(usernames.data[0]?.username ?? '');
    setUsernameInitialized(true);
  }, [usernameInitialized, usernames.data]);
  const save = useMutation({
    mutationFn: () =>
      api.savePublicProfile({
        displayName,
        bio,
        avatarMediaId,
      }),
    onSuccess: () => {
      setEditing(false);
      void queryClient.invalidateQueries({ queryKey: ['public-profile'] });
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
  if (profile.isLoading) return <Skeleton className="h-80" />;
  if (!profile.data) return null;
  const avatarChoices = (media.data ?? []).filter(
    (item) =>
      item.moderation_status === 'approved' &&
      (item.media_type === 'photo' || item.media_type === 'video'),
  );
  const aliases = parseStringArray(profile.data.usernames ?? '[]');
  const featuredAudio = parseFeaturedAudio(profile.data.featured_audio_items ?? '[]');
  const openBot = (parameter: 'profile_photo' | 'create_post') => {
    const link = `https://t.me/r0lemate_bot?start=${parameter}`;
    const telegram = getTelegram();
    if (telegram) telegram.openTelegramLink(link);
    else window.open(link, '_blank', 'noopener,noreferrer');
  };
  const openEditor = () => {
    setEditing(true);
    window.requestAnimationFrame(() => {
      editorRef.current?.scrollIntoView({ behavior: 'smooth', block: 'start' });
      window.setTimeout(() => displayNameRef.current?.focus({ preventScroll: true }), 350);
    });
  };
  return (
    <div>
      <SectionTitle eyebrow={ru.miniApp.social.profileEyebrow}>
        {ru.miniApp.social.profileTitle}
      </SectionTitle>
      <Card className="p-5">
        <div className="public-profile-header">
          <ProfileAvatar
            mediaId={profile.data.avatar_media_id}
            renderMode={profile.data.avatar_render_mode}
            name={displayName}
            className="profile-avatar-large"
          />
          <div className="public-profile-identity">
            <strong className="flex items-center gap-1 break-words">
              {displayName}
              <VerificationBadge kind={profile.data.verification_kind} />
            </strong>
            <p className="mt-1 break-words text-xs text-muted">
              {ru.miniApp.social.internalId}: {profile.data.id}
            </p>
            <div className="mt-2 flex flex-wrap gap-2">
              {aliases.map((alias) => (
                <a className="tag" href={`/u/${alias}`} key={alias}>
                  @{alias}
                </a>
              ))}
            </div>
          </div>
          <Button
            className="public-profile-edit-button"
            variant="secondary"
            aria-expanded={editing}
            aria-controls="public-profile-editor"
            onClick={openEditor}
          >
            <Pencil className="h-4 w-4" /> {ru.miniApp.social.editProfile}
          </Button>
        </div>
        <p className="mt-5 whitespace-pre-wrap break-words text-sm leading-relaxed text-soft">
          {profile.data.bio || ru.miniApp.social.bioEmpty}
        </p>
        {featuredAudio.length ? (
          <div className="profile-audio-list">
            {featuredAudio.map((track) => (
              <div className="profile-track" key={track.id}>
                <div className="profile-track-cover">
                  {track.has_thumbnail ? (
                    <img src={`/api/profile-media/${track.id}/thumbnail`} alt="" />
                  ) : (
                    <FileText aria-hidden />
                  )}
                </div>
                <div className="profile-track-content">
                  <strong>{track.track_title || ru.miniApp.search.trackUnknown}</strong>
                  <span>{track.track_performer || ru.miniApp.search.performerUnknown}</span>
                  <audio src={`/api/profile-media/${track.id}`} controls preload="metadata" />
                </div>
              </div>
            ))}
          </div>
        ) : null}
        <div className="mt-4 flex flex-wrap gap-2 text-xs text-muted">
          <span className="status-pill">
            {ru.miniApp.social.questionnaireCount(profile.data.questionnaire_count)}
          </span>
          <span className="status-pill">
            {ru.miniApp.social.postCount(profile.data.post_count)}
          </span>
        </div>
        {profile.data.moderation_status === 'blocked' ? (
          <div className="error-box mt-4">
            {ru.miniApp.social.profileBlocked}
            {profile.data.moderation_reason ? `: ${profile.data.moderation_reason}` : ''}
          </div>
        ) : null}
        {editing ? (
          <div
            id="public-profile-editor"
            ref={editorRef}
            className="public-profile-editor mt-6 scroll-mt-4 border-t border-white/10 pt-5"
          >
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
              <div className="mt-3 grid grid-cols-3 gap-3">
                {avatarChoices.map((item) => (
                  <button
                    className={`overflow-hidden rounded-2xl border ${
                      avatarMediaId === item.id
                        ? 'border-violet-400 ring-2 ring-violet-500/40'
                        : 'border-white/10'
                    }`}
                    type="button"
                    key={item.id}
                    aria-label={ru.miniApp.social.chooseAvatar}
                    onClick={() => setAvatarMediaId(item.id)}
                  >
                    {item.media_type === 'video' ? (
                      <video
                        className="aspect-square w-full object-cover"
                        src={`/api/profile-media/${item.id}`}
                        muted
                        loop
                        autoPlay
                        playsInline
                      />
                    ) : (
                      <img
                        className="aspect-square w-full object-cover"
                        src={`/api/profile-media/${item.id}`}
                        alt=""
                      />
                    )}
                  </button>
                ))}
              </div>
              <div className="mt-3 flex flex-wrap gap-2">
                <Button variant="secondary" onClick={() => openBot('profile_photo')}>
                  <ImagePlus className="h-4 w-4" /> {ru.miniApp.social.addAvatar}
                </Button>
                {avatarMediaId ? (
                  <Button variant="ghost" onClick={() => setAvatarMediaId(null)}>
                    {ru.miniApp.social.removeAvatar}
                  </Button>
                ) : null}
              </div>
            </div>
            <Button
              className="mt-5"
              loading={save.isPending}
              disabled={displayName.trim().length < 2}
              onClick={() => save.mutate()}
            >
              <Save className="h-4 w-4" /> {ru.miniApp.social.save}
            </Button>
            {save.isSuccess ? (
              <p className="mt-3 text-sm text-emerald-400">{ru.miniApp.social.saved}</p>
            ) : null}
            {save.isError ? <div className="error-box mt-3">{save.error.message}</div> : null}
          </div>
        ) : null}
      </Card>
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

function parseFeaturedAudio(value: string): Array<{
  id: string;
  track_title: string | null;
  track_performer: string | null;
  has_thumbnail: number;
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
      } =>
        typeof item === 'object' &&
        item !== null &&
        typeof (item as Record<string, unknown>).id === 'string',
    );
  } catch {
    return [];
  }
}

export function PublicProfileViewerPage() {
  const [idMatch, idParams] = useRoute('/profiles/:userId');
  const [, usernameParams] = useRoute('/u/:username');
  const userId = idMatch ? idParams?.userId : undefined;
  const username = idMatch ? undefined : usernameParams?.username;
  const profile = useQuery({
    queryKey: ['public-profile-view', userId ?? username],
    queryFn: () =>
      userId ? api.publicProfileByUserId(userId) : api.publicProfileByUsername(username ?? ''),
    enabled: Boolean(userId || username),
  });
  if (profile.isLoading) return <Skeleton className="h-80" />;
  if (profile.isError) return <div className="error-box">{profile.error.message}</div>;
  if (!profile.data) return null;
  const aliases = parseStringArray(profile.data.usernames);
  return (
    <div>
      <SectionTitle eyebrow={ru.miniApp.social.profileEyebrow}>
        {profile.data.display_name}
      </SectionTitle>
      <Card className="p-5">
        <div className="public-profile-header">
          <ProfileAvatar
            mediaId={profile.data.avatar_media_id}
            renderMode={profile.data.avatar_render_mode}
            name={profile.data.display_name}
            className="profile-avatar-large"
          />
          <div className="public-profile-identity">
            <strong className="flex items-center gap-1 break-words">
              {profile.data.display_name}
              <VerificationBadge kind={profile.data.verification_kind} />
            </strong>
            <div className="mt-2 flex flex-wrap gap-2">
              {aliases.map((alias) => (
                <a className="tag" href={`/u/${alias}`} key={alias}>
                  @{alias}
                </a>
              ))}
            </div>
          </div>
        </div>
        <p className="mt-5 whitespace-pre-wrap break-words text-sm leading-relaxed text-soft">
          {profile.data.bio || ru.miniApp.social.bioEmpty}
        </p>
        <p className="mt-3 break-words text-xs text-muted">
          {ru.miniApp.social.internalId}: {profile.data.id}
        </p>
      </Card>
    </div>
  );
}

export function QuestionnairesPage() {
  const queryClient = useQueryClient();
  const collection = useQuery({ queryKey: ['questionnaires'], queryFn: api.questionnaires });
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
      <div className="space-y-3">
        {data.questionnaires.map((questionnaire) => (
          <Card className="p-5" key={questionnaire.id}>
            <div className="flex min-w-0 items-start justify-between gap-3">
              <div className="min-w-0">
                <strong className="break-words">
                  {questionnaire.title || questionnaire.short_headline}
                </strong>
                <p className="mt-1 break-words text-sm text-muted">
                  {questionnaire.short_headline}
                </p>
              </div>
              {questionnaire.is_primary ? (
                <span className="status-pill">{ru.miniApp.social.primaryQuestionnaire}</span>
              ) : null}
            </div>
            <div className="mt-4 flex flex-wrap items-center gap-2">
              <a
                className="button button-secondary"
                href={
                  questionnaire.is_primary
                    ? '/questionnaires/edit'
                    : `/questionnaires/${questionnaire.id}/edit`
                }
              >
                {ru.miniApp.profile.edit}
              </a>
              <Button
                variant={questionnaire.is_active ? 'danger' : 'secondary'}
                loading={setActive.isPending}
                onClick={() =>
                  setActive.mutate({ id: questionnaire.id, active: !questionnaire.is_active })
                }
              >
                {questionnaire.is_active ? ru.miniApp.social.disable : ru.miniApp.social.enable}
              </Button>
              <span className="text-xs text-muted">
                👍 {questionnaire.rating_likes} · 👎 {questionnaire.rating_dislikes}
              </span>
            </div>
          </Card>
        ))}
      </div>
      <Card className="mt-4 p-5">
        <p className="text-sm text-muted">
          {data.premium ? ru.miniApp.social.cloneHint : ru.miniApp.social.premiumRequired}
        </p>
        <Button
          className="mt-4"
          disabled={!data.premium || data.questionnaires.length >= data.limit}
          loading={clone.isPending}
          onClick={() => clone.mutate()}
        >
          <Plus className="h-4 w-4" /> {ru.miniApp.social.createQuestionnaire}
        </Button>
        {clone.isError ? <div className="error-box mt-3">{clone.error.message}</div> : null}
      </Card>
    </div>
  );
}

function PostCard({ post, own = false }: { post: SocialPost; own?: boolean }) {
  const queryClient = useQueryClient();
  const [open, setOpen] = useState(false);
  const [body, setBody] = useState('');
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [postTitle, setPostTitle] = useState(post.title ?? '');
  const [postBody, setPostBody] = useState(post.body_markdown || post.text_preview);
  const comments = useQuery({
    queryKey: ['post-comments', post.id],
    queryFn: () => api.postComments(post.id),
    enabled: open,
  });
  const rate = useMutation({
    mutationFn: (value: -1 | 1) => api.ratePost(post.id, value),
    onSuccess: () => void queryClient.invalidateQueries({ queryKey: ['posts'] }),
  });
  const comment = useMutation({
    mutationFn: () => api.addPostComment(post.id, body),
    onSuccess: () => {
      setBody('');
      void queryClient.invalidateQueries({ queryKey: ['post-comments', post.id] });
      void queryClient.invalidateQueries({ queryKey: ['posts'] });
    },
  });
  const updatePost = useMutation({
    mutationFn: () =>
      api.updateOwnPost(post.id, { title: postTitle.trim(), bodyMarkdown: postBody.trim() }),
    onSuccess: () => {
      setSettingsOpen(false);
      void queryClient.invalidateQueries({ queryKey: ['own-posts'] });
      void queryClient.invalidateQueries({ queryKey: ['posts'] });
    },
  });
  const removeMedia = useMutation({
    mutationFn: () => api.removeOwnPostMedia(post.id),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ['own-posts'] });
      void queryClient.invalidateQueries({ queryKey: ['posts'] });
    },
  });
  const addMedia = () => {
    const link = `https://t.me/r0lemate_bot?start=post_media_${post.id}`;
    const telegram = getTelegram();
    if (telegram) telegram.openTelegramLink(link);
    else window.open(link, '_blank', 'noopener,noreferrer');
  };
  return (
    <Card className="overflow-hidden">
      <div className="flex items-center gap-3 border-b border-white/10 p-4">
        <ProfileAvatar
          mediaId={post.avatar_media_id}
          renderMode={post.avatar_render_mode}
          name={post.display_name}
        />
        <div className="min-w-0">
          <strong className="break-words">{post.display_name}</strong>
          <p className="text-xs text-muted">
            {new Date(post.published_at).toLocaleString('ru-RU')}
          </p>
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
      {post.media_telegram_file_id ? (
        <div className="border-y border-white/10 bg-black/20">
          {post.content_type === 'photo' || post.content_type === 'animation' ? (
            <img
              className="max-h-[70vh] w-full object-contain"
              src={`/api/posts/${post.id}/media`}
              alt=""
              loading="lazy"
            />
          ) : post.content_type === 'video' || post.content_type === 'video_note' ? (
            <video
              className="max-h-[70vh] w-full"
              src={`/api/posts/${post.id}/media`}
              controls
              playsInline
              preload="metadata"
            />
          ) : post.content_type === 'audio' || post.content_type === 'voice' ? (
            <div className="p-4">
              {post.track_title || post.track_performer ? (
                <p className="mb-2 break-words text-sm">
                  {post.track_title ?? ru.miniApp.social.postsTitle}
                  {post.track_performer ? ` — ${post.track_performer}` : ''}
                </p>
              ) : null}
              <audio
                className="w-full"
                src={`/api/posts/${post.id}/media`}
                controls
                preload="none"
              />
            </div>
          ) : (
            <a className="button button-secondary m-4" href={`/api/posts/${post.id}/media`}>
              {ru.miniApp.profile.openMedia}
            </a>
          )}
        </div>
      ) : null}
      <div className="flex flex-wrap gap-2 px-5 pb-5">
        {own ? (
          <>
            <span className="status-pill">
              <Heart className="h-4 w-4" /> {post.likes}
            </span>
            <span className="status-pill">
              <ThumbsDown className="h-4 w-4" /> {post.dislikes}
            </span>
          </>
        ) : (
          <>
            <Button
              variant={post.own_rating === 1 ? 'primary' : 'secondary'}
              onClick={() => rate.mutate(1)}
            >
              <Heart className="h-4 w-4" /> {post.likes}
            </Button>
            <Button
              variant={post.own_rating === -1 ? 'danger' : 'secondary'}
              onClick={() => rate.mutate(-1)}
            >
              <ThumbsDown className="h-4 w-4" /> {post.dislikes}
            </Button>
          </>
        )}
        <Button variant="secondary" onClick={() => setOpen((value) => !value)}>
          <MessageCircle className="h-4 w-4" /> {post.comment_count}
        </Button>
        {own ? (
          <Button variant="secondary" onClick={() => setSettingsOpen((value) => !value)}>
            <Settings2 className="h-4 w-4" /> {ru.miniApp.social.postSettings}
          </Button>
        ) : null}
      </div>
      {own && settingsOpen ? (
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
          <div className="mt-4 flex flex-wrap gap-2">
            <Button
              loading={updatePost.isPending}
              disabled={!postBody.trim()}
              onClick={() => updatePost.mutate()}
            >
              <Save className="h-4 w-4" /> {ru.miniApp.social.savePost}
            </Button>
            <Button variant="secondary" onClick={addMedia}>
              <ImagePlus className="h-4 w-4" /> {ru.miniApp.social.addPostMedia}
            </Button>
            {post.media_telegram_file_id ? (
              <Button
                variant="danger"
                loading={removeMedia.isPending}
                onClick={() => {
                  if (window.confirm(ru.miniApp.social.removePostMediaConfirm)) {
                    removeMedia.mutate();
                  }
                }}
              >
                <Trash2 className="h-4 w-4" /> {ru.miniApp.social.removePostMedia}
              </Button>
            ) : null}
          </div>
          {updatePost.isError ? (
            <div className="error-box mt-3">{updatePost.error.message}</div>
          ) : null}
          {removeMedia.isError ? (
            <div className="error-box mt-3">{removeMedia.error.message}</div>
          ) : null}
        </div>
      ) : null}
      {open ? (
        <div className="border-t border-white/10 p-5">
          <div className="space-y-3">
            {comments.data?.map((item) => (
              <div key={item.id} className="flex gap-3">
                <ProfileAvatar
                  mediaId={item.avatar_media_id}
                  renderMode={item.avatar_render_mode}
                  name={item.display_name}
                />
                <div className="min-w-0">
                  <strong className="text-sm">{item.display_name}</strong>
                  <p className="whitespace-pre-wrap break-words text-sm text-soft">{item.body}</p>
                </div>
              </div>
            ))}
          </div>
          <textarea
            className="input mt-4 min-h-20"
            maxLength={1000}
            placeholder={ru.miniApp.social.commentPlaceholder}
            value={body}
            onChange={(event) => setBody(event.target.value)}
          />
          <Button
            className="mt-3"
            disabled={!body.trim()}
            loading={comment.isPending}
            onClick={() => comment.mutate()}
          >
            {ru.miniApp.social.sendComment}
          </Button>
        </div>
      ) : null}
    </Card>
  );
}

export function PostsPage() {
  const posts = useQuery({ queryKey: ['posts'], queryFn: api.posts });
  if (posts.isLoading) return <Skeleton className="h-80" />;
  return (
    <div>
      <SectionTitle eyebrow={ru.miniApp.social.postsEyebrow}>
        {ru.miniApp.social.postsTitle}
      </SectionTitle>
      <p className="mb-4 text-sm text-muted">{ru.miniApp.social.createPostHint}</p>
      <div className="space-y-4">
        {posts.data?.map((post) => (
          <PostCard key={post.id} post={post} />
        ))}
        {!posts.data?.length ? (
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
