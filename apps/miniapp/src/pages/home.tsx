import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import {
  ArrowRight,
  Gift,
  BookOpen,
  Crown,
  Heart,
  MessageCircle,
  ShieldCheck,
  Sparkles,
  Users,
} from 'lucide-react';
import { Link } from 'wouter';
import { NEWS_CHANNEL_URL, PROMO_CHAT_URL, ru } from '@rolemate/shared';
import { api } from '../api.js';
import { Button, Card, SectionTitle, Skeleton } from '../components/ui.js';

function isCompletedProfileValue(value: unknown): boolean {
  if (Array.isArray(value)) return value.length > 0;
  if (typeof value !== 'string') return value !== null && value !== undefined;
  const normalized = value.trim();
  if (!normalized || normalized === 'not_specified') return false;
  if (!normalized.startsWith('[')) return true;
  try {
    const parsed: unknown = JSON.parse(normalized);
    return Array.isArray(parsed) && parsed.length > 0;
  } catch {
    return false;
  }
}

/**
 * Being findable is not the same as being available. Declaring "free right now"
 * puts the profile at the front of everyone's search for the next couple of
 * hours, then expires by itself.
 */
function ReadyToChatCard() {
  const queryClient = useQueryClient();
  const settings = useQuery({ queryKey: ['settings'], queryFn: api.settings });
  const [readyUntil, setReadyUntil] = useState<string | null | undefined>(undefined);
  const toggle = useMutation({
    mutationFn: (minutes: number) => api.setReadyToChat(minutes),
    onSuccess: (result) => {
      setReadyUntil(result.readyUntil);
      void queryClient.invalidateQueries({ queryKey: ['search'] });
    },
  });
  const stored = settings.data?.ready_to_chat_until ?? null;
  const value = readyUntil === undefined ? stored : readyUntil;
  const active = Boolean(value && new Date(`${value}Z`).getTime() > Date.now());
  return (
    <Card className={`ready-to-chat${active ? ' is-active' : ''}`}>
      <div className="ready-to-chat-copy">
        <strong>{ru.miniApp.community.readyToChatTitle}</strong>
        <p>
          {active ? ru.miniApp.community.readyToChatActive : ru.miniApp.community.readyToChatHint}
        </p>
      </div>
      <Button
        variant={active ? 'secondary' : 'primary'}
        loading={toggle.isPending}
        onClick={() => toggle.mutate(active ? 0 : 120)}
      >
        {active ? ru.miniApp.community.readyToChatOff : ru.miniApp.community.readyToChatOn}
      </Button>
    </Card>
  );
}

export function HomePage() {
  const me = useQuery({ queryKey: ['me'], queryFn: api.me });
  const profile = useQuery({ queryKey: ['profile'], queryFn: api.profile, retry: false });
  const chats = useQuery({ queryKey: ['conversations'], queryFn: () => api.conversations() });
  const incomingLikes = useQuery({ queryKey: ['incoming-likes'], queryFn: api.incomingLikes });
  const referrals = useQuery({ queryKey: ['referrals'], queryFn: api.referrals });
  const completionValues: unknown[] = profile.data
    ? [
        profile.data.display_name,
        profile.data.age_group,
        profile.data.short_headline,
        profile.data.about,
        profile.data.roleplay_experience,
        profile.data.preferred_role,
        profile.data.writing_style,
        profile.data.average_post_length,
        profile.data.activity_frequency,
        profile.data.timezone,
        profile.data.active_hours,
        profile.data.languages,
        profile.data.fandoms,
        profile.data.genres,
        profile.data.tags,
        profile.data.settings,
        profile.data.plots,
        profile.data.looking_for,
        profile.data.boundaries,
        profile.data.gender,
      ]
    : [];
  const completion = completionValues.length
    ? Math.round(
        (completionValues.filter(isCompletedProfileValue).length / completionValues.length) * 100,
      )
    : 0;
  const activeChats = chats.data?.filter((conversation) => conversation.status === 'active').length;

  return (
    <div className="space-y-7">
      <section className="hero">
        <div className="hero-overlay" />
        <div className="relative z-10 max-w-md">
          <p className="eyebrow">{ru.miniApp.home.heroEyebrow}</p>
          <h1 className="font-display text-5xl font-semibold leading-[0.95]">
            {ru.miniApp.home.heroTitle[0]}
            <br />
            {ru.miniApp.home.heroTitle[1]}
            <br />
            {ru.miniApp.home.heroTitle[2]}
          </h1>
          <p className="mt-4 max-w-sm text-sm leading-relaxed text-white/70">
            {ru.miniApp.home.heroDescription}
          </p>
          <Link href="/search" className="button button-primary mt-6 inline-flex">
            {ru.miniApp.home.startSearch} <ArrowRight className="h-4 w-4" />
          </Link>
        </div>
      </section>

      <ReadyToChatCard />

      <section>
        <SectionTitle eyebrow={ru.miniApp.home.progressEyebrow}>
          {ru.miniApp.home.today}
        </SectionTitle>
        <div className="stats-grid">
          <Link className="stat-link" href="/matches">
            <Card>
              <span className="stat-icon">
                <Heart />
              </span>
              <strong>{incomingLikes.data?.length ?? 0}</strong>
              <small>{ru.miniApp.home.newLikes}</small>
            </Card>
          </Link>
          <Link className="stat-link" href="/chats">
            <Card>
              <span className="stat-icon">
                <MessageCircle />
              </span>
              <strong>{activeChats ?? 0}</strong>
              <small>{ru.miniApp.home.activeChats}</small>
            </Card>
          </Link>
          <Link className="stat-link" href="/referrals">
            <Card>
              <span className="stat-icon">
                <Users />
              </span>
              <strong>{Number(referrals.data?.qualified ?? 0)}</strong>
              <small>{ru.miniApp.home.referredFriends}</small>
            </Card>
          </Link>
        </div>
      </section>

      <section>
        <SectionTitle eyebrow={ru.miniApp.home.profileEyebrow}>
          {ru.miniApp.home.searchReadiness}
        </SectionTitle>
        <Card className="p-5">
          {me.isLoading || profile.isLoading ? (
            <Skeleton className="h-20" />
          ) : (
            <>
              <div className="readiness-summary">
                <div className="readiness-main">
                  <div className="rounded-2xl bg-violet-500/15 p-3 text-lilac">
                    <BookOpen className="h-5 w-5" />
                  </div>
                  <div className="readiness-copy">
                    <div className="readiness-title">
                      <strong>{ru.miniApp.home.tellAboutWorld}</strong>
                      <span>{completion}%</span>
                    </div>
                    <span className="text-sm text-muted">
                      {profile.data
                        ? profile.data.in_search_pool
                          ? ru.miniApp.home.profileReady
                          : ru.miniApp.home.profileNotInSearch
                        : ru.miniApp.home.completeProfile}
                    </span>
                  </div>
                </div>
              </div>
              <div className="progress mt-4">
                <span style={{ width: `${completion}%` }} />
              </div>
              <Link
                href="/profile/edit"
                className="mt-4 inline-flex items-center gap-2 text-sm font-semibold text-lilac"
              >
                {profile.data ? ru.miniApp.home.editProfile : ru.miniApp.home.createProfile}{' '}
                <ArrowRight className="h-4 w-4" />
              </Link>
            </>
          )}
        </Card>
      </section>

      <details className="info-disclosure">
        <summary>
          <span className="info-disclosure-icon">
            <ShieldCheck aria-hidden />
          </span>
          <span>
            <strong>{ru.miniApp.home.anonymityTitle}</strong>
            <small>{ru.miniApp.home.anonymitySummary}</small>
          </span>
          <ArrowRight className="info-disclosure-chevron" aria-hidden />
        </summary>
        <div className="info-disclosure-content">
          <ul>
            {ru.miniApp.home.anonymityPoints.map((item) => (
              <li key={item}>{item}</li>
            ))}
          </ul>
          <p>{ru.miniApp.home.anonymityNotice}</p>
        </div>
      </details>

      {/* The way into the market, in the pastel the gifts themselves are drawn
          in, with the gift pattern tiled quietly behind it. */}
      <Link href="/gifts" className="gift-home-link">
        <Card className="gift-home-card">
          <span className="gift-home-icon">
            <Gift aria-hidden />
          </span>
          <span className="gift-home-text">
            <strong>{ru.miniApp.gifts.marketplaceTitle}</strong>
            <small>{ru.miniApp.gifts.homeDescription}</small>
          </span>
          <ArrowRight className="ml-auto opacity-70" />
        </Card>
      </Link>

      <section className="grid gap-3 sm:grid-cols-2">
        <Link href="/premium">
          <Card className="feature-card premium-card">
            <Crown />
            <div>
              <strong>{ru.brand.premium}</strong>
              <small>{ru.miniApp.home.premiumDescription}</small>
            </div>
            <Sparkles className="ml-auto opacity-60" />
          </Card>
        </Link>
        <Link href="/referrals">
          <Card className="feature-card">
            <Users />
            <div>
              <strong>{ru.miniApp.home.inviteFriends}</strong>
              <small>{ru.miniApp.home.referralReward}</small>
            </div>
            <ArrowRight className="ml-auto opacity-60" />
          </Card>
        </Link>
      </section>

      <a href={PROMO_CHAT_URL} className="promo-strip">
        <img className="brand-mark small" src="/assets/piarchat-avatar.webp" alt="" />
        <span>
          <strong>{ru.miniApp.home.promoTitle}</strong>
          <small>{ru.miniApp.home.promoDescription}</small>
        </span>
        <ArrowRight className="ml-auto h-4 w-4" />
      </a>
      <a href={NEWS_CHANNEL_URL} className="promo-strip">
        <img className="brand-mark small" src="/assets/rolemate-news-avatar.webp" alt="" />
        <span>
          <strong>{ru.miniApp.home.newsTitle}</strong>
          <small>{ru.miniApp.home.newsDescription}</small>
        </span>
        <ArrowRight className="ml-auto h-4 w-4" />
      </a>
    </div>
  );
}
