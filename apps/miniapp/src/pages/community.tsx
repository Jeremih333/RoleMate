import { useMutation, useQuery } from '@tanstack/react-query';
import { Check, Copy, Crown, Gift, Heart, MessageCircle, ShieldCheck } from 'lucide-react';
import { api } from '../api.js';
import { Button, Card, EmptyState, SectionTitle, Skeleton } from '../components/ui.js';
import { getTelegram } from '../telegram.js';

export function MatchesPage() {
  return (
    <EmptyState
      icon={<Heart className="h-7 w-7" />}
      title="Здесь появятся взаимные симпатии"
      description="Отмечай интересные анкеты. Когда симпатия станет взаимной, мы откроем анонимный чат."
    />
  );
}

export function ChatsPage() {
  const chats = useQuery({ queryKey: ['conversations'], queryFn: api.conversations });
  if (chats.isLoading) return <Skeleton className="h-80" />;
  if (!chats.data?.length)
    return (
      <EmptyState
        icon={<MessageCircle className="h-7 w-7" />}
        title="Пока тихо"
        description="После взаимной симпатии здесь откроется безопасный анонимный чат."
      />
    );
  return (
    <div>
      <SectionTitle eyebrow="анонимно и безопасно">Чаты</SectionTitle>
      <div className="space-y-3">
        {chats.data.map((chat) => (
          <Card key={chat.id} className="flex items-center gap-4 p-4">
            <span className="avatar">{chat.anonymous_alias.slice(-1)}</span>
            <div>
              <strong>{chat.anonymous_alias}</strong>
              <p className="text-sm text-muted">Нажми, чтобы продолжить историю</p>
            </div>
            <span className="activity-dot ml-auto" />
          </Card>
        ))}
      </div>
    </div>
  );
}

export function PremiumPage() {
  const products = useQuery({ queryKey: ['products'], queryFn: api.products });
  const invoice = useMutation({
    mutationFn: api.invoice,
    onSuccess: (result) => {
      if (result.invoiceLink) getTelegram()?.openInvoice(result.invoiceLink);
    },
  });
  return (
    <div className="mx-auto max-w-2xl">
      <section className="premium-hero">
        <Crown className="h-10 w-10" />
        <p className="eyebrow">больше пространства для историй</p>
        <h1 className="font-display text-5xl font-semibold">RoleMate Premium</h1>
        <p>
          Расширенные фильтры, входящие симпатии, возврат анкет и мягкий boost — безопасность и
          модерация остаются одинаковыми для всех.
        </p>
      </section>
      <div className="mt-6 grid gap-3 sm:grid-cols-2">
        {[
          'Кому я понравился',
          'Расширенные фильтры',
          'Возврат анкеты',
          'Дополнительные суперсимпатии',
          'Приоритетный boost',
          'Статистика просмотров',
        ].map((item) => (
          <Card key={item} className="flex items-center gap-3 p-4">
            <Check className="h-4 w-4 text-lilac" />
            <span className="text-sm">{item}</span>
          </Card>
        ))}
      </div>
      <SectionTitle eyebrow="оплата только Telegram Stars">Выбери тариф</SectionTitle>
      <div className="grid gap-3">
        {products.data?.map((product) => (
          <Card key={product.id} className="product-card">
            <div>
              <strong>{product.name}</strong>
              <p>{product.description}</p>
            </div>
            <Button onClick={() => invoice.mutate(product.id)} loading={invoice.isPending}>
              {product.stars_amount} ⭐
            </Button>
          </Card>
        ))}
      </div>
      <p className="mt-6 text-center text-xs text-muted">
        Создано при поддержке пиар-чата @piarchaticksss
      </p>
    </div>
  );
}

export function ReferralsPage() {
  const referrals = useQuery({ queryKey: ['referrals'], queryFn: api.referrals });
  if (referrals.isLoading) return <Skeleton className="h-96" />;
  const data = referrals.data;
  if (!data) return null;
  return (
    <div className="mx-auto max-w-xl">
      <SectionTitle eyebrow="вместе интереснее">Пригласи друзей</SectionTitle>
      <Card className="referral-card">
        <Gift className="h-10 w-10 text-lilac" />
        <h2 className="font-display text-3xl">1 друг = 1 день Premium</h2>
        <p>Награда начислится, когда новый участник завершит регистрацию и создаст анкету.</p>
        <div className="referral-link">
          <code>{data.link}</code>
          <Button variant="secondary" onClick={() => void navigator.clipboard.writeText(data.link)}>
            <Copy className="h-4 w-4" />
          </Button>
        </div>
      </Card>
      <div className="stats-grid mt-4">
        <Card>
          <strong>{data.invited ?? 0}</strong>
          <small>приглашено</small>
        </Card>
        <Card>
          <strong>{data.qualified ?? 0}</strong>
          <small>завершили</small>
        </Card>
        <Card>
          <strong>{data.rewardDays}</strong>
          <small>дней начислено</small>
        </Card>
      </div>
      <p className="mt-6 text-center text-xs text-muted">При поддержке: @piarchaticksss</p>
    </div>
  );
}

export function SettingsPage() {
  return (
    <div>
      <SectionTitle eyebrow="контроль в твоих руках">Настройки</SectionTitle>
      <div className="space-y-3">
        {[
          ['Уведомления о мэтчах', true],
          ['Уведомления о сообщениях', true],
          ['Privacy Shield', true],
          ['Показывать статус активности', true],
          ['Показывать Premium-значок', true],
        ].map(([label, checked]) => (
          <Card key={String(label)} className="setting-row">
            <span>{String(label)}</span>
            <input type="checkbox" defaultChecked={Boolean(checked)} />
          </Card>
        ))}
      </div>
      <Card className="mt-4 p-5">
        <div className="flex gap-3">
          <ShieldCheck className="text-lilac" />
          <div>
            <strong>Анонимность включена</strong>
            <p className="mt-1 text-sm text-muted">
              Контакты раскрываются только по взаимному согласию. Полный текст переписки не
              хранится.
            </p>
          </div>
        </div>
      </Card>
      <p className="mt-6 text-center text-xs text-muted">
        Создано при поддержке пиар-чата @piarchaticksss
      </p>
    </div>
  );
}
