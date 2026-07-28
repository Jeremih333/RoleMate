import { useQuery } from '@tanstack/react-query';
import { ArrowRight, BookOpen, Crown, Heart, MessageCircle, Sparkles, Users } from 'lucide-react';
import { Link } from 'wouter';
import { api } from '../api.js';
import { Card, SectionTitle, Skeleton } from '../components/ui.js';

export function HomePage() {
  const me = useQuery({ queryKey: ['me'], queryFn: api.me });
  const chats = useQuery({ queryKey: ['conversations'], queryFn: api.conversations });
  const referrals = useQuery({ queryKey: ['referrals'], queryFn: api.referrals });

  return (
    <div className="space-y-7">
      <section className="hero">
        <div className="hero-overlay" />
        <div className="relative z-10 max-w-md">
          <p className="eyebrow">пространство историй</p>
          <h1 className="font-display text-5xl font-semibold leading-[0.95]">
            Найди того,
            <br />
            кто продолжит
            <br />
            твою историю
          </h1>
          <p className="mt-4 max-w-sm text-sm leading-relaxed text-white/70">
            Анонимный поиск со-ролевиков по фандомам, стилю письма и творческому ритму.
          </p>
          <Link href="/search" className="button button-primary mt-6 inline-flex">
            Начать поиск <ArrowRight className="h-4 w-4" />
          </Link>
        </div>
      </section>

      <section>
        <SectionTitle eyebrow="твой прогресс">Сегодня в RoleMate</SectionTitle>
        <div className="stats-grid">
          <Card>
            <span className="stat-icon">
              <Heart />
            </span>
            <strong>0</strong>
            <small>новых симпатий</small>
          </Card>
          <Card>
            <span className="stat-icon">
              <MessageCircle />
            </span>
            <strong>{chats.data?.length ?? 0}</strong>
            <small>активных чатов</small>
          </Card>
          <Card>
            <span className="stat-icon">
              <Users />
            </span>
            <strong>{referrals.data?.qualified ?? 0}</strong>
            <small>друзей пришло</small>
          </Card>
        </div>
      </section>

      <section>
        <SectionTitle eyebrow="анкета">Готовность к поиску</SectionTitle>
        <Card className="p-5">
          {me.isLoading ? (
            <Skeleton className="h-20" />
          ) : (
            <>
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-3">
                  <div className="rounded-2xl bg-violet-500/15 p-3 text-lilac">
                    <BookOpen className="h-5 w-5" />
                  </div>
                  <div>
                    <strong className="block">Расскажи о своём мире</strong>
                    <span className="text-sm text-muted">
                      Заполни анкету, чтобы попасть в поиск
                    </span>
                  </div>
                </div>
                <span className="text-sm font-semibold text-lilac">0%</span>
              </div>
              <div className="progress mt-4">
                <span style={{ width: '3%' }} />
              </div>
              <Link
                href="/profile/edit"
                className="mt-4 inline-flex items-center gap-2 text-sm font-semibold text-lilac"
              >
                Создать анкету <ArrowRight className="h-4 w-4" />
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
              <strong>RoleMate Premium</strong>
              <small>Больше возможностей для поиска</small>
            </div>
            <Sparkles className="ml-auto opacity-60" />
          </Card>
        </Link>
        <Link href="/referrals">
          <Card className="feature-card">
            <Users />
            <div>
              <strong>Пригласи друзей</strong>
              <small>1 друг = 1 день Premium</small>
            </div>
            <ArrowRight className="ml-auto opacity-60" />
          </Card>
        </Link>
      </section>

      <a href="https://t.me/piarchaticksss" className="promo-strip">
        <span className="brand-mark small">P</span>
        <span>
          <strong>Пиар-чат для авторов</strong>
          <small>@piarchaticksss · поддерживает RoleMate</small>
        </span>
        <ArrowRight className="ml-auto h-4 w-4" />
      </a>
    </div>
  );
}
