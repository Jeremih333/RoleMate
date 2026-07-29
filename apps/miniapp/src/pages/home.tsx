import { useQuery } from '@tanstack/react-query';
import { ArrowRight, BookOpen, Crown, Heart, MessageCircle, Sparkles, Users } from 'lucide-react';
import { Link } from 'wouter';
import { NEWS_CHANNEL_URL, PROMO_CHAT_URL, ru } from '@rolemate/shared';
import { api } from '../api.js';
import { Card, SectionTitle, Skeleton } from '../components/ui.js';

export function HomePage() {
  const me = useQuery({ queryKey: ['me'], queryFn: api.me });
  const profile = useQuery({ queryKey: ['profile'], queryFn: api.profile, retry: false });
  const chats = useQuery({ queryKey: ['conversations'], queryFn: api.conversations });
  const referrals = useQuery({ queryKey: ['referrals'], queryFn: api.referrals });
  const completion = Math.max(
    0,
    Math.min(100, Number(profile.data?.profile_completion_percent ?? 0)),
  );

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

      <section>
        <SectionTitle eyebrow={ru.miniApp.home.progressEyebrow}>
          {ru.miniApp.home.today}
        </SectionTitle>
        <div className="stats-grid">
          <Card>
            <span className="stat-icon">
              <Heart />
            </span>
            <strong>0</strong>
            <small>{ru.miniApp.home.newLikes}</small>
          </Card>
          <Card>
            <span className="stat-icon">
              <MessageCircle />
            </span>
            <strong>{chats.data?.length ?? 0}</strong>
            <small>{ru.miniApp.home.activeChats}</small>
          </Card>
          <Card>
            <span className="stat-icon">
              <Users />
            </span>
            <strong>{referrals.data?.qualified ?? 0}</strong>
            <small>{ru.miniApp.home.referredFriends}</small>
          </Card>
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
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-3">
                  <div className="rounded-2xl bg-violet-500/15 p-3 text-lilac">
                    <BookOpen className="h-5 w-5" />
                  </div>
                  <div>
                    <strong className="block">{ru.miniApp.home.tellAboutWorld}</strong>
                    <span className="text-sm text-muted">
                      {profile.data
                        ? profile.data.in_search_pool
                          ? ru.miniApp.home.profileReady
                          : ru.miniApp.home.profileNotInSearch
                        : ru.miniApp.home.completeProfile}
                    </span>
                  </div>
                </div>
                <span className="text-sm font-semibold text-lilac">{completion}%</span>
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
