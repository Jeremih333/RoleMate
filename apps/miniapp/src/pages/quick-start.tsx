import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { ArrowRight, Check, Sparkles } from 'lucide-react';
import { Link, useLocation } from 'wouter';
import { ru } from '@rolemate/shared';
import { api, type SearchProfile } from '../api.js';
import { Button, Card, Skeleton } from '../components/ui.js';
import { ProfileAvatar } from '../components/profile-avatar.js';
import { VerificationBadge } from '../components/verification-badge.js';

const quickStart = ru.miniApp.quickStart;

/** The browser knows the offset; the questionnaire wants it as "UTC+3". */
function guessTimezone(): string | undefined {
  const offsetMinutes = -new Date().getTimezoneOffset();
  if (Number.isNaN(offsetMinutes)) return undefined;
  const hours = Math.trunc(offsetMinutes / 60);
  if (Math.abs(hours) > 14) return undefined;
  const minutes = Math.abs(offsetMinutes % 60);
  const suffix = minutes === 15 || minutes === 30 || minutes === 45 ? `:${minutes}` : '';
  if (hours === 0 && !suffix) return 'UTC';
  return `UTC${hours >= 0 ? '+' : '-'}${Math.abs(hours)}${suffix}`;
}

function toggle(current: string[], value: string): string[] {
  return current.includes(value) ? current.filter((item) => item !== value) : [...current, value];
}

function ChoiceGroup({
  title,
  hint,
  why,
  options,
  selected,
  onToggle,
}: {
  title: string;
  hint: string;
  why: string;
  options: readonly string[];
  selected: string[];
  onToggle: (value: string) => void;
}) {
  const [whyOpen, setWhyOpen] = useState(false);
  return (
    <section className="quick-start-step">
      <h2>{title}</h2>
      <p className="quick-start-hint">{hint}</p>
      <div className="quick-start-options">
        {options.map((option) => (
          <button
            key={option}
            type="button"
            className={`quick-start-option ${selected.includes(option) ? 'is-selected' : ''}`}
            aria-pressed={selected.includes(option)}
            onClick={() => onToggle(option)}
          >
            {selected.includes(option) ? <Check aria-hidden /> : null}
            <span>{option}</span>
          </button>
        ))}
      </div>
      <button type="button" className="quick-start-why" onClick={() => setWhyOpen((open) => !open)}>
        {quickStart.whyAsk}
      </button>
      {whyOpen ? <p className="quick-start-why-text">{why}</p> : null}
    </section>
  );
}

export function QuickStartPage() {
  const [, navigate] = useLocation();
  const queryClient = useQueryClient();
  const context = useQuery({ queryKey: ['quick-start'], queryFn: api.quickStartContext });
  const [lookingFor, setLookingFor] = useState<string[]>([]);
  const [formats, setFormats] = useState<string[]>([]);
  const [hook, setHook] = useState('');
  const [notice, setNotice] = useState('');
  const [results, setResults] = useState<SearchProfile[] | null>(null);

  const submit = useMutation({
    mutationFn: async () => {
      const timezone = guessTimezone();
      await api.quickStart({
        lookingFor,
        formats,
        hook: hook.trim(),
        ...(timezone ? { timezone } : {}),
      });
      // The point of the quick start is the payoff, so the first matches are
      // fetched right away instead of dropping the user into an empty screen.
      return api.search();
    },
    onSuccess: (matches) => {
      setResults(matches.slice(0, 5));
      void queryClient.invalidateQueries({ queryKey: ['profile'] });
      void queryClient.invalidateQueries({ queryKey: ['questionnaires'] });
      void queryClient.invalidateQueries({ queryKey: ['search'] });
    },
    onError: (error: Error) => setNotice(error.message),
  });

  const start = () => {
    setNotice('');
    if (!lookingFor.length || !formats.length) {
      setNotice(quickStart.chooseAtLeastOne);
      return;
    }
    if (hook.trim().length < 10) {
      setNotice(quickStart.hookTooShort);
      return;
    }
    submit.mutate();
  };

  if (context.isLoading) return <Skeleton className="h-80" />;

  if (results) {
    return (
      <div className="quick-start">
        <Card className="quick-start-intro">
          <Sparkles aria-hidden />
          <h1>{quickStart.resultsTitle}</h1>
          <p>{quickStart.reassurance}</p>
        </Card>
        {results.length ? (
          <div className="quick-start-results">
            {results.map((profile) => (
              <Link
                className="quick-start-result"
                key={profile.user_id}
                href={`/profiles/${profile.user_id}`}
              >
                <ProfileAvatar
                  mediaId={profile.avatar_media_id}
                  renderMode={profile.avatar_render_mode}
                  name={profile.display_name}
                />
                <span>
                  <strong>
                    {profile.display_name}
                    <VerificationBadge
                      kind={profile.verification_kind}
                      premium={profile.has_premium}
                    />
                  </strong>
                  <small>{profile.short_headline}</small>
                </span>
              </Link>
            ))}
          </div>
        ) : (
          <Card className="quick-start-empty">{quickStart.resultsEmpty}</Card>
        )}
        <div className="quick-start-actions">
          <Button onClick={() => navigate('/search')}>
            {quickStart.openSearch} <ArrowRight className="h-4 w-4" />
          </Button>
          <Button variant="secondary" onClick={() => navigate('/questionnaires/edit')}>
            {quickStart.refine}
          </Button>
        </div>
      </div>
    );
  }

  return (
    <div className="quick-start">
      <Card className="quick-start-intro">
        <Sparkles aria-hidden />
        <h1>{quickStart.title}</h1>
        <p>{quickStart.subtitle}</p>
        <small>{quickStart.reassurance}</small>
      </Card>

      <ChoiceGroup
        title={quickStart.whoTitle}
        hint={quickStart.whoHint}
        why={quickStart.whyWho}
        options={quickStart.whoOptions}
        selected={lookingFor}
        onToggle={(value) => setLookingFor((current) => toggle(current, value))}
      />

      <ChoiceGroup
        title={quickStart.formatTitle}
        hint={quickStart.formatHint}
        why={quickStart.whyFormat}
        options={quickStart.formatOptions}
        selected={formats}
        onToggle={(value) => setFormats((current) => toggle(current, value))}
      />

      <section className="quick-start-step">
        <h2>{quickStart.hookTitle}</h2>
        <p className="quick-start-hint">{quickStart.hookHint}</p>
        <textarea
          className="quick-start-hook"
          value={hook}
          maxLength={120}
          rows={2}
          placeholder={quickStart.hookPlaceholder}
          onChange={(event) => setHook(event.target.value)}
        />
        <div className="quick-start-options">
          {quickStart.hookPresets.map((preset) => (
            <button
              key={preset}
              type="button"
              className={`quick-start-option ${hook === preset ? 'is-selected' : ''}`}
              onClick={() => setHook(preset)}
            >
              <span>{preset}</span>
            </button>
          ))}
        </div>
      </section>

      {notice ? <p className="quick-start-notice">{notice}</p> : null}

      <div className="quick-start-actions">
        <Button loading={submit.isPending} onClick={start}>
          {submit.isPending ? quickStart.submitting : quickStart.submit}
        </Button>
        <Button variant="secondary" onClick={() => navigate('/questionnaires/edit')}>
          {quickStart.refine}
        </Button>
      </div>
    </div>
  );
}
