import { zodResolver } from '@hookform/resolvers/zod';
import { useMutation, useQuery } from '@tanstack/react-query';
import { ArrowRight, Check, Edit3, ImagePlus, UserRound } from 'lucide-react';
import { useForm } from 'react-hook-form';
import { Link, useLocation } from 'wouter';
import { profileSchema, ru, type ProfileInput } from '@rolemate/shared';
import { api } from '../api.js';
import { Button, Card, EmptyState, SectionTitle, Skeleton } from '../components/ui.js';

const defaults: ProfileInput = {
  displayName: '',
  ageGroup: '18_20',
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

export function ProfilePage() {
  const profile = useQuery({ queryKey: ['profile'], queryFn: api.profile, retry: false });
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
          <span className="status-pill">{String(data.moderation_status)}</span>
          <h2 className="mt-3 font-display text-3xl">{String(data.short_headline)}</h2>
          <p className="mt-4 whitespace-pre-wrap text-sm leading-relaxed text-soft">
            {String(data.about)}
          </p>
          <div className="mt-5 flex flex-wrap gap-2">
            {[...stringList(data.fandoms), ...stringList(data.genres)].map((tag) => (
              <span className="tag" key={tag}>
                {tag}
              </span>
            ))}
          </div>
        </div>
      </Card>
      <p className="mt-5 text-center text-xs text-muted">{ru.miniApp.attribution}</p>
    </div>
  );
}

export function ProfileEditorPage() {
  const [, navigate] = useLocation();
  const form = useForm<ProfileInput>({
    resolver: zodResolver(profileSchema),
    defaultValues: defaults,
  });
  const save = useMutation({
    mutationFn: api.saveProfile,
    onSuccess: () => void navigate('/profile'),
  });
  const field = 'input-field';

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
          <small>{form.formState.errors.displayName?.message}</small>
        </label>
        <label>
          <span>{ru.miniApp.profile.headline}</span>
          <input
            className={field}
            placeholder={ru.miniApp.profile.headlinePlaceholder}
            {...form.register('shortHeadline')}
          />
          <small>{form.formState.errors.shortHeadline?.message}</small>
        </label>
        <label>
          <span>{ru.miniApp.profile.about}</span>
          <textarea
            className={`${field} min-h-36`}
            placeholder={ru.miniApp.profile.aboutPlaceholder}
            {...form.register('about')}
          />
          <small>{form.formState.errors.about?.message}</small>
        </label>
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
      </Card>
      <Card className="space-y-5 p-5">
        <h2 className="font-display text-2xl">{ru.miniApp.profile.creativeRhythm}</h2>
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
          <span>{ru.miniApp.profile.fandoms}</span>
          <input
            className={field}
            placeholder="Arcane, Cyberpunk 2077"
            onChange={(event) =>
              form.setValue(
                'fandoms',
                event.target.value
                  .split(',')
                  .map((v) => v.trim())
                  .filter(Boolean),
              )
            }
          />
        </label>
        <label>
          <span>{ru.miniApp.profile.genres}</span>
          <input
            className={field}
            placeholder={ru.miniApp.profile.genresPlaceholder}
            onChange={(event) =>
              form.setValue(
                'genres',
                event.target.value
                  .split(',')
                  .map((v) => v.trim())
                  .filter(Boolean),
              )
            }
          />
        </label>
        <label>
          <span>{ru.miniApp.profile.ideas}</span>
          <textarea className={`${field} min-h-28`} {...form.register('plots')} />
        </label>
        <label>
          <span>{ru.miniApp.profile.boundaries}</span>
          <textarea className={`${field} min-h-28`} {...form.register('boundaries')} />
          <small>{form.formState.errors.boundaries?.message}</small>
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
        <Button type="button" variant="secondary">
          {ru.miniApp.profile.add}
        </Button>
      </Card>
      {save.isError ? <p className="error-box">{save.error.message}</p> : null}
      <div className="sticky-submit">
        <Button type="submit" className="w-full" loading={save.isPending}>
          <Check className="h-4 w-4" /> {ru.miniApp.profile.submit}{' '}
          <ArrowRight className="h-4 w-4" />
        </Button>
      </div>
    </form>
  );
}
