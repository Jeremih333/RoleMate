import { useEffect, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import {
  FileText,
  Heart,
  ImagePlus,
  MessageCircle,
  Pencil,
  Plus,
  Save,
  ThumbsDown,
} from 'lucide-react';
import { ru } from '@rolemate/shared';
import { api, type SocialPost } from '../api.js';
import { ProfileAvatar } from '../components/profile-avatar.js';
import { Button, Card, EmptyState, SectionTitle, Skeleton } from '../components/ui.js';
import { getTelegram } from '../telegram.js';

export function PublicProfilePage() {
  const queryClient = useQueryClient();
  const profile = useQuery({ queryKey: ['public-profile'], queryFn: api.publicProfile });
  const media = useQuery({ queryKey: ['profile-media'], queryFn: api.profileMedia });
  const ownPosts = useQuery({ queryKey: ['own-posts'], queryFn: api.ownPosts });
  const [displayName, setDisplayName] = useState('');
  const [bio, setBio] = useState('');
  const [avatarMediaId, setAvatarMediaId] = useState<string | null>(null);
  const [editing, setEditing] = useState(false);
  const [initialized, setInitialized] = useState(false);
  useEffect(() => {
    if (!profile.data || initialized) return;
    setDisplayName(profile.data.display_name);
    setBio(profile.data.bio);
    setAvatarMediaId(profile.data.avatar_media_id);
    setInitialized(true);
  }, [initialized, profile.data]);
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
  if (profile.isLoading) return <Skeleton className="h-80" />;
  if (!profile.data) return null;
  const avatarChoices = (media.data ?? []).filter(
    (item) =>
      item.moderation_status === 'approved' &&
      (item.media_type === 'photo' || item.media_type === 'video'),
  );
  const openBot = (parameter: 'profile_photo' | 'create_post') => {
    const link = `https://t.me/r0lemate_bot?start=${parameter}`;
    const telegram = getTelegram();
    if (telegram) telegram.openTelegramLink(link);
    else window.open(link, '_blank', 'noopener,noreferrer');
  };
  return (
    <div>
      <SectionTitle eyebrow={ru.miniApp.social.profileEyebrow}>
        {ru.miniApp.social.profileTitle}
      </SectionTitle>
      <Card className="p-5">
        <div className="flex items-start gap-4">
          <ProfileAvatar
            mediaId={profile.data.avatar_media_id}
            renderMode={profile.data.avatar_render_mode}
            name={displayName}
            className="profile-avatar-large"
          />
          <div className="min-w-0 flex-1">
            <strong className="block break-words">{displayName}</strong>
            <p className="mt-1 break-all text-xs text-muted">
              {ru.miniApp.social.internalId}: {profile.data.id}
            </p>
          </div>
          <Button variant="secondary" onClick={() => setEditing((value) => !value)}>
            <Pencil className="h-4 w-4" /> {ru.miniApp.social.editProfile}
          </Button>
        </div>
        <p className="mt-5 whitespace-pre-wrap break-words text-sm leading-relaxed text-soft">
          {profile.data.bio || ru.miniApp.social.bioEmpty}
        </p>
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
          <div className="mt-6 border-t border-white/10 pt-5">
            <p className="mb-5 text-sm leading-relaxed text-muted">
              {ru.miniApp.social.profileDescription}
            </p>
            <label className="field-label" htmlFor="public-display-name">
              {ru.miniApp.social.displayName}
            </label>
            <input
              id="public-display-name"
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
      <p className="whitespace-pre-wrap break-words p-5 text-sm leading-relaxed">
        {post.text_preview}
      </p>
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
      </div>
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
