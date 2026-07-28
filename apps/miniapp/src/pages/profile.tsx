import { zodResolver } from '@hookform/resolvers/zod';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import {
  ArrowRight,
  Check,
  Edit3,
  Eye,
  EyeOff,
  ImagePlus,
  Trash2,
  UserRound,
  X,
} from 'lucide-react';
import { useEffect, useState } from 'react';
import { useForm, type Resolver } from 'react-hook-form';
import { Link, useLocation } from 'wouter';
import { profileSchema, ru, type ProfileInput } from '@rolemate/shared';
import { ApiError, api } from '../api.js';
import type { ProfileMedia } from '../api.js';
import { ProfileMarkdown } from '../components/markdown.js';
import { Button, Card, EmptyState, SectionTitle, Skeleton } from '../components/ui.js';
import { getTelegram } from '../telegram.js';

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

export function ProfilePage() {
  const queryClient = useQueryClient();
  const [stateMessage, setStateMessage] = useState('');
  const profile = useQuery({ queryKey: ['profile'], queryFn: api.profile, retry: false });
  const media = useQuery({ queryKey: ['profile-media'], queryFn: api.profileMedia, retry: false });
  const removeMedia = useMutation({
    mutationFn: api.deleteProfileMedia,
    onSuccess: () => void queryClient.invalidateQueries({ queryKey: ['profile-media'] }),
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
  return (
    <div>
      <SectionTitle
        eyebrow={ru.miniApp.profile.eyebrow}
        action={
          <Link href="/profile/edit" className="button button-secondary">
            <Edit3 className="h-4 w-4" /> {ru.miniApp.profile.edit}
          </Link>
        }
      >
        {String(data.display_name)}
      </SectionTitle>
      <Card className="overflow-hidden">
        <div className="profile-cover min-h-52" />
        <div className="p-6">
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
        <div className="flex flex-wrap items-center justify-between gap-4">
          <div className="min-w-0 flex-1">
            <strong className="block">
              {isActive ? ru.miniApp.profile.profileActive : ru.miniApp.profile.profileDisabled}
            </strong>
            {stateMessage ? <p className="mt-2 text-sm text-muted">{stateMessage}</p> : null}
          </div>
          <Button
            type="button"
            variant={isActive ? 'danger' : 'secondary'}
            loading={setActive.isPending}
            onClick={() => {
              if (isActive && !window.confirm(ru.miniApp.profile.disableProfileConfirm)) return;
              setStateMessage('');
              setActive.mutate(!isActive);
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
                    onClick={() => removeMedia.mutate(item.id)}
                  >
                    <Trash2 className="h-4 w-4" />
                  </button>
                </div>
              </Card>
            ))}
          </div>
        </section>
      ) : null}
      <p className="mt-5 text-center text-xs text-muted">{ru.miniApp.attribution}</p>
    </div>
  );
}

export function ProfileEditorPage() {
  const [, navigate] = useLocation();
  const [languageDraft, setLanguageDraft] = useState('');
  const profile = useQuery({ queryKey: ['profile'], queryFn: api.profile, retry: false });
  const form = useForm<ProfileInput>({
    resolver: zodResolver(profileSchema) as Resolver<ProfileInput>,
    defaultValues: defaults,
  });
  const resetForm = form.reset;
  useEffect(() => {
    if (profile.data) resetForm(existingProfile(profile.data));
  }, [profile.data, resetForm]);
  const save = useMutation({
    mutationFn: api.saveProfile,
    onSuccess: () => void navigate('/profile'),
  });
  const field = 'input-field';
  const selectedAgeGroup = form.watch('ageGroup');
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
  useEffect(() => {
    if (isMinor) form.setValue('adultTopicsAllowed', false);
  }, [form, isMinor]);

  return (
    <form
      className="mx-auto max-w-2xl space-y-6"
      onSubmit={(event) => {
        void form.handleSubmit((value) => save.mutate(value))(event);
      }}
    >
      <div>
        <p className="eyebrow">{ru.miniApp.profile.editorStep}</p>
        <h1 className="font-display text-4xl font-semibold">{ru.miniApp.profile.editorTitle}</h1>
        <p className="mt-2 text-sm text-muted">{ru.miniApp.profile.privacyNotice}</p>
      </div>
      <Card className="space-y-5 p-5">
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
              list="profile-language-options"
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
            <datalist id="profile-language-options">
              {ru.miniApp.profile.languageOptions
                .filter(([value]) => !selectedLanguages.includes(value))
                .map(([value, label]) => (
                  <option key={value} value={label} />
                ))}
            </datalist>
          </div>
          <p className="mt-2 text-xs text-muted">{ru.miniApp.profile.languageInputHint}</p>
          <small>{validationMessage(form.formState.errors.languages?.message)}</small>
        </label>
        <label>
          <span>{ru.miniApp.profile.timezone}</span>
          <select className={field} {...form.register('timezone')}>
            {ru.miniApp.profile.timezoneOptions.map(([value, label]) => (
              <option key={value} value={value}>
                {label}
              </option>
            ))}
          </select>
          <small>{validationMessage(form.formState.errors.timezone?.message)}</small>
        </label>
        <label>
          <span>{ru.miniApp.profile.activeHours}</span>
          <input className={field} {...form.register('activeHours')} />
        </label>
        <label>
          <span>{ru.miniApp.profile.fandoms}</span>
          <input
            className={field}
            placeholder={ru.miniApp.profile.fandomsPlaceholder}
            value={form.watch('fandoms').join(', ')}
            onChange={(event) => form.setValue('fandoms', commaList(event.target.value))}
          />
          <small>{validationMessage(form.formState.errors.fandoms?.message)}</small>
        </label>
        <label>
          <span>{ru.miniApp.profile.genres}</span>
          <input
            className={field}
            placeholder={ru.miniApp.profile.genresPlaceholder}
            value={form.watch('genres').join(', ')}
            onChange={(event) => form.setValue('genres', commaList(event.target.value))}
          />
          <small>{validationMessage(form.formState.errors.genres?.message)}</small>
        </label>
        <label>
          <span>{ru.miniApp.profile.tags}</span>
          <input
            className={field}
            placeholder={ru.miniApp.profile.tagsPlaceholder}
            value={form.watch('tags').join(', ')}
            onChange={(event) =>
              form.setValue('tags', commaList(event.target.value), {
                shouldDirty: true,
                shouldValidate: true,
              })
            }
          />
          <small className="text-muted">{ru.miniApp.profile.tagsHint}</small>
          <small>{validationMessage(form.formState.errors.tags?.message)}</small>
        </label>
        <label>
          <span>{ru.miniApp.profile.ideas}</span>
          <textarea className={`${field} min-h-28`} {...form.register('plots')} />
        </label>
        <label>
          <span>{ru.miniApp.profile.settingsField}</span>
          <textarea className={`${field} min-h-24`} {...form.register('settings')} />
        </label>
        <label>
          <span>{ru.miniApp.profile.lookingFor}</span>
          <input
            className={field}
            value={form.watch('lookingFor').join(', ')}
            onChange={(event) => form.setValue('lookingFor', commaList(event.target.value))}
          />
          <small>{validationMessage(form.formState.errors.lookingFor?.message)}</small>
        </label>
        <label>
          <span>{ru.miniApp.profile.boundaries}</span>
          <textarea className={`${field} min-h-28`} {...form.register('boundaries')} />
          <small>{validationMessage(form.formState.errors.boundaries?.message)}</small>
        </label>
        <label className="setting-row">
          <span>{ru.miniApp.profile.adultTopics}</span>
          <input type="checkbox" disabled={isMinor} {...form.register('adultTopicsAllowed')} />
        </label>
        <small>{validationMessage(form.formState.errors.adultTopicsAllowed?.message)}</small>
        <label>
          <span>{ru.miniApp.profile.contactPolicy}</span>
          <select className={field} {...form.register('contactRevealPolicy')}>
            <option value="mutual_only">{ru.miniApp.profile.contactMutual}</option>
            <option value="disabled">{ru.miniApp.profile.contactDisabled}</option>
          </select>
        </label>
      </Card>
      <Card className="flex items-center gap-4 p-5">
        <div className="rounded-2xl bg-violet-500/10 p-3 text-lilac">
          <ImagePlus />
        </div>
        <div className="flex-1">
          <strong>{ru.miniApp.profile.images}</strong>
          <p className="text-sm text-muted">{ru.miniApp.profile.imagesDescription}</p>
        </div>
        <Button
          type="button"
          variant="secondary"
          onClick={() => {
            const link = 'https://t.me/r0lemate_bot?start=profile_photo';
            const telegram = getTelegram();
            if (telegram) telegram.openTelegramLink(link);
            else window.open(link, '_blank', 'noopener,noreferrer');
          }}
        >
          {ru.miniApp.profile.addInBot}
        </Button>
      </Card>
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
        <Button type="submit" className="w-full" loading={save.isPending}>
          <Check className="h-4 w-4" /> {ru.miniApp.profile.submit}{' '}
          <ArrowRight className="h-4 w-4" />
        </Button>
      </div>
    </form>
  );
}
