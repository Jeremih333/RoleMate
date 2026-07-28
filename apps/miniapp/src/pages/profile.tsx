import { zodResolver } from '@hookform/resolvers/zod';
import { useMutation, useQuery } from '@tanstack/react-query';
import { ArrowRight, Check, Edit3, ImagePlus, UserRound } from 'lucide-react';
import { useForm } from 'react-hook-form';
import { Link, useLocation } from 'wouter';
import { profileSchema, type ProfileInput } from '@rolemate/shared';
import { api } from '../api.js';
import { Button, Card, EmptyState, SectionTitle, Skeleton } from '../components/ui.js';

const defaults: ProfileInput = {
  displayName: '',
  ageGroup: '18_20',
  shortHeadline: '',
  about: '',
  roleplayExperience: 'not_specified',
  preferredRole: ['без предпочтений'],
  writingStyle: 'literary',
  averagePostLength: 'paragraphs_3_5',
  activityFrequency: 'daily',
  timezone: 'UTC+3',
  activeHours: 'вечером',
  languages: ['ru'],
  fandoms: [],
  genres: [],
  settings: '',
  plots: '',
  lookingFor: ['долгосрочного партнёра'],
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
        title="Твоя история начинается здесь"
        description="Создай подробную анкету — так мы сможем подобрать людей с похожим стилем и интересами."
        action={
          <Link className="button button-primary" href="/profile/edit">
            Создать анкету
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
        eyebrow="моя анкета"
        action={
          <Link href="/profile/edit" className="button button-secondary">
            <Edit3 className="h-4 w-4" /> Изменить
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
      <p className="mt-5 text-center text-xs text-muted">
        Создано при поддержке пиар-чата @piarchaticksss
      </p>
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
        <p className="eyebrow">шаг 1 из 4</p>
        <h1 className="font-display text-4xl font-semibold">Расскажи о себе</h1>
        <p className="mt-2 text-sm text-muted">
          Не указывай username, телефон или другие личные контакты.
        </p>
      </div>
      <Card className="space-y-5 p-5">
        <label>
          <span>Псевдоним</span>
          <input
            className={field}
            placeholder="Как тебя называть?"
            {...form.register('displayName')}
          />
          <small>{form.formState.errors.displayName?.message}</small>
        </label>
        <label>
          <span>Заголовок анкеты</span>
          <input
            className={field}
            placeholder="Ищу партнёра для долгосрочной истории…"
            {...form.register('shortHeadline')}
          />
          <small>{form.formState.errors.shortHeadline?.message}</small>
        </label>
        <label>
          <span>О себе</span>
          <textarea
            className={`${field} min-h-36`}
            placeholder="Стиль, опыт, комфортное общение…"
            {...form.register('about')}
          />
          <small>{form.formState.errors.about?.message}</small>
        </label>
        <label>
          <span>Возрастная категория</span>
          <select className={field} {...form.register('ageGroup')}>
            <option value="under_16">До 16 лет</option>
            <option value="16_17">16–17 лет</option>
            <option value="18_20">18–20 лет</option>
            <option value="21_25">21–25 лет</option>
            <option value="26_plus">26 лет и старше</option>
          </select>
        </label>
      </Card>
      <Card className="space-y-5 p-5">
        <h2 className="font-display text-2xl">Твой творческий ритм</h2>
        <label>
          <span>Стиль письма</span>
          <select className={field} {...form.register('writingStyle')}>
            <option value="literary">Литературная ролевая</option>
            <option value="short_dynamic">Динамичные короткие посты</option>
            <option value="mixed">Смешанный формат</option>
            <option value="coauthoring">Сюжетное соавторство</option>
            <option value="game_elements">С элементами игры</option>
            <option value="negotiable">Обсуждается</option>
          </select>
        </label>
        <label>
          <span>Средний объём поста</span>
          <select className={field} {...form.register('averagePostLength')}>
            <option value="lines_1_3">1–3 строки</option>
            <option value="paragraphs_1_2">1–2 абзаца</option>
            <option value="paragraphs_3_5">3–5 абзацев</option>
            <option value="long_literary">Большие литературные посты</option>
            <option value="scene_dependent">Зависит от сцены</option>
          </select>
        </label>
        <label>
          <span>Частота ответов</span>
          <select className={field} {...form.register('activityFrequency')}>
            <option value="several_hourly">Несколько раз в час</option>
            <option value="several_daily">Несколько раз в день</option>
            <option value="daily">Один ответ в день</option>
            <option value="several_weekly">Несколько раз в неделю</option>
            <option value="flexible">Свободный график</option>
          </select>
        </label>
      </Card>
      <Card className="space-y-5 p-5">
        <h2 className="font-display text-2xl">Миры и сюжеты</h2>
        <label>
          <span>Фандомы</span>
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
          <span>Жанры</span>
          <input
            className={field}
            placeholder="драма, киберпанк, приключения"
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
          <span>Идеи и сеттинги</span>
          <textarea className={`${field} min-h-28`} {...form.register('plots')} />
        </label>
        <label>
          <span>Границы и нежелательные темы</span>
          <textarea className={`${field} min-h-28`} {...form.register('boundaries')} />
          <small>{form.formState.errors.boundaries?.message}</small>
        </label>
      </Card>
      <Card className="flex items-center gap-4 p-5">
        <div className="rounded-2xl bg-violet-500/10 p-3 text-lilac">
          <ImagePlus />
        </div>
        <div className="flex-1">
          <strong>Изображения анкеты</strong>
          <p className="text-sm text-muted">До 4 изображений, без контактов и QR-кодов</p>
        </div>
        <Button type="button" variant="secondary">
          Добавить
        </Button>
      </Card>
      {save.isError ? <p className="error-box">{save.error.message}</p> : null}
      <div className="sticky-submit">
        <Button type="submit" className="w-full" loading={save.isPending}>
          <Check className="h-4 w-4" /> Отправить на модерацию <ArrowRight className="h-4 w-4" />
        </Button>
      </div>
    </form>
  );
}
