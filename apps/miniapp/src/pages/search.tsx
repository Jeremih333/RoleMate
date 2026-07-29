import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { motion, AnimatePresence } from 'framer-motion';
import {
  Ban,
  ChevronLeft,
  ChevronRight,
  Flag,
  Heart,
  Maximize2,
  MessageCircle,
  Music,
  RotateCcw,
  Search,
  SlidersHorizontal,
  Star,
  X,
} from 'lucide-react';
import { useEffect, useState } from 'react';
import { ru } from '@rolemate/shared';
import { useLocation } from 'wouter';
import {
  ApiError,
  api,
  type PublicUserProfile,
  type SearchScope,
  type SearchPreferences,
  type SearchPreferencesInput,
  type SearchProfile,
} from '../api.js';
import { Button, Card, EmptyState, Skeleton } from '../components/ui.js';
import { ProfileMarkdown } from '../components/markdown.js';
import { ProfileAvatar } from '../components/profile-avatar.js';
import { VerificationBadge } from '../components/verification-badge.js';
import { haptic } from '../telegram.js';

function list(value: string | undefined): string[] {
  try {
    const parsed: unknown = JSON.parse(value ?? '[]');
    return Array.isArray(parsed)
      ? parsed.filter((item): item is string => typeof item === 'string')
      : [];
  } catch {
    return [];
  }
}

const writingStyleLabels = Object.fromEntries(
  ['literary', 'short_dynamic', 'mixed', 'coauthoring', 'game_elements', 'negotiable'].map(
    (value, index) => [value, ru.miniApp.profile.writingStyleOptions[index]],
  ),
);
const postLengthLabels = Object.fromEntries(
  ['lines_1_3', 'paragraphs_1_2', 'paragraphs_3_5', 'long_literary', 'scene_dependent'].map(
    (value, index) => [value, ru.miniApp.profile.postLengthOptions[index]],
  ),
);
const activityLabels = Object.fromEntries(
  ['several_hourly', 'several_daily', 'daily', 'several_weekly', 'flexible'].map((value, index) => [
    value,
    ru.miniApp.profile.frequencyOptions[index],
  ]),
);
const experienceLabels = Object.fromEntries(
  ['beginner', 'under_1_year', '1_3_years', '3_5_years', 'over_5_years', 'not_specified'].map(
    (value, index) => [value, ru.miniApp.profile.experienceOptions[index]],
  ),
);
const ageLabels = Object.fromEntries(
  ['under_16', '16_17', '18_20', '21_25', '26_plus'].map((value, index) => [
    value,
    ru.miniApp.profile.ageOptions[index],
  ]),
);
const genderLabels: Record<string, string> = {
  female: ru.miniApp.profile.genderOptions[1],
  male: ru.miniApp.profile.genderOptions[2],
  nonbinary: ru.miniApp.profile.genderOptions[3],
  not_specified: ru.miniApp.profile.genderOptions[0],
};

export function ProfileCard({
  profile,
  preview = false,
  expanded = false,
  onOpen,
  onMessage,
  messagePending = false,
}: {
  profile: SearchProfile;
  preview?: boolean;
  expanded?: boolean;
  onOpen?: () => void;
  onMessage?: () => void;
  messagePending?: boolean;
}) {
  const fandoms = list(profile.fandoms);
  const genres = list(profile.genres);
  const tags = list(profile.tags);
  type MediaItem = {
    id: string;
    media_type: 'photo' | 'animation' | 'video' | 'audio' | 'voice' | 'document';
    track_title?: string | null;
    track_performer?: string | null;
    has_thumbnail?: number;
  };
  let media: MediaItem[] = [];
  try {
    const parsed: unknown = JSON.parse(profile.media_items ?? '[]');
    if (Array.isArray(parsed)) {
      media = parsed.filter(
        (item): item is MediaItem =>
          typeof item === 'object' &&
          item !== null &&
          typeof (item as Record<string, unknown>).id === 'string' &&
          typeof (item as Record<string, unknown>).media_type === 'string',
      );
    }
  } catch {
    media = [];
  }
  if (!media.length && profile.media_id && profile.media_type) {
    media = [{ id: profile.media_id, media_type: profile.media_type }];
  }
  const visualMedia = media.filter((item) =>
    ['photo', 'animation', 'video'].includes(item.media_type),
  );
  const audioMedia = media.filter((item) => ['audio', 'voice'].includes(item.media_type));
  const documents = media.filter((item) => item.media_type === 'document');
  const [mediaIndex, setMediaIndex] = useState(0);
  const [fullscreenMediaOpen, setFullscreenMediaOpen] = useState(false);
  const currentMedia = visualMedia[mediaIndex % Math.max(visualMedia.length, 1)];
  const autoPlayCover =
    !expanded &&
    Boolean(profile.has_premium) &&
    mediaIndex === 0 &&
    currentMedia?.media_type === 'video';
  useEffect(() => {
    if (!fullscreenMediaOpen) return;
    const closeOnEscape = (event: KeyboardEvent) => {
      if (event.key === 'Escape') setFullscreenMediaOpen(false);
      if (event.key === 'ArrowLeft' && visualMedia.length > 1) {
        setMediaIndex((index) => (index - 1 + visualMedia.length) % visualMedia.length);
      }
      if (event.key === 'ArrowRight' && visualMedia.length > 1) {
        setMediaIndex((index) => (index + 1) % visualMedia.length);
      }
    };
    window.addEventListener('keydown', closeOnEscape);
    return () => window.removeEventListener('keydown', closeOnEscape);
  }, [fullscreenMediaOpen, visualMedia.length]);
  return (
    <>
      <Card className={`profile-card overflow-hidden ${expanded ? 'profile-card-expanded' : ''}`}>
        <div className="profile-cover">
          {currentMedia ? (
            currentMedia.media_type === 'video' ? (
              <video
                className="absolute inset-0 h-full w-full bg-black object-contain"
                src={`/api/profile-media/${currentMedia.id}`}
                controls
                autoPlay={autoPlayCover}
                loop={autoPlayCover}
                muted={autoPlayCover}
                playsInline
                preload="metadata"
              />
            ) : (
              <img
                className="absolute inset-0 h-full w-full object-cover"
                src={`/api/profile-media/${currentMedia.id}`}
                alt=""
                loading="eager"
              />
            )
          ) : null}
          {currentMedia ? (
            <button
              className="profile-media-fullscreen"
              type="button"
              aria-label={ru.miniApp.search.openMediaFullscreen}
              onClick={() => setFullscreenMediaOpen(true)}
            >
              <Maximize2 className="h-5 w-5" />
            </button>
          ) : null}
          {visualMedia.length > 1 ? (
            <>
              <button
                className="profile-media-arrow profile-media-arrow-left"
                type="button"
                aria-label={ru.miniApp.search.previousMedia}
                onClick={() =>
                  setMediaIndex((index) => (index - 1 + visualMedia.length) % visualMedia.length)
                }
              >
                <ChevronLeft />
              </button>
              <button
                className="profile-media-arrow profile-media-arrow-right"
                type="button"
                aria-label={ru.miniApp.search.nextMedia}
                onClick={() => setMediaIndex((index) => (index + 1) % visualMedia.length)}
              >
                <ChevronRight />
              </button>
              <div className="profile-media-dots" aria-hidden>
                {visualMedia.map((item, index) => (
                  <span className={index === mediaIndex ? 'active' : ''} key={item.id} />
                ))}
              </div>
            </>
          ) : null}
          <div className="compatibility">
            {preview ? (
              <span>{ru.miniApp.profile.previewBadge}</span>
            ) : (
              <>
                {profile.compatibility}%<span>{ru.miniApp.search.matchPercent}</span>
              </>
            )}
          </div>
          {profile.is_premium ? (
            <span className="premium-badge">
              <Star /> Premium
            </span>
          ) : null}
        </div>
        <div className="p-5">
          <div className="flex items-start justify-between gap-3">
            <div className="flex min-w-0 items-center gap-3">
              <ProfileAvatar
                mediaId={profile.avatar_media_id}
                renderMode={profile.avatar_render_mode}
                name={profile.display_name}
              />
              <div className="min-w-0">
                <h2 className="flex min-w-0 items-center gap-1 font-display text-3xl font-semibold">
                  <span className="truncate">{profile.display_name}</span>
                  <VerificationBadge kind={profile.verification_kind} />
                </h2>
                {profile.username ? (
                  <p className="truncate text-xs text-lilac">@{profile.username}</p>
                ) : null}
                <p className="mt-1 truncate text-sm text-muted">{profile.short_headline}</p>
              </div>
            </div>
            <span className="activity-dot" title={ru.miniApp.search.recentlyActive} />
          </div>
          <div className="mt-4 flex flex-wrap gap-2">
            {[
              ...(expanded ? fandoms : fandoms.slice(0, 2)),
              ...(expanded ? genres : genres.slice(0, 2)),
              ...(expanded ? tags : tags.slice(0, 3)),
            ].map((tag) => (
              <span className="tag" key={tag}>
                {tag}
              </span>
            ))}
          </div>
          <ProfileMarkdown
            className={`mt-4 text-sm leading-relaxed text-soft ${expanded ? '' : 'line-clamp-4'}`}
            allowLinks={Boolean(profile.has_premium)}
          >
            {profile.about}
          </ProfileMarkdown>
          {audioMedia.length ? (
            <div className="profile-audio-list">
              {audioMedia.map((item, index) => (
                <div className="profile-track" key={item.id}>
                  <div className="profile-track-cover">
                    {item.has_thumbnail ? (
                      <img src={`/api/profile-media/${item.id}/thumbnail`} alt="" loading="lazy" />
                    ) : (
                      <Music aria-hidden />
                    )}
                  </div>
                  <div className="profile-track-content">
                    <strong>{item.track_title || ru.miniApp.search.trackUnknown}</strong>
                    <span>{item.track_performer || ru.miniApp.search.performerUnknown}</span>
                    <audio
                      className="w-full"
                      src={`/api/profile-media/${item.id}`}
                      controls
                      preload="metadata"
                      onPlay={(event) => {
                        document
                          .querySelectorAll<HTMLAudioElement>('.profile-track audio')
                          .forEach((audio) => {
                            if (audio !== event.currentTarget) audio.pause();
                          });
                      }}
                      aria-label={ru.miniApp.search.profileAudio(index + 1)}
                    />
                  </div>
                </div>
              ))}
            </div>
          ) : null}
          {documents.map((item) => (
            <a
              className="mt-3 block text-sm text-lilac underline"
              href={`/api/profile-media/${item.id}`}
              key={item.id}
            >
              {ru.miniApp.profile.openMedia}
            </a>
          ))}
          <div className="mt-4 flex items-center gap-3 text-xs text-muted">
            <strong className="text-soft">{ru.miniApp.search.rating}:</strong>
            <span>
              👍 {profile.rating_likes ?? 0} {ru.miniApp.search.likes}
            </span>
            <span>
              👎 {profile.rating_dislikes ?? 0} {ru.miniApp.search.dislikes}
            </span>
          </div>
          <div className="mt-5 grid grid-cols-2 gap-2 text-xs text-muted">
            <span>
              {ru.miniApp.search.style}:{' '}
              {writingStyleLabels[profile.writing_style] ?? profile.writing_style}
            </span>
            <span>
              {ru.miniApp.search.posts}:{' '}
              {postLengthLabels[profile.average_post_length] ?? profile.average_post_length}
            </span>
            <span>
              {ru.miniApp.search.activity}:{' '}
              {activityLabels[profile.activity_frequency] ?? profile.activity_frequency}
            </span>
            <span>
              {ru.miniApp.search.age}:{' '}
              {profile.age_group
                ? (ageLabels[profile.age_group] ?? profile.age_group)
                : ru.miniApp.search.demographicsHidden}
            </span>
            <span>
              {ru.miniApp.profile.gender}:{' '}
              {profile.gender
                ? (genderLabels[profile.gender] ?? profile.gender)
                : ru.miniApp.search.demographicsHidden}
            </span>
          </div>
          {expanded ? <ProfileDetails profile={profile} /> : null}
          {!preview ? (
            <div className="profile-card-primary-actions">
              {!expanded && onOpen ? (
                <Button type="button" variant="secondary" onClick={onOpen}>
                  <Maximize2 className="h-4 w-4" />
                  {ru.miniApp.search.openProfile}
                </Button>
              ) : null}
              {expanded && onMessage ? (
                <Button type="button" loading={messagePending} onClick={onMessage}>
                  <MessageCircle className="h-4 w-4" />
                  {messagePending ? ru.miniApp.search.startingChat : ru.miniApp.search.writeMessage}
                </Button>
              ) : null}
            </div>
          ) : null}
        </div>
      </Card>
      <AnimatePresence>
        {fullscreenMediaOpen && currentMedia ? (
          <motion.div
            className="media-lightbox"
            role="dialog"
            aria-modal="true"
            aria-label={ru.miniApp.search.openMediaFullscreen}
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            onMouseDown={(event) => {
              if (event.target === event.currentTarget) setFullscreenMediaOpen(false);
            }}
          >
            <button
              className="media-lightbox-close"
              type="button"
              aria-label={ru.miniApp.search.closeMediaFullscreen}
              onClick={() => setFullscreenMediaOpen(false)}
            >
              <X />
            </button>
            {visualMedia.length > 1 ? (
              <>
                <button
                  className="media-lightbox-arrow media-lightbox-arrow-left"
                  type="button"
                  aria-label={ru.miniApp.search.previousMedia}
                  onClick={() =>
                    setMediaIndex((index) => (index - 1 + visualMedia.length) % visualMedia.length)
                  }
                >
                  <ChevronLeft />
                </button>
                <button
                  className="media-lightbox-arrow media-lightbox-arrow-right"
                  type="button"
                  aria-label={ru.miniApp.search.nextMedia}
                  onClick={() => setMediaIndex((index) => (index + 1) % visualMedia.length)}
                >
                  <ChevronRight />
                </button>
              </>
            ) : null}
            {currentMedia.media_type === 'video' ? (
              <video
                className="media-lightbox-content"
                src={`/api/profile-media/${currentMedia.id}`}
                controls
                autoPlay
                playsInline
              />
            ) : (
              <img
                className="media-lightbox-content"
                src={`/api/profile-media/${currentMedia.id}`}
                alt=""
              />
            )}
          </motion.div>
        ) : null}
      </AnimatePresence>
    </>
  );
}

function ProfileDetails({ profile }: { profile: SearchProfile }) {
  const details = [
    [
      ru.miniApp.search.experience,
      profile.roleplay_experience
        ? (experienceLabels[profile.roleplay_experience] ?? profile.roleplay_experience)
        : undefined,
    ],
    [ru.miniApp.search.preferredRoles, list(profile.preferred_role).join(', ')],
    [ru.miniApp.search.timezone, profile.timezone],
    [ru.miniApp.search.activeHours, profile.active_hours],
    [ru.miniApp.search.languages, list(profile.languages).join(', ')],
    [ru.miniApp.search.settings, profile.settings],
    [ru.miniApp.search.plots, profile.plots],
    [ru.miniApp.search.lookingFor, list(profile.looking_for).join(', ')],
    [ru.miniApp.search.boundaries, profile.boundaries],
  ].filter((item): item is [string, string] => Boolean(item[1]));
  if (!details.length) return null;
  return (
    <dl className="profile-full-details">
      {details.map(([label, value]) => (
        <div key={label}>
          <dt>{label}</dt>
          <dd>{value}</dd>
        </div>
      ))}
    </dl>
  );
}

function SearchScopeTabs({
  value,
  onChange,
}: {
  value: SearchScope;
  onChange: (scope: SearchScope) => void;
}) {
  const scopes: SearchScope[] = ['questionnaires', 'profiles'];
  return (
    <div className="mb-4 grid grid-cols-2 gap-2" role="tablist">
      {scopes.map((scope) => (
        <Button
          key={scope}
          type="button"
          role="tab"
          aria-selected={value === scope}
          variant={value === scope ? 'primary' : 'secondary'}
          onClick={() => onChange(scope)}
        >
          {ru.miniApp.search.scopes[scope]}
        </Button>
      ))}
    </div>
  );
}

function GlobalProfileResult({ profile }: { profile: PublicUserProfile }) {
  return (
    <Card className="p-4">
      <div className="flex items-start gap-3">
        <ProfileAvatar
          mediaId={profile.avatar_media_id}
          renderMode={profile.avatar_render_mode}
          name={profile.display_name}
        />
        <div className="min-w-0 flex-1">
          <strong className="flex items-center gap-1 break-words">
            {profile.display_name}
            <VerificationBadge kind={profile.verification_kind} />
          </strong>
          <p className="mt-1 whitespace-pre-wrap break-words text-sm text-soft">{profile.bio}</p>
          <p className="mt-2 break-all text-xs text-muted">
            {ru.miniApp.search.resultId(profile.id)}
          </p>
          <p className="mt-1 text-xs text-muted">
            {ru.miniApp.social.questionnaireCount(profile.questionnaire_count)} ·{' '}
            {ru.miniApp.social.postCount(profile.post_count)}
          </p>
        </div>
      </div>
    </Card>
  );
}

export function SearchPage() {
  const [, navigate] = useLocation();
  const queryClient = useQueryClient();
  const [query, setQuery] = useState('');
  const [queryDraft, setQueryDraft] = useState('');
  const [scope, setScope] = useState<SearchScope>('questionnaires');
  const [staffNotice, setStaffNotice] = useState('');
  const [selectedProfile, setSelectedProfile] = useState<SearchProfile | null>(null);
  const me = useQuery({ queryKey: ['me'], queryFn: api.me });
  const profiles = useQuery({
    queryKey: ['search', query],
    queryFn: () => api.search(query),
    enabled: scope === 'questionnaires',
  });
  const publicProfiles = useQuery({
    queryKey: ['public-profile-search', query],
    queryFn: () => api.searchPublicProfiles(query),
    enabled: scope === 'profiles',
  });
  const premium = useQuery({ queryKey: ['premium-status'], queryFn: api.premiumStatus });
  const preferences = useQuery({
    queryKey: ['search-preferences'],
    queryFn: api.searchPreferences,
  });
  const availability = useQuery({
    queryKey: ['search-availability'],
    queryFn: api.searchAvailability,
  });
  const [filtersOpen, setFiltersOpen] = useState(false);
  useEffect(() => {
    if (!selectedProfile) return;
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    const closeOnEscape = (event: KeyboardEvent) => {
      if (event.key === 'Escape') setSelectedProfile(null);
    };
    window.addEventListener('keydown', closeOnEscape);
    return () => {
      document.body.style.overflow = previousOverflow;
      window.removeEventListener('keydown', closeOnEscape);
    };
  }, [selectedProfile]);
  const searchForm = (
    <form
      className="search-box"
      onSubmit={(event) => {
        event.preventDefault();
        setQuery(queryDraft.trim());
      }}
    >
      <Search className="h-4 w-4" aria-hidden />
      <input
        value={queryDraft}
        maxLength={80}
        placeholder={ru.miniApp.search.keywordPlaceholder}
        aria-label={ru.miniApp.search.keywordLabel}
        onChange={(event) => setQueryDraft(event.target.value)}
      />
      <Button type="submit">{ru.miniApp.search.keywordSubmit}</Button>
    </form>
  );
  const swipe = useMutation({
    mutationFn: ({
      action,
      profile,
    }: {
      action: 'like' | 'skip' | 'super_like';
      profile: SearchProfile;
    }) => api.swipe(profile.user_id, action),
    onSuccess: (result) => {
      haptic(result.matched ? 'heavy' : 'light');
      void queryClient.invalidateQueries({ queryKey: ['search'] });
      if (result.matched) void queryClient.invalidateQueries({ queryKey: ['conversations'] });
    },
  });
  const rewind = useMutation({
    mutationFn: api.rewind,
    onSuccess: () => {
      haptic('light');
      void queryClient.invalidateQueries({ queryKey: ['search'] });
    },
  });
  const block = useMutation({
    mutationFn: (userId: string) => api.block(userId),
    onSuccess: () => void queryClient.invalidateQueries({ queryKey: ['search'] }),
  });
  const report = useMutation({ mutationFn: api.report });
  const directChat = useMutation({
    mutationFn: (targetUserId: string) => api.startDirectConversation(targetUserId),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ['conversations'] });
      navigate('/chats');
    },
  });
  const staffModeration = useMutation({
    mutationFn: ({
      userId,
      action,
      reason,
      bannedUntil,
    }: {
      userId: string;
      action: 'warn' | 'temporary_ban' | 'disable_profile';
      reason: string;
      bannedUntil?: string;
    }) =>
      api.adminModerateUser(userId, { action, reason, ...(bannedUntil ? { bannedUntil } : {}) }),
    onSuccess: (_result, variables) => {
      setStaffNotice(ru.miniApp.search.moderationCompleted);
      if (variables.action !== 'warn') {
        void queryClient.invalidateQueries({ queryKey: ['search'] });
      }
      void queryClient.invalidateQueries({ queryKey: ['admin-users'] });
      void queryClient.invalidateQueries({ queryKey: ['admin-questionnaires'] });
      void queryClient.invalidateQueries({ queryKey: ['admin-public-profiles'] });
    },
  });

  if (scope !== 'questionnaires') {
    return (
      <div className="mx-auto max-w-lg">
        <div className="mb-4">
          <p className="eyebrow">{ru.miniApp.search.eyebrow}</p>
          <h1 className="font-display text-3xl font-semibold">{ru.miniApp.search.title}</h1>
        </div>
        <SearchScopeTabs
          value={scope}
          onChange={(nextScope) => {
            setScope(nextScope);
          }}
        />
        <div className="mb-4">{searchForm}</div>
        {publicProfiles.isLoading ? <Skeleton className="h-[28rem]" /> : null}
        {publicProfiles.isError ? (
          <div className="error-box">{publicProfiles.error.message}</div>
        ) : null}
        <div className="space-y-3">
          {publicProfiles.data?.map((profile) => (
            <button
              className="block w-full text-left"
              key={profile.id}
              type="button"
              onClick={() => navigate(`/profiles/${profile.id}`)}
            >
              <GlobalProfileResult profile={profile} />
            </button>
          ))}
        </div>
        {!publicProfiles.isLoading && !publicProfiles.data?.length ? (
          <EmptyState
            icon={<Search className="h-7 w-7" />}
            title={ru.miniApp.search.emptyTitle}
            description={ru.miniApp.search.globalEmpty}
          />
        ) : null}
      </div>
    );
  }

  if (profiles.isLoading) {
    return (
      <div className="space-y-4">
        <Skeleton className="h-8 w-48" />
        <Skeleton className="h-[34rem]" />
      </div>
    );
  }
  if (!profiles.data?.length) {
    const emptyDescription =
      availability.data?.otherProfiles === 0
        ? ru.miniApp.search.emptyOnlyOwnProfile
        : availability.data?.otherSearchable === 0
          ? ru.miniApp.search.emptyProfilesUnavailable
          : availability.data?.safeCandidates === 0
            ? ru.miniApp.search.emptySafetyRules
            : ru.miniApp.search.emptyDescription;
    return (
      <EmptyState
        icon={<Star className="h-7 w-7" />}
        title={ru.miniApp.search.emptyTitle}
        description={emptyDescription}
        action={
          <div className="space-y-3">
            <SearchScopeTabs
              value={scope}
              onChange={(nextScope) => {
                setScope(nextScope);
              }}
            />
            {searchForm}
            <Button
              onClick={() => {
                void profiles.refetch();
                void availability.refetch();
              }}
            >
              {ru.miniApp.search.retry}
            </Button>
          </div>
        }
      />
    );
  }

  return (
    <div className="mx-auto max-w-lg">
      <div className="mb-4 flex items-center justify-between">
        <div>
          <p className="eyebrow">{ru.miniApp.search.eyebrow}</p>
          <h1 className="font-display text-3xl font-semibold">{ru.miniApp.search.title}</h1>
        </div>
        <Button
          variant="ghost"
          aria-label={ru.miniApp.search.filters}
          onClick={() => setFiltersOpen((value) => !value)}
        >
          <SlidersHorizontal className="h-5 w-5" />
        </Button>
      </div>
      <SearchScopeTabs
        value={scope}
        onChange={(nextScope) => {
          setScope(nextScope);
        }}
      />
      <div className="mb-4">{searchForm}</div>
      {premium.data ? (
        <p className="mb-3 text-center text-xs text-muted">
          {ru.miniApp.search.dailyUsage(
            premium.data.usage.profileViews,
            premium.data.usage.profileViewLimit,
            premium.data.usage.superLikes,
            premium.data.usage.superLikeLimit,
          )}
        </p>
      ) : null}
      {filtersOpen && preferences.data ? (
        preferences.data.premium ? (
          <SearchFilters
            preferences={preferences.data}
            onSaved={() => {
              setFiltersOpen(false);
              void profiles.refetch();
            }}
          />
        ) : (
          <Card className="mb-4 p-4 text-sm text-soft">
            {ru.miniApp.search.premiumFiltersOnly}{' '}
            <a className="text-lilac underline" href="/premium">
              {ru.miniApp.search.openPremium}
            </a>
          </Card>
        )
      ) : null}
      <div className="space-y-8" data-testid="questionnaire-feed">
        {profiles.data.map((profile, profileIndex) => (
          <motion.article
            key={profile.id}
            initial={{ opacity: 0, y: 18 }}
            animate={{ opacity: 1, y: 0 }}
            className="space-y-3"
          >
            <ProfileCard profile={profile} onOpen={() => setSelectedProfile(profile)} />
            {me.data?.isAdmin ? (
              <Card
                className="p-4"
                data-testid={
                  profileIndex === 0 ? 'search-moderation-panel' : `search-moderation-${profile.id}`
                }
              >
                <strong className="text-sm">{ru.miniApp.search.quickModeration}</strong>
                <div className="mt-3 flex flex-wrap gap-2">
                  <Button
                    variant="secondary"
                    loading={staffModeration.isPending}
                    onClick={() => {
                      const reason = window.prompt(ru.miniApp.admin.warningReasonPrompt)?.trim();
                      if (reason && reason.length >= 3) {
                        setStaffNotice('');
                        staffModeration.mutate({
                          userId: profile.user_id,
                          action: 'warn',
                          reason,
                        });
                      }
                    }}
                  >
                    {ru.miniApp.admin.warn}
                  </Button>
                  <Button
                    variant="secondary"
                    loading={staffModeration.isPending}
                    onClick={() => {
                      const reason = window
                        .prompt(ru.miniApp.admin.temporaryBanReasonPrompt)
                        ?.trim();
                      if (reason && reason.length >= 3) {
                        setStaffNotice('');
                        staffModeration.mutate({
                          userId: profile.user_id,
                          action: 'temporary_ban',
                          reason,
                          bannedUntil: new Date(Date.now() + 86_400_000).toISOString(),
                        });
                      }
                    }}
                  >
                    {ru.miniApp.admin.temporaryBan}
                  </Button>
                  <Button
                    variant="danger"
                    loading={staffModeration.isPending}
                    onClick={() => {
                      const reason = window.prompt(ru.miniApp.search.disableReasonPrompt)?.trim();
                      if (reason && reason.length >= 3) {
                        setStaffNotice('');
                        staffModeration.mutate({
                          userId: profile.user_id,
                          action: 'disable_profile',
                          reason,
                        });
                      }
                    }}
                  >
                    {ru.miniApp.admin.disableProfile}
                  </Button>
                </div>
              </Card>
            ) : null}
            <div className="swipe-actions">
              <Button
                variant="secondary"
                aria-label={ru.miniApp.search.skip}
                onClick={() => swipe.mutate({ action: 'skip', profile })}
              >
                <X />
              </Button>
              <Button
                className="like-button"
                aria-label={ru.miniApp.search.like}
                onClick={() => swipe.mutate({ action: 'like', profile })}
              >
                <Heart />
              </Button>
              <Button
                variant="secondary"
                aria-label={ru.miniApp.search.superLike}
                onClick={() => swipe.mutate({ action: 'super_like', profile })}
              >
                <Star />
              </Button>
            </div>
            <div className="flex justify-center gap-6 text-xs text-muted">
              <button
                className="inline-flex gap-1"
                onClick={() => {
                  if (window.confirm(ru.miniApp.search.blockConfirm)) {
                    block.mutate(profile.user_id);
                  }
                }}
              >
                <Ban className="h-3.5 w-3.5" /> {ru.miniApp.search.block}
              </button>
              <button
                className="inline-flex gap-1"
                onClick={() => {
                  const description = window.prompt(ru.miniApp.search.reportPrompt) ?? '';
                  if (!description) return;
                  report.mutate({
                    reportedUserId: profile.user_id,
                    category: 'other',
                    description,
                  });
                }}
              >
                <Flag className="h-3.5 w-3.5" /> {ru.miniApp.search.report}
              </button>
            </div>
          </motion.article>
        ))}
      </div>
      {selectedProfile ? (
        <div
          className="profile-full-overlay"
          role="dialog"
          aria-modal="true"
          aria-label={ru.miniApp.search.fullProfile}
          onMouseDown={(event) => {
            if (event.target === event.currentTarget) setSelectedProfile(null);
          }}
        >
          <div className="profile-full-dialog">
            <button
              type="button"
              className="profile-full-close"
              aria-label={ru.miniApp.search.closeProfile}
              onClick={() => setSelectedProfile(null)}
            >
              <X />
            </button>
            <ProfileCard
              profile={selectedProfile}
              expanded
              messagePending={directChat.isPending}
              onMessage={() => directChat.mutate(selectedProfile.user_id)}
            />
            {directChat.isError ? (
              <div className="error-box mt-3">{ru.miniApp.search.directChatError}</div>
            ) : null}
          </div>
        </div>
      ) : null}
      <div className="mt-5 flex justify-center">
        <Button
          variant="ghost"
          aria-label={ru.miniApp.search.rewind}
          onClick={() => {
            if (!premium.data?.premium) {
              window.location.href = '/premium';
              return;
            }
            rewind.mutate();
          }}
          disabled={rewind.isPending}
        >
          <RotateCcw />
        </Button>
      </div>
      {swipe.isError ? (
        <div className="error-box mt-3">
          {swipe.error instanceof ApiError && swipe.error.code === 'SUPER_LIKE_LIMIT'
            ? ru.miniApp.search.superLikeLimitReached
            : swipe.error.message}
        </div>
      ) : null}
      {staffNotice ? <p className="mt-3 text-center text-sm text-lilac">{staffNotice}</p> : null}
      {staffModeration.isError ? (
        <div className="error-box mt-3">{staffModeration.error.message}</div>
      ) : null}
    </div>
  );
}

function SearchFilters({
  preferences,
  onSaved,
}: {
  preferences: SearchPreferences;
  onSaved: () => void;
}) {
  const queryClient = useQueryClient();
  const ageOptions: SearchPreferencesInput['ageGroups'] = [
    'under_16',
    '16_17',
    '18_20',
    '21_25',
    '26_plus',
  ];
  const [ageGroups, setAgeGroups] = useState<SearchPreferencesInput['ageGroups']>(
    list(preferences.age_groups) as SearchPreferencesInput['ageGroups'],
  );
  const [genres, setGenres] = useState(list(preferences.genres).join(', '));
  const [fandoms, setFandoms] = useState(list(preferences.fandoms).join(', '));
  const [writingStyles, setWritingStyles] = useState(list(preferences.writing_styles).join(', '));
  const [activityLevels, setActivityLevels] = useState(
    list(preferences.activity_levels).join(', '),
  );
  const [onlyOnline, setOnlyOnline] = useState(Boolean(preferences.only_online));
  const [onlyWithPhoto, setOnlyWithPhoto] = useState(Boolean(preferences.only_with_photo));
  const [filterSetName, setFilterSetName] = useState('');
  const filterSets = useQuery({ queryKey: ['filter-sets'], queryFn: api.filterSets });
  const save = useMutation({
    mutationFn: (input: SearchPreferencesInput) => api.saveSearchPreferences(input),
    onSuccess: onSaved,
  });
  const split = (value: string) =>
    value
      .split(',')
      .map((item) => item.trim())
      .filter(Boolean);
  const currentInput = (): SearchPreferencesInput => ({
    ageGroups,
    languages: [],
    genres: split(genres),
    fandoms: split(fandoms),
    writingStyles: split(writingStyles),
    activityLevels: split(activityLevels),
    onlyOnline,
    onlyWithPhoto,
  });
  const saveSet = useMutation({
    mutationFn: () => api.saveFilterSet(filterSetName, currentInput()),
    onSuccess: () => {
      setFilterSetName('');
      void queryClient.invalidateQueries({ queryKey: ['filter-sets'] });
    },
  });
  const activateSet = useMutation({
    mutationFn: api.activateFilterSet,
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ['search-preferences'] });
      onSaved();
    },
  });
  const deleteSet = useMutation({
    mutationFn: api.deleteFilterSet,
    onSuccess: () => void queryClient.invalidateQueries({ queryKey: ['filter-sets'] }),
  });
  return (
    <Card className="mb-4 space-y-3 p-4">
      <p className="text-sm font-semibold">{ru.miniApp.search.filterAge}</p>
      <div className="flex flex-wrap gap-2">
        {ageOptions.map((age, index) => (
          <button
            key={age}
            className={`tag ${ageGroups.includes(age) ? 'status-pill' : ''}`}
            onClick={() =>
              setAgeGroups((current) =>
                current.includes(age) ? current.filter((item) => item !== age) : [...current, age],
              )
            }
          >
            {ru.miniApp.profile.ageOptions[index]}
          </button>
        ))}
      </div>
      {[
        [genres, setGenres, ru.miniApp.search.filterGenres],
        [fandoms, setFandoms, ru.miniApp.search.filterFandoms],
        [writingStyles, setWritingStyles, ru.miniApp.search.filterWritingStyles],
        [activityLevels, setActivityLevels, ru.miniApp.search.filterActivity],
      ].map(([value, setter, placeholder]) => (
        <input
          key={String(placeholder)}
          className="input-field"
          value={String(value)}
          onChange={(event) => (setter as (value: string) => void)(event.target.value)}
          placeholder={String(placeholder)}
        />
      ))}
      <label className="setting-row">
        {ru.miniApp.search.onlyOnline}
        <input
          type="checkbox"
          checked={onlyOnline}
          onChange={(event) => setOnlyOnline(event.target.checked)}
        />
      </label>
      <label className="setting-row">
        {ru.miniApp.search.onlyWithPhoto}
        <input
          type="checkbox"
          checked={onlyWithPhoto}
          onChange={(event) => setOnlyWithPhoto(event.target.checked)}
        />
      </label>
      <Button
        loading={save.isPending}
        onClick={() =>
          save.mutate({
            ...currentInput(),
          })
        }
      >
        {ru.miniApp.search.saveFilters}
      </Button>
      <div className="border-t border-white/10 pt-3">
        <p className="mb-2 text-sm font-semibold">{ru.miniApp.search.savedFilterSets}</p>
        <div className="flex gap-2">
          <input
            className="input-field"
            value={filterSetName}
            maxLength={40}
            onChange={(event) => setFilterSetName(event.target.value)}
            placeholder={ru.miniApp.search.filterSetName}
          />
          <Button
            variant="secondary"
            disabled={!filterSetName.trim()}
            loading={saveSet.isPending}
            onClick={() => saveSet.mutate()}
          >
            {ru.miniApp.search.saveFilterSet}
          </Button>
        </div>
        <div className="mt-2 space-y-2">
          {filterSets.data?.map((item) => (
            <div className="setting-row" key={item.id}>
              <span>
                {item.name}
                {item.is_active ? ' ✓' : ''}
              </span>
              <span className="flex gap-2">
                <button onClick={() => activateSet.mutate(item.id)}>
                  {ru.miniApp.search.activateFilterSet}
                </button>
                <button onClick={() => deleteSet.mutate(item.id)}>
                  {ru.miniApp.search.deleteFilterSet}
                </button>
              </span>
            </div>
          ))}
        </div>
      </div>
    </Card>
  );
}
