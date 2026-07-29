import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { motion, AnimatePresence } from 'framer-motion';
import {
  Ban,
  ChevronLeft,
  ChevronRight,
  Flag,
  Heart,
  RotateCcw,
  Search,
  SlidersHorizontal,
  Star,
  X,
} from 'lucide-react';
import { useEffect, useState } from 'react';
import { ru } from '@rolemate/shared';
import {
  api,
  type SearchPreferences,
  type SearchPreferencesInput,
  type SearchProfile,
} from '../api.js';
import { Button, Card, EmptyState, Skeleton } from '../components/ui.js';
import { ProfileMarkdown } from '../components/markdown.js';
import { haptic } from '../telegram.js';

function list(value: string): string[] {
  try {
    const parsed: unknown = JSON.parse(value);
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
}: {
  profile: SearchProfile;
  preview?: boolean;
}) {
  const fandoms = list(profile.fandoms);
  const genres = list(profile.genres);
  const tags = list(profile.tags);
  type MediaItem = {
    id: string;
    media_type: 'photo' | 'animation' | 'video' | 'audio' | 'voice' | 'document';
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
  const currentMedia = visualMedia[mediaIndex % Math.max(visualMedia.length, 1)];
  return (
    <Card className="profile-card overflow-hidden">
      <div className="profile-cover">
        {currentMedia ? (
          currentMedia.media_type === 'video' ? (
            <video
              className="absolute inset-0 h-full w-full bg-black object-contain"
              src={`/api/profile-media/${currentMedia.id}`}
              controls
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
          <div>
            <h2 className="font-display text-3xl font-semibold">{profile.display_name}</h2>
            <p className="mt-1 text-sm text-muted">{profile.short_headline}</p>
          </div>
          <span className="activity-dot" title={ru.miniApp.search.recentlyActive} />
        </div>
        <div className="mt-4 flex flex-wrap gap-2">
          {[...fandoms.slice(0, 2), ...genres.slice(0, 2), ...tags.slice(0, 3)].map((tag) => (
            <span className="tag" key={tag}>
              {tag}
            </span>
          ))}
        </div>
        <ProfileMarkdown
          className="mt-4 line-clamp-4 text-sm leading-relaxed text-soft"
          allowLinks={Boolean(profile.has_premium)}
        >
          {profile.about}
        </ProfileMarkdown>
        {audioMedia.length ? (
          <div className="profile-audio-list">
            {audioMedia.map((item, index) => (
              <audio
                key={item.id}
                className="w-full"
                src={`/api/profile-media/${item.id}`}
                controls
                preload="none"
                aria-label={ru.miniApp.search.profileAudio(index + 1)}
              />
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
      </div>
    </Card>
  );
}

export function SearchPage() {
  const queryClient = useQueryClient();
  const [query, setQuery] = useState('');
  const [queryDraft, setQueryDraft] = useState('');
  const [staffNotice, setStaffNotice] = useState('');
  const me = useQuery({ queryKey: ['me'], queryFn: api.me });
  const profiles = useQuery({
    queryKey: ['search', query],
    queryFn: () => api.search(query),
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
  const [index, setIndex] = useState(0);
  const [filtersOpen, setFiltersOpen] = useState(false);
  const current = profiles.data?.[index];
  useEffect(() => {
    setIndex(0);
  }, [profiles.dataUpdatedAt, query]);
  const searchForm = (
    <form
      className="search-box"
      onSubmit={(event) => {
        event.preventDefault();
        setIndex(0);
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
      setIndex((value) => value + 1);
      if (result.matched) void queryClient.invalidateQueries({ queryKey: ['conversations'] });
    },
  });
  const rewind = useMutation({
    mutationFn: api.rewind,
    onSuccess: () => {
      haptic('light');
      setIndex((value) => Math.max(0, value - 1));
      void queryClient.invalidateQueries({ queryKey: ['search'] });
    },
  });
  const block = useMutation({
    mutationFn: (userId: string) => api.block(userId),
    onSuccess: () => setIndex((value) => value + 1),
  });
  const report = useMutation({ mutationFn: api.report });
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
      if (variables.action !== 'warn') setIndex((value) => value + 1);
      void queryClient.invalidateQueries({ queryKey: ['admin-users'] });
      void queryClient.invalidateQueries({ queryKey: ['admin-profiles'] });
    },
  });

  if (profiles.isLoading) {
    return (
      <div className="space-y-4">
        <Skeleton className="h-8 w-48" />
        <Skeleton className="h-[34rem]" />
      </div>
    );
  }
  if (!current) {
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
            {searchForm}
            <Button
              onClick={() => {
                setIndex(0);
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
              setIndex(0);
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
      <AnimatePresence mode="wait">
        <motion.div
          key={current.id}
          initial={{ opacity: 0, x: 40 }}
          animate={{ opacity: 1, x: 0 }}
          exit={{ opacity: 0, x: -80, rotate: -4 }}
        >
          <ProfileCard profile={current} />
        </motion.div>
      </AnimatePresence>
      {me.data?.isAdmin ? (
        <Card className="mt-3 p-4" data-testid="search-moderation-panel">
          <strong className="text-sm">{ru.miniApp.search.quickModeration}</strong>
          <p className="mt-1 text-xs text-muted">{ru.miniApp.search.quickModerationHint}</p>
          <div className="mt-3 flex flex-wrap gap-2">
            <Button
              variant="secondary"
              loading={staffModeration.isPending}
              onClick={() => {
                const reason = window.prompt(ru.miniApp.admin.warningReasonPrompt)?.trim();
                if (reason && reason.length >= 3) {
                  setStaffNotice('');
                  staffModeration.mutate({ userId: current.user_id, action: 'warn', reason });
                }
              }}
            >
              {ru.miniApp.admin.warn}
            </Button>
            <Button
              variant="secondary"
              loading={staffModeration.isPending}
              onClick={() => {
                const reason = window.prompt(ru.miniApp.admin.temporaryBanReasonPrompt)?.trim();
                if (reason && reason.length >= 3) {
                  setStaffNotice('');
                  staffModeration.mutate({
                    userId: current.user_id,
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
                    userId: current.user_id,
                    action: 'disable_profile',
                    reason,
                  });
                }
              }}
            >
              {ru.miniApp.admin.disableProfile}
            </Button>
          </div>
          {staffNotice ? <p className="mt-3 text-sm text-lilac">{staffNotice}</p> : null}
          {staffModeration.isError ? (
            <div className="error-box mt-3">{staffModeration.error.message}</div>
          ) : null}
        </Card>
      ) : null}
      <div className="swipe-actions">
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
        <Button
          variant="secondary"
          aria-label={ru.miniApp.search.skip}
          onClick={() => swipe.mutate({ action: 'skip', profile: current })}
        >
          <X />
        </Button>
        <Button
          className="like-button"
          aria-label={ru.miniApp.search.like}
          onClick={() => swipe.mutate({ action: 'like', profile: current })}
        >
          <Heart />
        </Button>
        <Button
          variant="secondary"
          aria-label={ru.miniApp.search.superLike}
          onClick={() => swipe.mutate({ action: 'super_like', profile: current })}
        >
          <Star />
        </Button>
      </div>
      <div className="mt-3 flex justify-center gap-6 text-xs text-muted">
        <button
          className="inline-flex gap-1"
          onClick={() => {
            if (window.confirm(ru.miniApp.search.blockConfirm)) block.mutate(current.user_id);
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
              reportedUserId: current.user_id,
              category: 'other',
              description,
            });
          }}
        >
          <Flag className="h-3.5 w-3.5" /> {ru.miniApp.search.report}
        </button>
      </div>
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
