import { useInfiniteQuery, useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { motion, AnimatePresence } from 'framer-motion';
import {
  Ban,
  Check,
  ChevronLeft,
  ChevronRight,
  Eye,
  Flag,
  Heart,
  Maximize2,
  MessageCircle,
  MoreVertical,
  RotateCcw,
  Search,
  Share2,
  Shield,
  SlidersHorizontal,
  Star,
  Trash2,
  X,
} from 'lucide-react';
import { useEffect, useRef, useState } from 'react';
import { ru } from '@rolemate/shared';
import { Link, useLocation } from 'wouter';
import {
  ApiError,
  api,
  type PublicUserProfile,
  type SearchScope,
  type SearchPreferences,
  type SearchPreferencesInput,
  type SearchProfile,
} from '../api.js';
import {
  Button,
  Card,
  EmptyState,
  Skeleton,
  useConfirmPrompt,
  useTextPrompt,
} from '../components/ui.js';
import { ProfileMarkdown } from '../components/markdown.js';
import { SwipePlaylist, type PlaylistTrack } from '../components/music-player.js';
import { ProfileAvatar } from '../components/profile-avatar.js';
import { ShareToChatsDialog } from '../components/share-to-chats.js';
import { VerificationBadge } from '../components/verification-badge.js';
import { DoubleHeartIcon } from '../components/double-heart-icon.js';
import { ExpandableText, useClampedContent } from '../components/expandable-text.js';
import { haptic } from '../telegram.js';
import { timezoneDisplayName } from '../components/viewer-time.js';

function formatMetric(value: number | undefined, exact: boolean): string {
  const count = Math.max(0, Number(value ?? 0));
  if (!exact && count >= 10_000) return '10 000+';
  return new Intl.NumberFormat('ru-RU').format(count);
}

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

function initialSearchState(): { query: string; scope: SearchScope } {
  const params = new URLSearchParams(window.location.search);
  const query = (params.get('q') ?? '').slice(0, 80);
  return {
    query,
    scope: params.get('scope') === 'profiles' ? 'profiles' : 'questionnaires',
  };
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
  onReport,
  onShare,
  messagePending = false,
}: {
  profile: SearchProfile;
  preview?: boolean;
  expanded?: boolean;
  onOpen?: () => void;
  onMessage?: () => void;
  onReport?: () => void;
  onShare?: () => void;
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
    file_size_bytes?: number | null;
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
  const [viewRecorded, setViewRecorded] = useState(false);
  const [viewDelta, setViewDelta] = useState(0);
  const [reportMenuOpen, setReportMenuOpen] = useState(false);
  const [descriptionExpanded, setDescriptionExpanded] = useState(false);
  const descriptionCollapsed = !expanded && !descriptionExpanded;
  const { contentRef: descriptionRef, wasClamped: descriptionWasClamped } =
    useClampedContent<HTMLDivElement>(profile.about, descriptionCollapsed);
  const mediaTouchStart = useRef<{ x: number; y: number } | null>(null);
  const currentMedia = visualMedia[mediaIndex % Math.max(visualMedia.length, 1)];
  const autoPlayCover =
    !expanded &&
    Boolean(profile.has_premium) &&
    mediaIndex === 0 &&
    currentMedia?.media_type === 'video';
  const finishMediaSwipe = (clientX: number, clientY: number, fullscreen: boolean) => {
    const start = mediaTouchStart.current;
    mediaTouchStart.current = null;
    if (!start) return;
    const deltaX = clientX - start.x;
    const deltaY = clientY - start.y;
    if (fullscreen && deltaY < -70 && Math.abs(deltaY) > Math.abs(deltaX)) {
      setFullscreenMediaOpen(false);
      return;
    }
    if (visualMedia.length < 2 || Math.abs(deltaX) < 55 || Math.abs(deltaX) <= Math.abs(deltaY)) {
      return;
    }
    setMediaIndex((index) =>
      deltaX < 0
        ? (index + 1) % visualMedia.length
        : (index - 1 + visualMedia.length) % visualMedia.length,
    );
  };
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
  useEffect(() => {
    if ((!expanded && !fullscreenMediaOpen) || preview || viewRecorded) return;
    setViewRecorded(true);
    void api
      .recordQuestionnaireView(profile.id)
      .then(({ recorded }) => setViewDelta(recorded ? 1 : 0))
      .catch(() => setViewRecorded(false));
  }, [expanded, fullscreenMediaOpen, preview, profile.id, viewRecorded]);
  return (
    <>
      <Card
        className={`profile-card questionnaire-card overflow-hidden ${
          expanded ? 'profile-card-expanded' : ''
        }`}
      >
        <div
          className="profile-cover"
          onTouchStart={(event) => {
            const touch = event.touches[0];
            if (touch) mediaTouchStart.current = { x: touch.clientX, y: touch.clientY };
          }}
          onTouchEnd={(event) => {
            const touch = event.changedTouches[0];
            if (touch) finishMediaSwipe(touch.clientX, touch.clientY, false);
          }}
        >
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
              className={`profile-media-fullscreen ${
                expanded ? 'profile-media-fullscreen-expanded' : ''
              }`}
              type="button"
              aria-label={ru.miniApp.search.openMediaFullscreen}
              onClick={() => setFullscreenMediaOpen(true)}
            >
              <Maximize2 className="h-5 w-5" />
            </button>
          ) : null}
          {visualMedia.length > 1 ? (
            <div className="profile-media-dots" aria-hidden>
              {visualMedia.map((item, index) => (
                <span className={index === mediaIndex ? 'active' : ''} key={item.id} />
              ))}
            </div>
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
        <div className="questionnaire-card-body p-5">
          <div className="questionnaire-card-header">
            <div className="questionnaire-card-author profile-author-link">
              <Link
                className="questionnaire-card-avatar-link"
                href={`/profiles/${profile.user_id}`}
                aria-label={profile.display_name}
              >
                <ProfileAvatar
                  mediaId={profile.avatar_media_id}
                  renderMode={profile.avatar_render_mode}
                  name={profile.display_name}
                />
              </Link>
              <div className="questionnaire-card-author-copy">
                <Link
                  className="questionnaire-card-name-link"
                  href={`/profiles/${profile.user_id}`}
                >
                  {/* A 30px serif for a card heading crowded everything under it;
                      the name reads as a name at interface scale. */}
                  <h2 className="questionnaire-card-name">
                    <span className="truncate">{profile.display_name}</span>
                    <VerificationBadge
                      kind={profile.verification_kind}
                      premium={profile.has_premium}
                    />
                  </h2>
                </Link>
                {profile.username ? (
                  <p className="truncate text-xs text-lilac">@{profile.username}</p>
                ) : null}
                <ExpandableText
                  className="mt-1 text-sm text-muted"
                  text={profile.short_headline}
                  lines={1}
                  collapseOnContentClick
                />
              </div>
            </div>
            <div className="profile-card-header-actions">
              {profile.is_ready_now ? (
                <span className="ready-now-badge">{ru.miniApp.community.readyToChatBadge}</span>
              ) : null}
              {profile.is_online ? (
                <span className="activity-dot" title={ru.miniApp.search.onlineNow} />
              ) : null}
              {onReport ? (
                <div className="profile-card-menu">
                  <button
                    className="profile-card-menu-trigger"
                    type="button"
                    aria-label={ru.miniApp.search.report}
                    aria-haspopup="menu"
                    aria-expanded={reportMenuOpen}
                    onClick={() => setReportMenuOpen((value) => !value)}
                  >
                    <MoreVertical aria-hidden />
                  </button>
                  {reportMenuOpen ? (
                    <div className="profile-card-menu-popover" role="menu">
                      <button
                        type="button"
                        role="menuitem"
                        onClick={() => {
                          setReportMenuOpen(false);
                          onReport();
                        }}
                      >
                        <Flag aria-hidden /> {ru.miniApp.search.report}
                      </button>
                    </div>
                  ) : null}
                </div>
              ) : null}
            </div>
          </div>
          <div className="questionnaire-tag-cloud mt-4 flex flex-wrap gap-2">
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
            contentRef={descriptionRef}
            className={`mt-4 text-sm leading-relaxed text-soft ${
              descriptionCollapsed ? 'expandable-text-lines-4' : ''
            }`}
            allowLinks={Boolean(profile.has_premium)}
          >
            {profile.about}
          </ProfileMarkdown>
          {!expanded && descriptionWasClamped ? (
            <button
              className="profile-bio-more mt-2"
              type="button"
              aria-expanded={descriptionExpanded}
              onClick={() => setDescriptionExpanded((value) => !value)}
            >
              {descriptionExpanded ? ru.miniApp.social.collapseBio : ru.miniApp.social.expandBio}
            </button>
          ) : null}
          {audioMedia.length ? (
            <SwipePlaylist
              emptyLabel={ru.miniApp.search.trackUnknown}
              tracks={audioMedia.slice(0, 5).map<PlaylistTrack>((item) => ({
                id: item.id,
                src: `/api/profile-media/${item.id}`,
                title: item.track_title || ru.miniApp.search.trackUnknown,
                performer: item.track_performer || ru.miniApp.search.performerUnknown,
                ...(item.file_size_bytes !== undefined
                  ? { fileSizeBytes: item.file_size_bytes }
                  : {}),
                ...(item.has_thumbnail
                  ? { coverSrc: `/api/profile-media/${item.id}/thumbnail` }
                  : {}),
              }))}
            />
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
          <p
            className="questionnaire-views"
            title={formatMetric(Number(profile.view_count ?? 0) + viewDelta, true)}
          >
            <Eye aria-hidden />
            {formatMetric(Number(profile.view_count ?? 0) + viewDelta, expanded)}
          </p>
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
              {expanded && onShare ? (
                <Button type="button" variant="secondary" onClick={onShare}>
                  <Share2 className="h-4 w-4" /> {ru.miniApp.social.share}
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
            onTouchStart={(event) => {
              const touch = event.touches[0];
              if (touch) mediaTouchStart.current = { x: touch.clientX, y: touch.clientY };
            }}
            onTouchEnd={(event) => {
              const touch = event.changedTouches[0];
              if (touch) finishMediaSwipe(touch.clientX, touch.clientY, true);
            }}
          >
            <button
              className="media-lightbox-close"
              type="button"
              aria-label={ru.miniApp.musicPlayer.close}
              onClick={() => setFullscreenMediaOpen(false)}
            >
              <X aria-hidden />
            </button>
            {visualMedia.length > 1 ? (
              <>
                <button
                  className="media-lightbox-nav media-lightbox-prev"
                  type="button"
                  aria-label={ru.miniApp.search.previousMedia}
                  onClick={() =>
                    setMediaIndex((index) => (index - 1 + visualMedia.length) % visualMedia.length)
                  }
                >
                  <ChevronLeft aria-hidden />
                </button>
                <button
                  className="media-lightbox-nav media-lightbox-next"
                  type="button"
                  aria-label={ru.miniApp.search.nextMedia}
                  onClick={() => setMediaIndex((index) => (index + 1) % visualMedia.length)}
                >
                  <ChevronRight aria-hidden />
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
    [ru.miniApp.search.timezone, profile.timezone ? timezoneDisplayName(profile.timezone) : ''],
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

function GlobalProfileResult({
  profile,
  onOpen,
}: {
  profile: PublicUserProfile;
  onOpen: () => void;
}) {
  return (
    <Card className="p-4">
      <button
        className="flex w-full items-start gap-3 text-left"
        type="button"
        aria-label={`${ru.miniApp.search.openProfile}: ${profile.display_name}`}
        onClick={onOpen}
      >
        <ProfileAvatar
          mediaId={profile.avatar_media_id}
          renderMode={profile.avatar_render_mode}
          name={profile.display_name}
        />
        <div className="min-w-0 flex-1">
          <strong className="flex items-center gap-1 break-words">
            {profile.display_name}
            <VerificationBadge kind={profile.verification_kind} premium={profile.has_premium} />
          </strong>
          <p className="mt-1 text-xs text-muted">
            {ru.miniApp.social.questionnaireCount(profile.questionnaire_count)} ·{' '}
            {ru.miniApp.social.postCount(profile.post_count)}
          </p>
        </div>
      </button>
      <ExpandableText
        text={profile.bio}
        emptyText={ru.miniApp.social.bioEmpty}
        className="mt-3 whitespace-pre-wrap break-words text-sm text-soft"
      />
    </Card>
  );
}

export function SearchPage() {
  const { confirm, dialog: confirmDialog } = useConfirmPrompt();
  const { ask, dialog: promptDialog } = useTextPrompt();
  const [, navigate] = useLocation();
  const queryClient = useQueryClient();
  const initialState = useRef(initialSearchState());
  const [query, setQuery] = useState(initialState.current.query);
  const [queryDraft, setQueryDraft] = useState(initialState.current.query);
  const [scope, setScope] = useState<SearchScope>(initialState.current.scope);
  const [staffNotice, setStaffNotice] = useState('');
  const [quickModerationId, setQuickModerationId] = useState<string | null>(null);
  const [selectedProfile, setSelectedProfile] = useState<SearchProfile | null>(null);
  const [shareQuestionnaireId, setShareQuestionnaireId] = useState<string | null>(null);
  const me = useQuery({ queryKey: ['me'], queryFn: api.me });
  const profiles = useInfiniteQuery({
    queryKey: ['search', query],
    queryFn: ({ pageParam }) => api.search(query, pageParam),
    initialPageParam: 0,
    getNextPageParam: (lastPage, pages) =>
      lastPage.length === 20 ? pages.reduce((total, page) => total + page.length, 0) : undefined,
    enabled: scope === 'questionnaires',
  });
  const questionnaireResults = profiles.data?.pages.flatMap((page) => page) ?? [];
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
  const [swipeNotice, setSwipeNotice] = useState('');
  useEffect(() => {
    if (!swipeNotice) return;
    const timeout = window.setTimeout(() => setSwipeNotice(''), 3_500);
    return () => window.clearTimeout(timeout);
  }, [swipeNotice]);
  useEffect(() => {
    const params = new URLSearchParams();
    params.set('scope', scope);
    if (query) params.set('q', query);
    window.history.replaceState(window.history.state, '', `/search?${params.toString()}`);
  }, [query, scope]);
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
    }) => api.swipe(profile.user_id, action, profile.id),
    onMutate: () => setSwipeNotice(''),
    onSuccess: (result, variables) => {
      haptic(result.matched ? 'heavy' : 'light');
      setSwipeNotice(
        result.alreadySent
          ? ru.miniApp.search.sympathyAlreadySent
          : result.matched
            ? ru.miniApp.search.matchCreated
            : variables.action === 'super_like'
              ? ru.miniApp.search.superLikeSaved
              : variables.action === 'like'
                ? ru.miniApp.search.likeSaved
                : ru.miniApp.search.skipSaved,
      );
      void queryClient.invalidateQueries({ queryKey: ['search'] });
      void queryClient.invalidateQueries({ queryKey: ['premium-status'] });
      void queryClient.invalidateQueries({ queryKey: ['incoming-likes'] });
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
    mutationFn: async (targetUserId: string) => {
      const started = await api.startDirectConversation(targetUserId);
      const conversations = await api.conversations();
      return { ...started, conversations };
    },
    onSuccess: ({ conversationId, conversations }) => {
      queryClient.setQueryData(['conversations'], conversations);
      navigate(`/chats?conversation=${encodeURIComponent(conversationId)}`);
    },
  });
  const shareQuestionnaire = useMutation({
    mutationFn: (conversationIds: string[]) => {
      if (!shareQuestionnaireId) throw new Error(ru.api.requestFailed);
      return api.shareEntity({
        entityType: 'questionnaire',
        entityId: shareQuestionnaireId,
        conversationIds,
      });
    },
    onSuccess: () => setShareQuestionnaireId(null),
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
      setQuickModerationId(null);
      if (variables.action !== 'warn') {
        void queryClient.invalidateQueries({ queryKey: ['search'] });
      }
      void queryClient.invalidateQueries({ queryKey: ['admin-users'] });
      void queryClient.invalidateQueries({ queryKey: ['admin-questionnaires'] });
      void queryClient.invalidateQueries({ queryKey: ['admin-public-profiles'] });
    },
  });
  const filtersPanel =
    filtersOpen && preferences.data ? (
      preferences.data.premium ? (
        <SearchFilters
          preferences={preferences.data}
          onSaved={() => {
            setFiltersOpen(false);
            // The feed is an infinite query: refetching it would re-request every
            // page already scrolled through, under the new filters, and stitch
            // the results together. New filters mean starting from the top.
            void queryClient.resetQueries({ queryKey: ['search', query] });
            void availability.refetch();
          }}
        />
      ) : (
        <Card className="mb-4 p-4 text-left text-sm text-soft">
          {ru.miniApp.search.premiumFiltersOnly}{' '}
          <a className="text-lilac underline" href="/premium">
            {ru.miniApp.search.openPremium}
          </a>
        </Card>
      )
    ) : null;

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
            <GlobalProfileResult
              key={profile.id}
              profile={profile}
              onOpen={() => navigate(`/profiles/${profile.id}`)}
            />
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
  if (!questionnaireResults.length) {
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
          <div className="w-full space-y-3">
            <SearchScopeTabs
              value={scope}
              onChange={(nextScope) => {
                setScope(nextScope);
              }}
            />
            {searchForm}
            <Button
              className="w-full"
              data-testid="empty-search-filters-toggle"
              type="button"
              variant="secondary"
              aria-expanded={filtersOpen}
              onClick={() => setFiltersOpen((value) => !value)}
            >
              <SlidersHorizontal className="h-4 w-4" />
              {ru.miniApp.search.filters}
            </Button>
            {filtersPanel}
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
          className="search-filter-toggle"
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
      {filtersPanel}
      <div className="space-y-8" data-testid="questionnaire-feed">
        {questionnaireResults.map((profile, profileIndex) => (
          <motion.article
            key={profile.id}
            initial={{ opacity: 0, y: 18 }}
            animate={{ opacity: 1, y: 0 }}
            className="space-y-3"
          >
            <ProfileCard
              profile={profile}
              onOpen={() => setSelectedProfile(profile)}
              onReport={() =>
                ask(ru.miniApp.search.reportPrompt, (description) => {
                  if (!description) return;
                  report.mutate({
                    reportedUserId: profile.user_id,
                    questionnaireId: profile.id,
                    category: 'other',
                    description,
                  });
                })
              }
            />
            {me.data?.isAdmin ? (
              <div
                className="quick-moderation-control questionnaire-quick-moderation"
                data-testid={
                  profileIndex === 0 ? 'search-moderation-panel' : `search-moderation-${profile.id}`
                }
              >
                <button
                  type="button"
                  className="quick-moderation-trigger"
                  aria-label={ru.miniApp.search.quickModeration}
                  aria-expanded={quickModerationId === profile.id}
                  onClick={() =>
                    setQuickModerationId((current) => (current === profile.id ? null : profile.id))
                  }
                >
                  <Shield aria-hidden />
                </button>
                {quickModerationId === profile.id ? (
                  <>
                    <button
                      type="button"
                      className="quick-moderation-backdrop"
                      aria-label={ru.miniApp.community.cancelAction}
                      onClick={() => setQuickModerationId(null)}
                    />
                    <div className="quick-moderation-menu" role="menu">
                      <strong>{ru.miniApp.search.quickModeration}</strong>
                      <Button
                        variant="secondary"
                        loading={staffModeration.isPending}
                        onClick={() => {
                          const reason = window
                            .prompt(ru.miniApp.admin.warningReasonPrompt)
                            ?.trim();
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
                          const reason = window
                            .prompt(ru.miniApp.search.disableReasonPrompt)
                            ?.trim();
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
                  </>
                ) : null}
              </div>
            ) : null}
            <div className="swipe-actions">
              <Button
                variant="secondary"
                aria-label={ru.miniApp.search.skip}
                disabled={swipe.isPending}
                onClick={() => swipe.mutate({ action: 'skip', profile })}
              >
                <X />
              </Button>
              <Button
                className="like-button"
                aria-label={ru.miniApp.search.like}
                aria-pressed={profile.own_rating === 1}
                disabled={swipe.isPending}
                onClick={() => swipe.mutate({ action: 'like', profile })}
              >
                <Heart />
              </Button>
              <Button
                className="super-like-button"
                aria-label={ru.miniApp.search.superLike}
                disabled={swipe.isPending}
                onClick={() => swipe.mutate({ action: 'super_like', profile })}
              >
                <DoubleHeartIcon />
              </Button>
            </div>
            <div className="flex justify-center gap-6 text-xs text-muted">
              <button
                className="inline-flex gap-1"
                onClick={() =>
                  confirm(ru.miniApp.search.blockConfirm, () => block.mutate(profile.user_id))
                }
              >
                <Ban className="h-3.5 w-3.5" /> {ru.miniApp.search.block}
              </button>
            </div>
          </motion.article>
        ))}
      </div>
      {profiles.hasNextPage ? (
        <Button
          className="mx-auto mt-6 flex"
          variant="secondary"
          loading={profiles.isFetchingNextPage}
          onClick={() => void profiles.fetchNextPage()}
        >
          {ru.miniApp.search.loadMore}
        </Button>
      ) : null}
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
              onShare={() => setShareQuestionnaireId(selectedProfile.id)}
              onReport={() =>
                ask(ru.miniApp.search.reportPrompt, (description) => {
                  if (!description) return;
                  report.mutate({
                    reportedUserId: selectedProfile.user_id,
                    questionnaireId: selectedProfile.id,
                    category: 'other',
                    description,
                  });
                })
              }
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
      {swipeNotice ? (
        <p className="swipe-notice-toast" role="status" aria-live="polite">
          {swipeNotice}
        </p>
      ) : null}
      {staffNotice ? <p className="mt-3 text-center text-sm text-lilac">{staffNotice}</p> : null}
      {staffModeration.isError ? (
        <div className="error-box mt-3">{staffModeration.error.message}</div>
      ) : null}
      <ShareToChatsDialog
        open={shareQuestionnaireId !== null}
        loading={shareQuestionnaire.isPending}
        onClose={() => setShareQuestionnaireId(null)}
        onSend={(conversationIds) => shareQuestionnaire.mutate(conversationIds)}
      />
      {confirmDialog}
      {promptDialog}
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
  const [timezones, setTimezones] = useState(list(preferences.timezones));
  const [filterSetName, setFilterSetName] = useState('');
  const filterSets = useQuery({ queryKey: ['filter-sets'], queryFn: api.filterSets });
  const emptyInput: SearchPreferencesInput = {
    ageGroups: [],
    languages: [],
    genres: [],
    fandoms: [],
    writingStyles: [],
    activityLevels: [],
    onlyOnline: false,
    onlyWithPhoto: false,
    timezones: [],
  };
  const completeSave = () => {
    void queryClient.invalidateQueries({ queryKey: ['search-preferences'] });
    void queryClient.invalidateQueries({ queryKey: ['filter-sets'] });
    onSaved();
  };
  const save = useMutation({
    mutationFn: (input: SearchPreferencesInput) => api.saveSearchPreferences(input),
    onSuccess: completeSave,
  });
  const reset = useMutation({
    mutationFn: () => api.saveSearchPreferences(emptyInput),
    onSuccess: () => {
      setAgeGroups([]);
      setGenres('');
      setFandoms('');
      setWritingStyles('');
      setActivityLevels('');
      setOnlyOnline(false);
      setOnlyWithPhoto(false);
      setTimezones([]);
      completeSave();
    },
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
    timezones,
  });
  const [timezonesOpen, setTimezonesOpen] = useState(false);
  const [timezoneQuery, setTimezoneQuery] = useState('');
  const timezoneLabels = new Map<string, string>(ru.miniApp.profile.timezoneOptions);
  const timezoneNeedle = timezoneQuery.trim().toLocaleLowerCase('ru-RU');
  const visibleTimezones = ru.miniApp.profile.timezoneOptions.filter(([value, label]) =>
    timezoneNeedle
      ? label.toLocaleLowerCase('ru-RU').includes(timezoneNeedle) ||
        value.toLocaleLowerCase('ru-RU').includes(timezoneNeedle)
      : true,
  );
  const activeFilterCount =
    ageGroups.length +
    timezones.length +
    split(genres).length +
    split(fandoms).length +
    split(writingStyles).length +
    split(activityLevels).length +
    (onlyOnline ? 1 : 0) +
    (onlyWithPhoto ? 1 : 0);
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
    <Card className="search-filters mb-4 text-left" data-testid="search-filters-panel">
      <header className="search-filters-header">
        <div>
          <strong>{ru.miniApp.search.filtersTitle}</strong>
          <p>{ru.miniApp.search.filtersHint}</p>
        </div>
        {activeFilterCount ? (
          <span className="search-filters-count">{activeFilterCount}</span>
        ) : null}
      </header>

      <section className="search-filters-section">
        <h3>{ru.miniApp.search.filterAge}</h3>
        <div className="search-filters-chips">
          {ageOptions.map((age, index) => (
            <button
              key={age}
              type="button"
              className={`filter-chip ${ageGroups.includes(age) ? 'is-selected' : ''}`}
              aria-pressed={ageGroups.includes(age)}
              onClick={() =>
                setAgeGroups((current) =>
                  current.includes(age)
                    ? current.filter((item) => item !== age)
                    : [...current, age],
                )
              }
            >
              {ru.miniApp.profile.ageOptions[index]}
            </button>
          ))}
        </div>
      </section>

      <section className="search-filters-section">
        <h3>{ru.miniApp.search.filtersSectionInterests}</h3>
        <p className="search-filters-note">{ru.miniApp.search.filtersCommaHint}</p>
        {(
          [
            [genres, setGenres, ru.miniApp.search.filterGenres],
            [fandoms, setFandoms, ru.miniApp.search.filterFandoms],
            [writingStyles, setWritingStyles, ru.miniApp.search.filterWritingStyles],
            [activityLevels, setActivityLevels, ru.miniApp.search.filterActivity],
          ] as const
        ).map(([value, setter, placeholder]) => (
          <label className="search-filters-field" key={placeholder}>
            <span>{placeholder}</span>
            <input
              className="input-field"
              value={value}
              onChange={(event) => setter(event.target.value)}
              placeholder={placeholder}
            />
          </label>
        ))}
      </section>

      <section className="search-filters-section">
        <h3>{ru.miniApp.search.filterTimezone}</h3>
        {/* There are 37 zones with long labels. Listing them all buried the rest of
            the panel, so only the chosen ones show until the picker is opened. */}
        {timezones.length ? (
          <div className="search-filters-chips">
            {timezones.map((value) => (
              <button
                key={value}
                type="button"
                className="filter-chip is-selected"
                aria-pressed
                onClick={() => setTimezones((current) => current.filter((item) => item !== value))}
              >
                {timezoneLabels.get(value) ?? value}
              </button>
            ))}
          </div>
        ) : (
          <p className="search-filters-note">{ru.miniApp.search.timezoneAny}</p>
        )}
        <button
          type="button"
          className="search-filters-disclosure"
          aria-expanded={timezonesOpen}
          onClick={() => setTimezonesOpen((open) => !open)}
        >
          {timezonesOpen ? ru.miniApp.search.hideTimezones : ru.miniApp.search.chooseTimezones}
        </button>
        {timezonesOpen ? (
          <div className="search-filters-picker">
            <input
              className="search-filters-set-name"
              value={timezoneQuery}
              placeholder={ru.miniApp.search.timezoneSearch}
              onChange={(event) => setTimezoneQuery(event.target.value)}
            />
            <div className="search-filters-picker-list">
              {visibleTimezones.map(([value, label]) => (
                <button
                  key={value}
                  type="button"
                  className={timezones.includes(value) ? 'is-selected' : ''}
                  aria-pressed={timezones.includes(value)}
                  onClick={() =>
                    setTimezones((current) =>
                      current.includes(value)
                        ? current.filter((item) => item !== value)
                        : [...current, value],
                    )
                  }
                >
                  {timezones.includes(value) ? <Check aria-hidden /> : null}
                  <span>{label}</span>
                </button>
              ))}
              {!visibleTimezones.length ? (
                <p className="search-filters-note">{ru.miniApp.search.timezoneNothingFound}</p>
              ) : null}
            </div>
          </div>
        ) : null}
      </section>

      <section className="search-filters-section">
        <h3>{ru.miniApp.search.filtersSectionExtra}</h3>
        <label className="search-filters-switch">
          <span>{ru.miniApp.search.onlyOnline}</span>
          <input
            type="checkbox"
            checked={onlyOnline}
            onChange={(event) => setOnlyOnline(event.target.checked)}
          />
        </label>
        <label className="search-filters-switch">
          <span>{ru.miniApp.search.onlyWithPhoto}</span>
          <input
            type="checkbox"
            checked={onlyWithPhoto}
            onChange={(event) => setOnlyWithPhoto(event.target.checked)}
          />
        </label>
      </section>

      <section className="search-filters-section">
        <h3>{ru.miniApp.search.savedFilterSets}</h3>
        <div className="search-filters-set-form">
          <input
            className="search-filters-set-name"
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
        {filterSets.data?.length ? (
          <ul className="search-filters-sets">
            {filterSets.data.map((item) => (
              <li className={item.is_active ? 'is-active' : ''} key={item.id}>
                <button
                  type="button"
                  className="search-filters-set-name-button"
                  onClick={() => activateSet.mutate(item.id)}
                >
                  {item.is_active ? <Check aria-hidden /> : null}
                  <span>{item.name}</span>
                </button>
                <button
                  type="button"
                  className="search-filters-set-delete"
                  aria-label={ru.miniApp.search.deleteFilterSet}
                  onClick={() => deleteSet.mutate(item.id)}
                >
                  <Trash2 aria-hidden />
                </button>
              </li>
            ))}
          </ul>
        ) : (
          <p className="search-filters-note">{ru.miniApp.search.noFilterSets}</p>
        )}
      </section>

      <div className="search-filters-actions">
        <Button loading={save.isPending} onClick={() => save.mutate({ ...currentInput() })}>
          {ru.miniApp.search.saveFilters}
        </Button>
        <Button
          data-testid="reset-search-filters"
          type="button"
          variant="secondary"
          loading={reset.isPending}
          onClick={() => reset.mutate()}
        >
          {ru.miniApp.search.resetFilters}
        </Button>
      </div>
    </Card>
  );
}
