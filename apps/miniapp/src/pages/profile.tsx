import { zodResolver } from '@hookform/resolvers/zod';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import {
  ArrowRight,
  Check,
  ChevronDown,
  Edit3,
  Eye,
  EyeOff,
  ImagePlus,
  Music2,
  Smile,
  Trash2,
  UserRound,
  X,
} from 'lucide-react';
import { useEffect, useRef, useState, type ReactNode } from 'react';
import { useForm, type FieldErrors, type Resolver } from 'react-hook-form';
import { Link, useLocation } from 'wouter';
import { profileSchema, ru, type ProfileInput } from '@rolemate/shared';
import { ApiError, api } from '../api.js';
import type { ProfileMedia } from '../api.js';
import { ProfileMarkdown } from '../components/markdown.js';
import { CustomEmojiPickerDialog } from '../components/custom-emoji-picker.js';
import { customEmojiToken } from '../components/custom-emoji-token.js';
import { ProfileAvatar } from '../components/profile-avatar.js';
import { VerificationBadge } from '../components/verification-badge.js';
import {
  Button,
  Card,
  ConfirmDialog,
  EmptyState,
  SectionTitle,
  Skeleton,
  useConfirmPrompt,
} from '../components/ui.js';
import { getTelegram } from '../telegram.js';
import { ProfileCard } from './search.js';
import { timezoneDisplayName } from '../components/viewer-time.js';

const defaults: ProfileInput = {
  displayName: '',
  ageGroup: '18_20',
  gender: 'not_specified',
  shortHeadline: '',
  about: '',
  roleplayExperience: 'not_specified',
  preferredRole: [ru.miniApp.profile.defaults.preferredRole],
  writingStyle: 'literary',
  averagePostLength: 'paragraphs_3_5',
  activityFrequency: 'daily',
  timezone: 'UTC+3',
  activeHours: ru.miniApp.profile.defaults.activeHours,
  languages: ['ru'],
  fandoms: [],
  genres: [],
  tags: [],
  settings: '',
  plots: '',
  lookingFor: [ru.miniApp.profile.defaults.lookingFor],
  boundaries: '',
  adultTopicsAllowed: false,
  contactRevealPolicy: 'mutual_only',
};

const profileFieldLabels: Partial<Record<keyof ProfileInput, string>> = {
  displayName: ru.miniApp.profile.alias,
  shortHeadline: ru.miniApp.profile.headline,
  about: ru.miniApp.profile.about,
  preferredRole: ru.miniApp.profile.preferredRole,
  languages: ru.miniApp.profile.languages,
  fandoms: ru.miniApp.profile.fandoms,
  genres: ru.miniApp.profile.genres,
  tags: ru.miniApp.profile.tags,
  timezone: ru.miniApp.profile.timezone,
  lookingFor: ru.miniApp.profile.lookingFor,
  boundaries: ru.miniApp.profile.boundaries,
  adultTopicsAllowed: ru.miniApp.profile.adultTopics,
};

function invalidProfileFieldLabels(errors: FieldErrors<ProfileInput>): string[] {
  return (Object.keys(errors) as Array<keyof ProfileInput>)
    .map((fieldName) => profileFieldLabels[fieldName])
    .filter((label): label is string => Boolean(label));
}

function stringList(value: unknown): string[] {
  try {
    const parsed: unknown = JSON.parse(String(value));
    return Array.isArray(parsed)
      ? parsed.filter((item): item is string => typeof item === 'string')
      : [];
  } catch {
    return [];
  }
}

function stringValue(value: unknown, fallback = ''): string {
  return typeof value === 'string' ? value : fallback;
}

function commaList(value: string): string[] {
  return value
    .split(',')
    .map((item) => item.trim())
    .filter(Boolean);
}

function SuggestionRail({ children }: { children: ReactNode }) {
  const railRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const rail = railRef.current;
    if (!rail) return;
    const handleWheel = (event: WheelEvent) => {
      if (rail.scrollWidth <= rail.clientWidth) return;
      const distance =
        Math.abs(event.deltaY) >= Math.abs(event.deltaX) ? event.deltaY : event.deltaX;
      if (!distance) return;
      event.preventDefault();
      event.stopPropagation();
      rail.scrollLeft += distance;
    };
    rail.addEventListener('wheel', handleWheel, { passive: false });
    return () => rail.removeEventListener('wheel', handleWheel);
  }, []);
  return (
    <div ref={railRef} className="tag-suggestion-rail" aria-label={ru.miniApp.profile.suggestions}>
      {children}
    </div>
  );
}

type SuggestionKind =
  | 'language'
  | 'fandom'
  | 'genre'
  | 'tag'
  | 'hashtag'
  | 'plot'
  | 'setting'
  | 'looking_for'
  | 'boundary';

function useSuggestionSelection() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({ kind, value }: { kind: SuggestionKind; value: string }) =>
      api.recordTaxonomySelection(kind, value),
    onSuccess: (_result, variables) =>
      queryClient.invalidateQueries({ queryKey: ['taxonomy-suggestions', variables.kind] }),
  });
}

interface CommaTagInputProps {
  label: string;
  placeholder: string;
  value: string[];
  maxItems: number;
  suggestionKind?: SuggestionKind;
  onChange: (value: string[]) => void;
}

function SuggestionTextarea({
  label,
  value,
  kind,
  className,
  onChange,
}: {
  label: string;
  value: string;
  kind: Extract<SuggestionKind, 'plot' | 'setting' | 'boundary'>;
  className: string;
  onChange: (value: string) => void;
}) {
  const recordSelection = useSuggestionSelection();
  const [emojiPickerOpen, setEmojiPickerOpen] = useState(false);
  const activePhrase =
    value
      .split(/[,;\n]/u)
      .at(-1)
      ?.trim() ?? '';
  const suggestions = useQuery({
    queryKey: ['taxonomy-suggestions', kind, activePhrase],
    queryFn: () => api.taxonomySuggestions(kind, activePhrase),
    staleTime: 60_000,
  });
  const normalizedParts = new Set(
    value
      .split(/[,;\n]/u)
      .map((item) => item.trim().toLocaleLowerCase('ru-RU'))
      .filter(Boolean),
  );
  const appendSuggestion = (suggestion: string) => {
    const prefix = value.replace(/[^,;\n]*$/u, '').trimEnd();
    const separator = prefix && !/[,;\n]\s*$/u.test(prefix) ? ', ' : prefix ? ' ' : '';
    onChange(`${prefix}${separator}${suggestion}`);
  };

  return (
    <div className="suggestion-textarea">
      <textarea
        aria-label={label}
        className={className}
        value={value}
        onChange={(event) => onChange(event.target.value)}
      />
      {/* Imported emoji can be written into the text itself: the token is plain
          text, so it survives the field, the database and every re-edit. */}
      <div className="suggestion-textarea-tools">
        <button
          type="button"
          className="custom-emoji-insert"
          aria-label={ru.miniApp.social.customEmojiInsert}
          title={ru.miniApp.social.customEmojiInsert}
          onClick={() => setEmojiPickerOpen(true)}
        >
          <Smile aria-hidden />
        </button>
      </div>
      {emojiPickerOpen ? (
        <CustomEmojiPickerDialog
          onPick={(customEmojiId) => {
            if (customEmojiId) onChange(`${value}${customEmojiToken(customEmojiId)}`);
            setEmojiPickerOpen(false);
          }}
          onClose={() => setEmojiPickerOpen(false)}
        />
      ) : null}
      {suggestions.data?.length ? (
        <SuggestionRail>
          {suggestions.data
            .filter(
              (suggestion) => !normalizedParts.has(suggestion.value.toLocaleLowerCase('ru-RU')),
            )
            .slice(0, 8)
            .map((suggestion) => (
              <button
                type="button"
                key={`${kind}:${suggestion.value}`}
                onClick={() => {
                  appendSuggestion(suggestion.value);
                  recordSelection.mutate({ kind, value: suggestion.value });
                }}
              >
                + {suggestion.value}
              </button>
            ))}
        </SuggestionRail>
      ) : null}
    </div>
  );
}

function CommaTagInput({
  label,
  placeholder,
  value,
  maxItems,
  suggestionKind,
  onChange,
}: CommaTagInputProps) {
  const [draft, setDraft] = useState('');
  const recordSelection = useSuggestionSelection();
  const [suggestionQuery, setSuggestionQuery] = useState('');
  useEffect(() => {
    const timeout = window.setTimeout(() => setSuggestionQuery(draft.trim()), 180);
    return () => window.clearTimeout(timeout);
  }, [draft]);
  const suggestions = useQuery({
    queryKey: ['taxonomy-suggestions', suggestionKind, suggestionQuery],
    queryFn: () => api.taxonomySuggestions(suggestionKind!, suggestionQuery),
    enabled: Boolean(suggestionKind),
    staleTime: 60_000,
  });
  const addItems = (items: string[]) => {
    const next = [...value];
    for (const item of items.map((entry) => entry.trim()).filter(Boolean)) {
      if (next.length >= maxItems) break;
      if (!next.some((entry) => entry.toLocaleLowerCase() === item.toLocaleLowerCase())) {
        next.push(item);
      }
    }
    onChange(next);
  };
  const commitDraft = () => {
    addItems(commaList(draft));
    setDraft('');
  };
  return (
    <div className="tag-input" aria-label={label}>
      <div className="tag-input-values">
        {value.map((item) => (
          <span className="tag tag-removable" key={item}>
            {item}
            <button
              type="button"
              aria-label={`${ru.miniApp.profile.removeTag}: ${item}`}
              onClick={() => onChange(value.filter((entry) => entry !== item))}
            >
              <X className="h-3 w-3" />
            </button>
          </span>
        ))}
      </div>
      <input
        className="tag-input-control"
        aria-label={label}
        value={draft}
        placeholder={value.length ? ru.miniApp.profile.addAnotherTag : placeholder}
        onChange={(event) => {
          const raw = event.target.value;
          const parts = raw.split(',');
          if (parts.length === 1) {
            setDraft(raw);
            return;
          }
          addItems(parts.slice(0, -1));
          setDraft(parts.at(-1) ?? '');
        }}
        onBlur={commitDraft}
        onKeyDown={(event) => {
          if (event.key !== 'Enter' && event.key !== ',') return;
          event.preventDefault();
          commitDraft();
        }}
      />
      {suggestionKind && suggestions.data?.length ? (
        <SuggestionRail>
          {suggestions.data
            .filter(
              (suggestion) =>
                !value.some(
                  (item) => item.toLocaleLowerCase() === suggestion.value.toLocaleLowerCase(),
                ),
            )
            .slice(0, 8)
            .map((suggestion) => (
              <button
                type="button"
                key={`${suggestionKind}:${suggestion.value}`}
                onMouseDown={(event) => event.preventDefault()}
                onClick={() => {
                  addItems([suggestion.value]);
                  setDraft('');
                  recordSelection.mutate({ kind: suggestionKind, value: suggestion.value });
                }}
              >
                + {suggestion.value}
              </button>
            ))}
        </SuggestionRail>
      ) : null}
    </div>
  );
}

interface TimezoneSelectProps {
  value: string;
  options: ReadonlyArray<readonly [string, string]>;
  onChange: (value: string) => void;
}

function TimezoneSelect({ value, options, onChange }: TimezoneSelectProps) {
  const [open, setOpen] = useState(false);
  const rootRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!open) return;
    const close = (event: MouseEvent | TouchEvent) => {
      if (!rootRef.current?.contains(event.target as Node)) setOpen(false);
    };
    document.addEventListener('mousedown', close);
    document.addEventListener('touchstart', close);
    return () => {
      document.removeEventListener('mousedown', close);
      document.removeEventListener('touchstart', close);
    };
  }, [open]);
  const selected = timezoneDisplayName(value);
  return (
    <div className="timezone-picker" ref={rootRef}>
      <button
        className="input-field timezone-picker-trigger"
        type="button"
        aria-haspopup="listbox"
        aria-expanded={open}
        onClick={() => setOpen((current) => !current)}
      >
        <span>{selected}</span>
        <ChevronDown className="h-4 w-4 shrink-0" />
      </button>
      {open ? (
        <div className="timezone-picker-menu" role="listbox">
          {options.map(([option]) => (
            <button
              className={option === value ? 'is-selected' : ''}
              key={option}
              type="button"
              role="option"
              aria-selected={option === value}
              onClick={() => {
                onChange(option);
                setOpen(false);
              }}
            >
              {timezoneDisplayName(option)}
            </button>
          ))}
        </div>
      ) : null}
    </div>
  );
}

function validationMessage(message: unknown): string {
  if (typeof message !== 'string') return '';
  const minimum = message.match(/(?:at least|>=)\s*(\d+)/i)?.[1];
  if (minimum) return ru.validation.minCharacters(Number(minimum));
  const maximum = message.match(/(?:at most|<=)\s*(\d+)/i)?.[1];
  if (maximum) return ru.validation.maxCharacters(Number(maximum));
  if (/invalid.*string|invalid format/i.test(message)) return ru.validation.timezone;
  return message;
}

function existingProfile(data: Record<string, unknown>): ProfileInput {
  return {
    displayName: stringValue(data.display_name),
    ageGroup: stringValue(data.age_group, '18_20') as ProfileInput['ageGroup'],
    gender: stringValue(data.gender, 'not_specified') as ProfileInput['gender'],
    shortHeadline: stringValue(data.short_headline),
    about: stringValue(data.about),
    roleplayExperience: stringValue(
      data.roleplay_experience,
      'not_specified',
    ) as ProfileInput['roleplayExperience'],
    preferredRole: stringList(data.preferred_role),
    writingStyle: stringValue(data.writing_style, 'literary') as ProfileInput['writingStyle'],
    averagePostLength: stringValue(
      data.average_post_length,
      'paragraphs_3_5',
    ) as ProfileInput['averagePostLength'],
    activityFrequency: stringValue(
      data.activity_frequency,
      'daily',
    ) as ProfileInput['activityFrequency'],
    timezone: stringValue(data.timezone, 'UTC+3'),
    activeHours: stringValue(data.active_hours),
    languages: stringList(data.languages),
    fandoms: stringList(data.fandoms),
    genres: stringList(data.genres),
    tags: stringList(data.tags),
    settings: stringValue(data.settings),
    plots: stringValue(data.plots),
    lookingFor: stringList(data.looking_for),
    boundaries: stringValue(data.boundaries),
    adultTopicsAllowed: Boolean(data.adult_topics_allowed),
    contactRevealPolicy: stringValue(
      data.contact_reveal_policy,
      'mutual_only',
    ) as ProfileInput['contactRevealPolicy'],
  };
}

function ProfileMediaPreview({ item }: { item: ProfileMedia }) {
  const source = `/api/profile-media/${item.id}`;
  if (item.media_type === 'video') {
    return <video className="aspect-square w-full bg-black object-contain" src={source} controls />;
  }
  if (item.media_type === 'audio' || item.media_type === 'voice') {
    return (
      <div className="flex aspect-square items-center justify-center p-4">
        <audio className="w-full" src={source} controls />
      </div>
    );
  }
  if (item.media_type === 'document') {
    return (
      <a
        className="flex aspect-square items-center justify-center p-4 text-lilac underline"
        href={source}
      >
        {ru.miniApp.profile.openMedia}
      </a>
    );
  }
  return <img className="aspect-square w-full object-cover" src={source} alt="" loading="lazy" />;
}

function ProfileMediaPickerPreview({ item }: { item: ProfileMedia }) {
  const source = `/api/profile-media/${item.id}`;
  if (item.media_type === 'video') {
    return <video src={source} muted playsInline preload="metadata" />;
  }
  if (item.media_type === 'photo' || item.media_type === 'animation') {
    return <img src={source} alt="" loading="lazy" />;
  }
  return (
    <span className="profile-media-picker-file">
      <ImagePlus aria-hidden />
      <small>{item.track_title || ru.miniApp.profile.mediaTitle}</small>
    </span>
  );
}

export function ProfilePage() {
  const { confirm, dialog } = useConfirmPrompt();
  const queryClient = useQueryClient();
  const [stateMessage, setStateMessage] = useState('');
  const [previewOpen, setPreviewOpen] = useState(false);
  const [mediaToDelete, setMediaToDelete] = useState<string | null>(null);
  const profile = useQuery({ queryKey: ['profile'], queryFn: api.profile, retry: false });
  const preview = useQuery({
    queryKey: ['profile-preview'],
    queryFn: api.profilePreview,
    enabled: previewOpen,
    retry: false,
  });
  const media = useQuery({ queryKey: ['profile-media'], queryFn: api.profileMedia, retry: false });
  const removeMedia = useMutation({
    mutationFn: api.deleteProfileMedia,
    onSuccess: () => {
      setMediaToDelete(null);
      void queryClient.invalidateQueries({ queryKey: ['profile-media'] });
      void queryClient.invalidateQueries({ queryKey: ['profile'] });
      void queryClient.invalidateQueries({ queryKey: ['profile-preview'] });
      void queryClient.invalidateQueries({ queryKey: ['public-profile'] });
      void queryClient.invalidateQueries({ queryKey: ['questionnaires'] });
      void queryClient.invalidateQueries({ queryKey: ['search'] });
      void queryClient.invalidateQueries({ queryKey: ['conversations'] });
    },
  });
  const setActive = useMutation({
    mutationFn: api.setProfileActive,
    onSuccess: ({ active }) => {
      setStateMessage(
        active
          ? ru.miniApp.profile.profileEnabledSuccess
          : ru.miniApp.profile.profileDisabledSuccess,
      );
      void queryClient.invalidateQueries({ queryKey: ['profile'] });
      void queryClient.invalidateQueries({ queryKey: ['search'] });
    },
  });
  if (profile.isLoading) return <Skeleton className="h-96" />;
  if (profile.isError) {
    return (
      <EmptyState
        icon={<UserRound className="h-7 w-7" />}
        title={ru.miniApp.profile.emptyTitle}
        description={ru.miniApp.profile.emptyDescription}
        action={
          <Link className="button button-primary" href="/profile/edit">
            {ru.miniApp.profile.create}
          </Link>
        }
      />
    );
  }
  const data = profile.data;
  if (!data) return null;
  const isActive = Boolean(data.is_active);
  const ownCover = media.data?.find((item) =>
    ['photo', 'animation', 'video'].includes(item.media_type),
  );
  return (
    <div>
      <SectionTitle
        eyebrow={ru.miniApp.profile.eyebrow}
        action={
          <div className="flex flex-wrap justify-end gap-2">
            <Button
              type="button"
              variant="secondary"
              onClick={() => setPreviewOpen((current) => !current)}
            >
              <Eye className="h-4 w-4" />
              {previewOpen
                ? ru.miniApp.profile.closePreview
                : ru.miniApp.profile.openProfilePreview}
            </Button>
            <Link href="/profile/edit" className="button button-secondary">
              <Edit3 className="h-4 w-4" /> {ru.miniApp.profile.edit}
            </Link>
          </div>
        }
      >
        {String(data.display_name)}
      </SectionTitle>
      {previewOpen ? (
        <section className="mb-5">
          <p className="mb-3 text-sm text-muted">{ru.miniApp.profile.previewDescription}</p>
          {preview.isLoading ? <Skeleton className="h-96" /> : null}
          {preview.data ? <ProfileCard profile={preview.data} preview /> : null}
          {preview.isError ? <div className="error-box">{preview.error.message}</div> : null}
        </section>
      ) : null}
      {!previewOpen ? (
        <>
          <Card className="overflow-hidden">
            <div className="profile-cover min-h-52">
              {ownCover ? (
                ownCover.media_type === 'video' ? (
                  <video
                    className="absolute inset-0 h-full w-full bg-black object-contain"
                    src={`/api/profile-media/${ownCover.id}`}
                    controls
                    playsInline
                    preload="metadata"
                  />
                ) : (
                  <img
                    className="absolute inset-0 h-full w-full object-cover"
                    src={`/api/profile-media/${ownCover.id}`}
                    alt=""
                  />
                )
              ) : null}
            </div>
            <div className="p-6">
              <div className="mb-4 flex items-center gap-3">
                <ProfileAvatar
                  mediaId={
                    typeof data.avatar_media_id === 'string' ? data.avatar_media_id : undefined
                  }
                  renderMode={
                    data.avatar_render_mode === 'photo' || data.avatar_render_mode === 'animation'
                      ? data.avatar_render_mode
                      : undefined
                  }
                  name={String(data.display_name)}
                  className="profile-avatar-large"
                />
                <div>
                  <strong className="inline-flex items-center gap-1">
                    {String(data.display_name)}
                    <VerificationBadge
                      kind={
                        data.verification_kind === 'owner' || data.verification_kind === 'moderator'
                          ? data.verification_kind
                          : undefined
                      }
                      premium={Boolean(data.has_premium)}
                    />
                  </strong>
                  <p className="text-xs text-muted">{ru.miniApp.profile.profileIdentityHint}</p>
                </div>
              </div>
              <span className="status-pill">
                {String(data.moderation_status) === 'approved' && !data.in_search_pool
                  ? ru.miniApp.profile.readyAfterSetup
                  : (ru.miniApp.profile.statuses[String(data.moderation_status)] ??
                    String(data.moderation_status))}
              </span>
              <h2 className="mt-3 font-display text-3xl">{String(data.short_headline)}</h2>
              <ProfileMarkdown
                className="mt-4 text-sm leading-relaxed text-soft"
                allowLinks={Boolean(data.has_premium)}
              >
                {String(data.about)}
              </ProfileMarkdown>
              <div className="mt-5 flex flex-wrap gap-2">
                {[...stringList(data.fandoms), ...stringList(data.genres)].map((tag) => (
                  <span className="tag" key={tag}>
                    {tag}
                  </span>
                ))}
              </div>
            </div>
          </Card>
          <Card className="mt-5 p-5">
            <div className="profile-state-card">
              <div className="profile-state-copy">
                <strong className="block">
                  {isActive ? ru.miniApp.profile.profileActive : ru.miniApp.profile.profileDisabled}
                </strong>
                {stateMessage ? <p className="mt-2 text-sm text-muted">{stateMessage}</p> : null}
              </div>
              <Button
                className="profile-state-action"
                type="button"
                variant={isActive ? 'danger' : 'secondary'}
                loading={setActive.isPending}
                onClick={() => {
                  const apply = () => {
                    setStateMessage('');
                    setActive.mutate(!isActive);
                  };
                  if (isActive) confirm(ru.miniApp.profile.disableProfileConfirm, apply);
                  else apply();
                }}
              >
                {isActive ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
                {isActive ? ru.miniApp.profile.disableProfile : ru.miniApp.profile.enableProfile}
              </Button>
            </div>
            {setActive.isError ? (
              <div className="error-box mt-3">
                {setActive.error instanceof ApiError &&
                setActive.error.code === 'PROFILE_REACTIVATION_BLOCKED'
                  ? ru.miniApp.profile.profileReactivationBlocked
                  : setActive.error.message}
              </div>
            ) : null}
          </Card>
          {media.data?.length ? (
            <section className="mt-5">
              <h2 className="font-display text-2xl">{ru.miniApp.profile.mediaTitle}</h2>
              <div className="mt-3 grid grid-cols-2 gap-3">
                {media.data.map((item) => (
                  <Card className="overflow-hidden" key={item.id}>
                    <ProfileMediaPreview item={item} />
                    <div className="flex items-center justify-between gap-2 p-3 text-xs">
                      <span className="status-pill">
                        {item.moderation_status === 'approved'
                          ? ru.miniApp.profile.mediaApproved
                          : item.moderation_status === 'rejected'
                            ? ru.miniApp.profile.mediaRejected
                            : ru.miniApp.profile.mediaPending}
                      </span>
                      <button
                        aria-label={ru.miniApp.profile.deleteMedia}
                        onClick={() => setMediaToDelete(item.id)}
                      >
                        <Trash2 className="h-4 w-4" />
                      </button>
                    </div>
                  </Card>
                ))}
              </div>
            </section>
          ) : null}
        </>
      ) : null}
      <ConfirmDialog
        open={Boolean(mediaToDelete)}
        title={ru.miniApp.profile.deleteMediaConfirmTitle}
        description={ru.miniApp.profile.deleteMediaConfirmDescription}
        confirmLabel={ru.miniApp.profile.deleteMedia}
        cancelLabel={ru.miniApp.profile.cancelMediaDeletion}
        loading={removeMedia.isPending}
        onCancel={() => setMediaToDelete(null)}
        onConfirm={() => {
          if (mediaToDelete) removeMedia.mutate(mediaToDelete);
        }}
      />
      <p className="mt-5 text-center text-xs text-muted">{ru.miniApp.attribution}</p>
      {dialog}
    </div>
  );
}

export function ProfileEditorPage() {
  const queryClient = useQueryClient();
  const [, navigate] = useLocation();
  const [languageDraft, setLanguageDraft] = useState('');
  const [mediaOrderSelecting, setMediaOrderSelecting] = useState(false);
  const [mediaOrderDraft, setMediaOrderDraft] = useState<string[]>([]);
  const [audioOrderSelecting, setAudioOrderSelecting] = useState(false);
  const [audioOrderDraft, setAudioOrderDraft] = useState<string[]>([]);
  const [questionnaireMediaToDelete, setQuestionnaireMediaToDelete] = useState<string | null>(null);
  const [telegramHandoffNotice, setTelegramHandoffNotice] = useState(false);
  const [validationNotice, setValidationNotice] = useState<{
    id: number;
    fields: string[];
    message?: string;
  } | null>(null);
  const questionnaireId =
    window.location.pathname.match(
      /^\/questionnaires\/([0-9a-f]{8}-[0-9a-f-]{27,})\/edit$/i,
    )?.[1] ?? null;
  const [questionnaireTitle, setQuestionnaireTitle] = useState('');
  const profile = useQuery({
    queryKey: questionnaireId ? ['questionnaire', questionnaireId] : ['profile'],
    queryFn: () => (questionnaireId ? api.questionnaire(questionnaireId) : api.profile()),
    retry: false,
  });
  const media = useQuery({
    queryKey: questionnaireId ? ['questionnaire-media', questionnaireId] : ['profile-media'],
    queryFn: () => (questionnaireId ? api.questionnaireMedia(questionnaireId) : api.profileMedia()),
    retry: false,
  });
  const form = useForm<ProfileInput>({
    resolver: zodResolver(profileSchema) as Resolver<ProfileInput>,
    defaultValues: defaults,
  });
  const resetForm = form.reset;
  const draftKey = `rolemate:questionnaire-draft:${questionnaireId ?? 'new'}`;
  const [draftSavedAt, setDraftSavedAt] = useState(0);
  useEffect(() => {
    if (profile.data) {
      resetForm(existingProfile(profile.data));
      if (questionnaireId && 'title' in profile.data) {
        setQuestionnaireTitle(String(profile.data.title));
      }
    }
  }, [profile.data, questionnaireId, resetForm]);
  // A half-filled questionnaire cannot be saved on the server without passing
  // validation, so leaving the editor used to throw the work away. The draft is
  // kept locally instead and restored the next time the editor opens.
  const draftRestored = useRef(false);
  const draftTimerRef = useRef(0);
  useEffect(() => {
    if (draftRestored.current) return;
    if (questionnaireId && !profile.data) return;
    draftRestored.current = true;
    try {
      const stored = window.localStorage.getItem(draftKey);
      if (!stored) return;
      const parsed = JSON.parse(stored) as { profile?: ProfileInput; title?: string };
      if (parsed.profile) resetForm(parsed.profile, { keepDefaultValues: true });
      if (parsed.title) setQuestionnaireTitle(parsed.title);
    } catch {
      window.localStorage.removeItem(draftKey);
    }
  }, [draftKey, profile.data, questionnaireId, resetForm]);
  const saveDraft = () => {
    try {
      window.localStorage.setItem(
        draftKey,
        JSON.stringify({ profile: form.getValues(), title: questionnaireTitle }),
      );
      setDraftSavedAt(Date.now());
    } catch {
      // A full or disabled storage quota must not block editing.
    }
  };
  // Autosave, because the work is usually lost by navigating away rather than by
  // pressing anything.
  useEffect(() => {
    if (!draftRestored.current) return;
    const subscription = form.watch(() => {
      window.clearTimeout(draftTimerRef.current);
      draftTimerRef.current = window.setTimeout(() => {
        if (!form.formState.isDirty) return;
        try {
          window.localStorage.setItem(
            draftKey,
            JSON.stringify({ profile: form.getValues(), title: questionnaireTitle }),
          );
        } catch {
          // See saveDraft: storage failures must not interrupt editing.
        }
      }, 800);
    });
    return () => {
      subscription.unsubscribe();
      window.clearTimeout(draftTimerRef.current);
    };
  }, [draftKey, form, questionnaireTitle]);
  const clearDraft = () => {
    try {
      window.localStorage.removeItem(draftKey);
    } catch {
      // Nothing to recover from: the draft is a convenience, not state we own.
    }
  };
  useEffect(() => {
    if (!validationNotice) return;
    const timeout = window.setTimeout(() => setValidationNotice(null), 6_000);
    return () => window.clearTimeout(timeout);
  }, [validationNotice]);
  useEffect(() => {
    if (!telegramHandoffNotice) return;
    const timeout = window.setTimeout(() => setTelegramHandoffNotice(false), 4_000);
    return () => window.clearTimeout(timeout);
  }, [telegramHandoffNotice]);
  const save = useMutation({
    mutationFn: async (submittedProfile: ProfileInput) => {
      if (questionnaireId) {
        await api.saveQuestionnaire(
          questionnaireId,
          questionnaireTitle.trim() || submittedProfile.shortHeadline,
          submittedProfile,
        );
      } else {
        await api.saveProfile(submittedProfile);
      }
    },
    onSuccess: (_result, submittedProfile) => {
      clearDraft();
      form.reset(submittedProfile);
      void queryClient.invalidateQueries({ queryKey: ['profile'] });
      void queryClient.invalidateQueries({ queryKey: ['questionnaires'] });
      if (questionnaireId) {
        void queryClient.invalidateQueries({ queryKey: ['questionnaire', questionnaireId] });
      }
      void queryClient.invalidateQueries({ queryKey: ['profile-preview'] });
      void queryClient.invalidateQueries({ queryKey: ['search'] });
      void queryClient.invalidateQueries({ queryKey: ['conversations'] });
    },
    onError: () => {
      setValidationNotice({
        id: Date.now(),
        fields: [],
        message: ru.miniApp.profile.publishRequestFailed,
      });
    },
  });
  const reorderMedia = useMutation({
    mutationFn: (mediaIds: string[]) =>
      questionnaireId
        ? api.reorderQuestionnaireMedia(questionnaireId, mediaIds)
        : api.reorderProfileMedia(mediaIds),
    onSuccess: () => {
      setMediaOrderSelecting(false);
      setMediaOrderDraft([]);
      void queryClient.invalidateQueries({
        queryKey: questionnaireId ? ['questionnaire-media', questionnaireId] : ['profile-media'],
      });
      void queryClient.invalidateQueries({ queryKey: ['profile-preview'] });
      void queryClient.invalidateQueries({ queryKey: ['search'] });
    },
  });
  const reorderAudio = useMutation({
    mutationFn: api.reorderProfileAudio,
    onSuccess: () => {
      setAudioOrderSelecting(false);
      setAudioOrderDraft([]);
      void queryClient.invalidateQueries({ queryKey: ['profile-media'] });
      void queryClient.invalidateQueries({ queryKey: ['public-profile-own'] });
      void queryClient.invalidateQueries({ queryKey: ['profile-preview'] });
    },
  });
  const removeQuestionnaireMedia = useMutation({
    mutationFn: (mediaId: string) => {
      if (!questionnaireId) throw new Error(ru.miniApp.profile.questionnaireMediaMissing);
      return api.deleteQuestionnaireMedia(questionnaireId, mediaId);
    },
    onSuccess: (_result, mediaId) => {
      setQuestionnaireMediaToDelete(null);
      setMediaOrderSelecting(false);
      setMediaOrderDraft([]);
      queryClient.setQueryData<ProfileMedia[]>(
        ['questionnaire-media', questionnaireId],
        (current) => current?.filter((item) => item.id !== mediaId),
      );
      void queryClient.invalidateQueries({ queryKey: ['questionnaire-media', questionnaireId] });
      void queryClient.invalidateQueries({ queryKey: ['questionnaire', questionnaireId] });
      void queryClient.invalidateQueries({ queryKey: ['profile-preview'] });
      void queryClient.invalidateQueries({ queryKey: ['search'] });
    },
  });
  const toggleMediaOrderItem = (mediaId: string) => {
    if (!mediaOrderSelecting) return;
    setMediaOrderDraft((current) =>
      current.includes(mediaId) ? current.filter((id) => id !== mediaId) : [...current, mediaId],
    );
  };
  const cancelEditing = () => {
    form.reset(profile.data ? existingProfile(profile.data) : defaults);
    setQuestionnaireTitle(
      questionnaireId && profile.data && 'title' in profile.data ? String(profile.data.title) : '',
    );
    setLanguageDraft('');
    setMediaOrderSelecting(false);
    setMediaOrderDraft([]);
    setAudioOrderSelecting(false);
    setAudioOrderDraft([]);
    save.reset();
    reorderMedia.reset();
    navigate('/profile');
  };
  const field = 'input-field';
  const selectedAgeGroup = form.watch('ageGroup');
  const profileAudio = questionnaireId
    ? []
    : (media.data ?? []).filter((item) => ['audio', 'voice'].includes(item.media_type));
  const orderedMedia = questionnaireId
    ? (media.data ?? [])
    : (media.data ?? []).filter((item) => !['audio', 'voice'].includes(item.media_type));
  const isMinor = selectedAgeGroup === 'under_16' || selectedAgeGroup === '16_17';
  const selectedLanguages = form.watch('languages');
  const languageLabels = new Map<string, string>(ru.miniApp.profile.languageOptions);
  const addLanguages = (rawValue: string) => {
    const candidates = commaList(rawValue);
    if (!candidates.length) return;
    const next = [...selectedLanguages];
    for (const candidate of candidates) {
      const option = ru.miniApp.profile.languageOptions.find(
        ([value, label]) =>
          value.toLocaleLowerCase() === candidate.toLocaleLowerCase() ||
          label.toLocaleLowerCase() === candidate.toLocaleLowerCase(),
      );
      const normalized = option?.[0] ?? candidate;
      if (!next.some((item) => item.toLocaleLowerCase() === normalized.toLocaleLowerCase())) {
        next.push(normalized);
      }
    }
    form.setValue('languages', next.slice(0, 8), {
      shouldDirty: true,
      shouldValidate: true,
    });
    setLanguageDraft('');
  };
  const activeHoursValue = form.watch('activeHours') ?? '';
  const [activeHoursCustom, setActiveHoursCustom] = useState(false);
  const activeHoursIsCustom =
    activeHoursCustom ||
    (activeHoursValue.length > 0 &&
      !ru.miniApp.profile.activeHoursOptions.some((option) => option === activeHoursValue));
  const languageQuery = languageDraft.trim().toLocaleLowerCase('ru-RU');
  const languageSuggestions = ru.miniApp.profile.languageOptions
    .filter(([value]) => !selectedLanguages.includes(value))
    .filter(([value, label]) =>
      languageQuery
        ? label.toLocaleLowerCase('ru-RU').includes(languageQuery) ||
          value.toLocaleLowerCase('ru-RU').includes(languageQuery)
        : true,
    )
    .slice(0, 24);
  useEffect(() => {
    if (isMinor) form.setValue('adultTopicsAllowed', false);
  }, [form, isMinor]);

  if (profile.isLoading) return <Skeleton className="h-96" />;

  return (
    <form
      className="profile-editor-form mx-auto max-w-2xl space-y-6"
      onSubmit={(event) => {
        void form.handleSubmit(
          (value) => {
            setValidationNotice(null);
            save.mutate(value);
          },
          (errors) => {
            setValidationNotice({
              id: Date.now(),
              fields: invalidProfileFieldLabels(errors),
            });
          },
        )(event);
      }}
    >
      {validationNotice ? (
        <div
          className="profile-validation-toast"
          role="alert"
          aria-live="assertive"
          data-testid="profile-validation-toast"
          key={validationNotice.id}
        >
          <strong>{ru.miniApp.profile.publishValidationTitle}</strong>
          <span>
            {validationNotice.message ??
              ru.miniApp.profile.publishValidationFields(validationNotice.fields)}
          </span>
        </div>
      ) : null}
      {telegramHandoffNotice ? (
        <div className="profile-validation-toast" role="alert" aria-live="assertive">
          <strong>{ru.miniApp.profile.telegramHandoffTitle}</strong>
          <span>{ru.miniApp.profile.telegramHandoffNotice}</span>
        </div>
      ) : null}
      <div>
        <p className="eyebrow">{ru.miniApp.profile.editorStep}</p>
        <h1 className="font-display text-4xl font-semibold">{ru.miniApp.profile.editorTitle}</h1>
        <p className="mt-2 text-sm text-muted">{ru.miniApp.profile.privacyNotice}</p>
      </div>
      <Card className="space-y-5 p-5">
        {questionnaireId ? (
          <label>
            <span>{ru.miniApp.social.titlePrompt}</span>
            <input
              className={field}
              minLength={2}
              maxLength={80}
              value={questionnaireTitle}
              onChange={(event) => setQuestionnaireTitle(event.target.value)}
            />
          </label>
        ) : null}
        <label>
          <span>{ru.miniApp.profile.alias}</span>
          <input
            className={field}
            placeholder={ru.miniApp.profile.aliasPlaceholder}
            {...form.register('displayName')}
          />
          <small>{validationMessage(form.formState.errors.displayName?.message)}</small>
        </label>
        <label>
          <span>{ru.miniApp.profile.headline}</span>
          <input
            className={field}
            placeholder={ru.miniApp.profile.headlinePlaceholder}
            {...form.register('shortHeadline')}
          />
          <small>{validationMessage(form.formState.errors.shortHeadline?.message)}</small>
        </label>
        <label>
          <span>{ru.miniApp.profile.about}</span>
          <textarea
            className={`${field} min-h-36`}
            placeholder={ru.miniApp.profile.aboutPlaceholder}
            {...form.register('about')}
          />
          <small>{validationMessage(form.formState.errors.about?.message)}</small>
        </label>
        <div>
          <strong className="text-sm">{ru.miniApp.profile.markdownPreview}</strong>
          <ProfileMarkdown
            className="mt-2 rounded-xl border border-white/10 p-3 text-sm text-soft"
            allowLinks={false}
          >
            {form.watch('about') || ru.miniApp.profile.markdownPreviewEmpty}
          </ProfileMarkdown>
          <p className="mt-2 text-xs text-muted">{ru.miniApp.profile.markdownHint}</p>
        </div>
        <label>
          <span>{ru.miniApp.profile.ageGroup}</span>
          <select className={field} {...form.register('ageGroup')}>
            <option value="under_16">{ru.miniApp.profile.ageOptions[0]}</option>
            <option value="16_17">{ru.miniApp.profile.ageOptions[1]}</option>
            <option value="18_20">{ru.miniApp.profile.ageOptions[2]}</option>
            <option value="21_25">{ru.miniApp.profile.ageOptions[3]}</option>
            <option value="26_plus">{ru.miniApp.profile.ageOptions[4]}</option>
          </select>
        </label>
        <label>
          <span>{ru.miniApp.profile.gender}</span>
          <select className={field} {...form.register('gender')}>
            <option value="not_specified">{ru.miniApp.profile.genderOptions[0]}</option>
            <option value="female">{ru.miniApp.profile.genderOptions[1]}</option>
            <option value="male">{ru.miniApp.profile.genderOptions[2]}</option>
            <option value="nonbinary">{ru.miniApp.profile.genderOptions[3]}</option>
          </select>
        </label>
      </Card>
      <Card className="space-y-5 p-5">
        <h2 className="font-display text-2xl">{ru.miniApp.profile.creativeRhythm}</h2>
        <label>
          <span>{ru.miniApp.profile.roleplayExperience}</span>
          <select className={field} {...form.register('roleplayExperience')}>
            <option value="beginner">{ru.miniApp.profile.experienceOptions[0]}</option>
            <option value="under_year">{ru.miniApp.profile.experienceOptions[1]}</option>
            <option value="1_3_years">{ru.miniApp.profile.experienceOptions[2]}</option>
            <option value="3_5_years">{ru.miniApp.profile.experienceOptions[3]}</option>
            <option value="over_5_years">{ru.miniApp.profile.experienceOptions[4]}</option>
            <option value="not_specified">{ru.miniApp.profile.experienceOptions[5]}</option>
          </select>
        </label>
        <label>
          <span>{ru.miniApp.profile.preferredRole}</span>
          <input
            className={field}
            value={form.watch('preferredRole').join(', ')}
            onChange={(event) => form.setValue('preferredRole', commaList(event.target.value))}
          />
          <small>{validationMessage(form.formState.errors.preferredRole?.message)}</small>
        </label>
        <label>
          <span>{ru.miniApp.profile.writingStyle}</span>
          <select className={field} {...form.register('writingStyle')}>
            <option value="literary">{ru.miniApp.profile.writingStyleOptions[0]}</option>
            <option value="short_dynamic">{ru.miniApp.profile.writingStyleOptions[1]}</option>
            <option value="mixed">{ru.miniApp.profile.writingStyleOptions[2]}</option>
            <option value="coauthoring">{ru.miniApp.profile.writingStyleOptions[3]}</option>
            <option value="game_elements">{ru.miniApp.profile.writingStyleOptions[4]}</option>
            <option value="negotiable">{ru.miniApp.profile.writingStyleOptions[5]}</option>
          </select>
        </label>
        <label>
          <span>{ru.miniApp.profile.postLength}</span>
          <select className={field} {...form.register('averagePostLength')}>
            <option value="lines_1_3">{ru.miniApp.profile.postLengthOptions[0]}</option>
            <option value="paragraphs_1_2">{ru.miniApp.profile.postLengthOptions[1]}</option>
            <option value="paragraphs_3_5">{ru.miniApp.profile.postLengthOptions[2]}</option>
            <option value="long_literary">{ru.miniApp.profile.postLengthOptions[3]}</option>
            <option value="scene_dependent">{ru.miniApp.profile.postLengthOptions[4]}</option>
          </select>
        </label>
        <label>
          <span>{ru.miniApp.profile.responseFrequency}</span>
          <select className={field} {...form.register('activityFrequency')}>
            <option value="several_hourly">{ru.miniApp.profile.frequencyOptions[0]}</option>
            <option value="several_daily">{ru.miniApp.profile.frequencyOptions[1]}</option>
            <option value="daily">{ru.miniApp.profile.frequencyOptions[2]}</option>
            <option value="several_weekly">{ru.miniApp.profile.frequencyOptions[3]}</option>
            <option value="flexible">{ru.miniApp.profile.frequencyOptions[4]}</option>
          </select>
        </label>
      </Card>
      <Card className="space-y-5 p-5">
        <h2 className="font-display text-2xl">{ru.miniApp.profile.worldsAndPlots}</h2>
        <label>
          <span>{ru.miniApp.profile.languages}</span>
          <div className="tag-input">
            <div className="tag-input-values">
              {selectedLanguages.map((language) => (
                <span className="tag tag-removable" key={language}>
                  {languageLabels.get(language) ?? language}
                  <button
                    type="button"
                    aria-label={ru.miniApp.profile.removeLanguage(
                      languageLabels.get(language) ?? language,
                    )}
                    onClick={() =>
                      form.setValue(
                        'languages',
                        selectedLanguages.filter((item) => item !== language),
                        { shouldDirty: true, shouldValidate: true },
                      )
                    }
                  >
                    <X className="h-3 w-3" />
                  </button>
                </span>
              ))}
            </div>
            <input
              className="tag-input-control"
              value={languageDraft}
              placeholder={ru.miniApp.profile.languageInputPlaceholder}
              onChange={(event) => {
                const value = event.target.value;
                if (value.includes(',')) addLanguages(value);
                else setLanguageDraft(value);
              }}
              onBlur={() => addLanguages(languageDraft)}
              onKeyDown={(event) => {
                if (event.key !== 'Enter' && event.key !== ',') return;
                event.preventDefault();
                addLanguages(languageDraft);
              }}
            />
          </div>
          {languageSuggestions.length ? (
            <SuggestionRail>
              {languageSuggestions.map(([value, label]) => (
                <button key={value} type="button" onClick={() => addLanguages(value)}>
                  + {label}
                </button>
              ))}
            </SuggestionRail>
          ) : null}
          <p className="mt-2 text-xs text-muted">{ru.miniApp.profile.languageInputHint}</p>
          <small>{validationMessage(form.formState.errors.languages?.message)}</small>
        </label>
        <label>
          <span>{ru.miniApp.profile.timezone}</span>
          <TimezoneSelect
            value={form.watch('timezone')}
            options={ru.miniApp.profile.timezoneOptions}
            onChange={(value) =>
              form.setValue('timezone', value, { shouldDirty: true, shouldValidate: true })
            }
          />
          <small>{validationMessage(form.formState.errors.timezone?.message)}</small>
        </label>
        <label>
          <span>{ru.miniApp.profile.activeHours}</span>
          <select
            className={field}
            value={activeHoursIsCustom ? '__custom__' : activeHoursValue}
            onChange={(event) => {
              const next = event.target.value;
              if (next === '__custom__') {
                setActiveHoursCustom(true);
                return;
              }
              setActiveHoursCustom(false);
              form.setValue('activeHours', next, { shouldDirty: true, shouldValidate: true });
            }}
          >
            {ru.miniApp.profile.activeHoursOptions.map((option) => (
              <option key={option} value={option}>
                {option}
              </option>
            ))}
            <option value="__custom__">{ru.miniApp.profile.activeHoursCustom}</option>
          </select>
          {activeHoursIsCustom ? (
            <input
              className={`${field} mt-2`}
              placeholder={ru.miniApp.profile.activeHoursCustomPlaceholder}
              {...form.register('activeHours')}
            />
          ) : null}
        </label>
        <label>
          <span>{ru.miniApp.profile.fandoms}</span>
          <CommaTagInput
            label={ru.miniApp.profile.fandoms}
            placeholder={ru.miniApp.profile.fandomsPlaceholder}
            value={form.watch('fandoms')}
            maxItems={20}
            suggestionKind="fandom"
            onChange={(value) =>
              form.setValue('fandoms', value, { shouldDirty: true, shouldValidate: true })
            }
          />
          <small>{validationMessage(form.formState.errors.fandoms?.message)}</small>
        </label>
        <label>
          <span>{ru.miniApp.profile.genres}</span>
          <CommaTagInput
            label={ru.miniApp.profile.genres}
            placeholder={ru.miniApp.profile.genresPlaceholder}
            value={form.watch('genres')}
            maxItems={16}
            suggestionKind="genre"
            onChange={(value) =>
              form.setValue('genres', value, { shouldDirty: true, shouldValidate: true })
            }
          />
          <small>{validationMessage(form.formState.errors.genres?.message)}</small>
        </label>
        <label>
          <span>{ru.miniApp.profile.tags}</span>
          <CommaTagInput
            label={ru.miniApp.profile.tags}
            placeholder={ru.miniApp.profile.tagsPlaceholder}
            value={form.watch('tags')}
            maxItems={20}
            suggestionKind="tag"
            onChange={(value) =>
              form.setValue('tags', value, { shouldDirty: true, shouldValidate: true })
            }
          />
          <small className="text-muted">{ru.miniApp.profile.tagsHint}</small>
          <small>{validationMessage(form.formState.errors.tags?.message)}</small>
        </label>
        <label>
          <span>{ru.miniApp.profile.ideas}</span>
          <SuggestionTextarea
            label={ru.miniApp.profile.ideas}
            value={form.watch('plots')}
            kind="plot"
            className={`${field} min-h-28`}
            onChange={(value) =>
              form.setValue('plots', value, { shouldDirty: true, shouldValidate: true })
            }
          />
        </label>
        <label>
          <span>{ru.miniApp.profile.settingsField}</span>
          <SuggestionTextarea
            label={ru.miniApp.profile.settingsField}
            value={form.watch('settings')}
            kind="setting"
            className={`${field} min-h-24`}
            onChange={(value) =>
              form.setValue('settings', value, { shouldDirty: true, shouldValidate: true })
            }
          />
        </label>
        <label>
          <span>{ru.miniApp.profile.lookingFor}</span>
          <CommaTagInput
            label={ru.miniApp.profile.lookingFor}
            placeholder={ru.miniApp.profile.lookingForPlaceholder}
            value={form.watch('lookingFor')}
            maxItems={8}
            suggestionKind="looking_for"
            onChange={(value) =>
              form.setValue('lookingFor', value, { shouldDirty: true, shouldValidate: true })
            }
          />
          <small>{validationMessage(form.formState.errors.lookingFor?.message)}</small>
        </label>
        <label>
          <span>{ru.miniApp.profile.boundaries}</span>
          <SuggestionTextarea
            label={ru.miniApp.profile.boundaries}
            value={form.watch('boundaries')}
            kind="boundary"
            className={`${field} min-h-28`}
            onChange={(value) =>
              form.setValue('boundaries', value, { shouldDirty: true, shouldValidate: true })
            }
          />
          <small>{validationMessage(form.formState.errors.boundaries?.message)}</small>
        </label>
        <label className="setting-row adult-topics-row">
          <input type="checkbox" disabled={isMinor} {...form.register('adultTopicsAllowed')} />
          <span>{ru.miniApp.profile.adultTopics}</span>
        </label>
        <small>{validationMessage(form.formState.errors.adultTopicsAllowed?.message)}</small>
      </Card>
      <Card className="profile-media-upload-card p-5">
        <div className="rounded-2xl bg-violet-500/10 p-3 text-lilac">
          <ImagePlus />
        </div>
        <div className="profile-media-upload-copy">
          <strong>{ru.miniApp.profile.images}</strong>
          <p className="text-sm text-muted">{ru.miniApp.profile.imagesDescription}</p>
        </div>
        <Button
          type="button"
          variant="secondary"
          onClick={() => {
            setTelegramHandoffNotice(true);
            const parameter = questionnaireId
              ? `questionnaire_media_${questionnaireId}`
              : 'profile_photo';
            const link = `https://t.me/r0lemate_bot?start=${parameter}`;
            const telegram = getTelegram();
            if (telegram) telegram.openTelegramLink(link);
            else window.open(link, '_blank', 'noopener,noreferrer');
          }}
        >
          {ru.miniApp.profile.addInBot}
        </Button>
      </Card>
      {!questionnaireId ? (
        <Card className="profile-media-upload-card p-5">
          <div className="rounded-2xl bg-violet-500/10 p-3 text-lilac">
            <Music2 />
          </div>
          <div className="profile-media-upload-copy">
            <strong>{ru.miniApp.profile.profileMusic}</strong>
            <p className="text-sm text-muted">{ru.miniApp.profile.profileMusicDescription}</p>
          </div>
          <Button
            type="button"
            variant="secondary"
            onClick={() => {
              setTelegramHandoffNotice(true);
              const link = 'https://t.me/r0lemate_bot?start=profile_music';
              const telegram = getTelegram();
              if (telegram) telegram.openTelegramLink(link);
              else window.open(link, '_blank', 'noopener,noreferrer');
            }}
          >
            {ru.miniApp.profile.addMusicInBot}
          </Button>
        </Card>
      ) : null}
      {profileAudio.length > 1 ? (
        <Card className="space-y-4 p-5" data-testid="profile-audio-order">
          <div>
            <strong>{ru.miniApp.profile.audioOrderTitle}</strong>
            <p className="mt-1 text-sm text-muted">{ru.miniApp.profile.audioOrderDescription}</p>
            {audioOrderSelecting ? (
              <p className="mt-2 text-xs text-lilac">
                {ru.miniApp.profile.mediaOrderProgress(audioOrderDraft.length, profileAudio.length)}
              </p>
            ) : null}
          </div>
          <div className="profile-media-picker">
            {profileAudio.map((item, index) => (
              <button
                className={audioOrderDraft.includes(item.id) ? 'is-selected' : ''}
                type="button"
                key={item.id}
                data-testid={`profile-audio-order-item-${item.id}`}
                disabled={!audioOrderSelecting || reorderAudio.isPending}
                aria-label={ru.miniApp.profile.selectMediaOrder(
                  item.track_title || `${ru.miniApp.profile.trackTitle} ${index + 1}`,
                  audioOrderDraft.indexOf(item.id) + 1,
                )}
                onClick={() =>
                  setAudioOrderDraft((current) =>
                    current.includes(item.id)
                      ? current.filter((mediaId) => mediaId !== item.id)
                      : [...current, item.id],
                  )
                }
              >
                <ProfileMediaPickerPreview item={item} />
                {audioOrderDraft.includes(item.id) ? (
                  <span className="profile-media-picker-number">
                    {audioOrderDraft.indexOf(item.id) + 1}
                  </span>
                ) : null}
              </button>
            ))}
          </div>
          {!audioOrderSelecting ? (
            <Button
              type="button"
              data-testid="profile-audio-order-start"
              variant="secondary"
              onClick={() => {
                setAudioOrderDraft([]);
                setAudioOrderSelecting(true);
                reorderAudio.reset();
              }}
            >
              {ru.miniApp.profile.startAudioOrder}
            </Button>
          ) : (
            <div className="flex flex-wrap gap-2">
              <Button
                type="button"
                data-testid="profile-audio-order-save"
                loading={reorderAudio.isPending}
                disabled={audioOrderDraft.length !== profileAudio.length}
                onClick={() => reorderAudio.mutate(audioOrderDraft)}
              >
                <Check className="h-4 w-4" /> {ru.miniApp.profile.saveAudioOrder}
              </Button>
              <Button
                type="button"
                variant="secondary"
                onClick={() => {
                  setAudioOrderSelecting(false);
                  setAudioOrderDraft([]);
                  reorderAudio.reset();
                }}
              >
                <X className="h-4 w-4" /> {ru.miniApp.profile.cancelEditing}
              </Button>
            </div>
          )}
          {reorderAudio.isSuccess ? (
            <p className="text-sm text-lilac">{ru.miniApp.profile.audioOrderSaved}</p>
          ) : null}
          {reorderAudio.isError ? (
            <div className="error-box">{reorderAudio.error.message}</div>
          ) : null}
        </Card>
      ) : null}
      {orderedMedia.length > 0 ? (
        <Card className="space-y-4 p-5">
          <div>
            <strong>{ru.miniApp.profile.mediaOrderTitle}</strong>
            <p className="mt-1 text-sm text-muted">{ru.miniApp.profile.mediaOrderDescription}</p>
            {mediaOrderSelecting ? (
              <p className="mt-2 text-xs text-lilac">
                {ru.miniApp.profile.mediaOrderProgress(mediaOrderDraft.length, orderedMedia.length)}
              </p>
            ) : null}
          </div>
          <div className="profile-media-picker">
            {orderedMedia.map((item, index) => (
              <div className="profile-media-picker-item" key={item.id}>
                <button
                  className={mediaOrderDraft.includes(item.id) ? 'is-selected' : ''}
                  type="button"
                  disabled={!mediaOrderSelecting || reorderMedia.isPending}
                  aria-label={ru.miniApp.profile.selectMediaOrder(
                    item.track_title || `${ru.miniApp.profile.mediaTitle} ${index + 1}`,
                    mediaOrderDraft.indexOf(item.id) + 1,
                  )}
                  onClick={() => toggleMediaOrderItem(item.id)}
                >
                  <ProfileMediaPickerPreview item={item} />
                  {mediaOrderDraft.includes(item.id) ? (
                    <span className="profile-media-picker-number">
                      {mediaOrderDraft.indexOf(item.id) + 1}
                    </span>
                  ) : null}
                </button>
                {questionnaireId && !mediaOrderSelecting ? (
                  <button
                    className="profile-media-picker-delete"
                    type="button"
                    aria-label={ru.miniApp.profile.deleteQuestionnaireMediaItem(
                      item.track_title || `${ru.miniApp.profile.mediaTitle} ${index + 1}`,
                    )}
                    title={ru.miniApp.profile.deleteQuestionnaireMedia}
                    onClick={() => setQuestionnaireMediaToDelete(item.id)}
                  >
                    <Trash2 className="h-4 w-4" />
                  </button>
                ) : null}
              </div>
            ))}
          </div>
          <div className="flex flex-wrap gap-2">
            {!mediaOrderSelecting ? (
              <Button
                type="button"
                variant="secondary"
                onClick={() => {
                  setMediaOrderDraft([]);
                  setMediaOrderSelecting(true);
                  reorderMedia.reset();
                }}
              >
                {ru.miniApp.profile.startMediaOrder}
              </Button>
            ) : (
              <>
                <Button
                  type="button"
                  loading={reorderMedia.isPending}
                  disabled={mediaOrderDraft.length !== orderedMedia.length}
                  onClick={() => reorderMedia.mutate(mediaOrderDraft)}
                >
                  <Check className="h-4 w-4" /> {ru.miniApp.profile.saveMediaOrder}
                </Button>
                <Button
                  type="button"
                  variant="secondary"
                  onClick={() => {
                    setMediaOrderSelecting(false);
                    setMediaOrderDraft([]);
                    reorderMedia.reset();
                  }}
                >
                  <X className="h-4 w-4" /> {ru.miniApp.profile.cancelEditing}
                </Button>
              </>
            )}
          </div>
          {reorderMedia.isSuccess ? (
            <p className="text-sm text-lilac">{ru.miniApp.profile.mediaOrderSaved}</p>
          ) : null}
          {reorderMedia.isError ? (
            <div className="error-box">{reorderMedia.error.message}</div>
          ) : null}
        </Card>
      ) : null}
      <ConfirmDialog
        open={Boolean(questionnaireMediaToDelete)}
        title={ru.miniApp.profile.deleteQuestionnaireMediaConfirmTitle}
        description={ru.miniApp.profile.deleteQuestionnaireMediaConfirmDescription}
        confirmLabel={ru.miniApp.profile.deleteQuestionnaireMedia}
        cancelLabel={ru.miniApp.profile.cancelMediaDeletion}
        loading={removeQuestionnaireMedia.isPending}
        onCancel={() => setQuestionnaireMediaToDelete(null)}
        onConfirm={() => {
          if (questionnaireMediaToDelete) {
            removeQuestionnaireMedia.mutate(questionnaireMediaToDelete);
          }
        }}
      />
      {removeQuestionnaireMedia.isError ? (
        <div className="error-box">{removeQuestionnaireMedia.error.message}</div>
      ) : null}
      {save.isError ? (
        <div className="error-box">
          <p>{save.error.message}</p>
          {save.error instanceof ApiError && save.error.code === 'PREMIUM_REQUIRED' ? (
            <a className="mt-2 inline-block underline" href="/premium">
              {ru.miniApp.search.openPremium}
            </a>
          ) : null}
        </div>
      ) : null}
      <div className="sticky-submit">
        <div className="grid gap-2 sm:grid-cols-[minmax(0,1fr)_auto]">
          <Button
            type="submit"
            className={`w-full ${
              save.isSuccess && !form.formState.isDirty ? 'profile-publish-success' : ''
            }`}
            loading={save.isPending}
            aria-live="polite"
          >
            <Check className="h-4 w-4" />
            {save.isSuccess && !form.formState.isDirty
              ? ru.miniApp.profile.published
              : ru.miniApp.profile.submit}
            {save.isSuccess && !form.formState.isDirty ? null : <ArrowRight className="h-4 w-4" />}
          </Button>
          <Button type="button" variant="secondary" onClick={cancelEditing}>
            <X className="h-4 w-4" /> {ru.miniApp.profile.cancelEditing}
          </Button>
        </div>
        <button type="button" className="questionnaire-draft-button" onClick={saveDraft}>
          {draftSavedAt ? ru.miniApp.profile.draftSaved : ru.miniApp.profile.saveDraft}
        </button>
      </div>
    </form>
  );
}
