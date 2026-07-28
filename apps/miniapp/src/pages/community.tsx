import { useEffect, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { ru } from '@rolemate/shared';
import {
  AlertTriangle,
  Ban,
  Check,
  Copy,
  Crown,
  ExternalLink,
  Gift,
  Heart,
  MessageCircle,
  Save,
  ShieldCheck,
} from 'lucide-react';
import { api, type SettingsInput } from '../api.js';
import { Button, Card, EmptyState, SectionTitle, Skeleton } from '../components/ui.js';
import { getTelegram } from '../telegram.js';

export function MatchesPage() {
  const matches = useQuery({ queryKey: ['matches'], queryFn: api.matches });
  if (matches.isLoading) return <Skeleton className="h-80" />;
  if (!matches.data?.length)
    return (
      <EmptyState
        icon={<Heart className="h-7 w-7" />}
        title={ru.miniApp.community.matchesEmptyTitle}
        description={ru.miniApp.community.matchesEmptyDescription}
      />
    );
  return (
    <div>
      <SectionTitle eyebrow={ru.miniApp.community.matchesEyebrow}>
        {ru.miniApp.community.matchesTitle}
      </SectionTitle>
      <div className="space-y-3">
        {matches.data.map((match) => (
          <Card key={match.id} className="flex items-center gap-4 p-4">
            <span className="avatar">{match.display_name?.slice(0, 1) ?? 'R'}</span>
            <div className="min-w-0 flex-1">
              <strong>{match.display_name ?? ru.miniApp.community.roleplayer}</strong>
              <p className="truncate text-sm text-muted">{match.short_headline}</p>
            </div>
            <a className="button button-secondary" href="/chats">
              <MessageCircle className="h-4 w-4" />
            </a>
          </Card>
        ))}
      </div>
    </div>
  );
}

export function ChatsPage() {
  const queryClient = useQueryClient();
  const chats = useQuery({ queryKey: ['conversations'], queryFn: api.conversations });
  const block = useMutation({
    mutationFn: (userId: string) => api.block(userId),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['conversations'] }),
  });
  const report = useMutation({ mutationFn: api.report });
  const reveal = useMutation({ mutationFn: api.requestContactReveal });
  if (chats.isLoading) return <Skeleton className="h-80" />;
  if (!chats.data?.length)
    return (
      <EmptyState
        icon={<MessageCircle className="h-7 w-7" />}
        title={ru.miniApp.community.chatsEmptyTitle}
        description={ru.miniApp.community.chatsEmptyDescription}
      />
    );
  return (
    <div>
      <SectionTitle eyebrow={ru.miniApp.community.chatsEyebrow}>
        {ru.miniApp.community.chatsTitle}
      </SectionTitle>
      <div className="space-y-3">
        {chats.data.map((chat) => (
          <Card key={chat.id} className="p-4">
            <div className="flex items-center gap-4">
              <span className="avatar">{chat.anonymous_alias.slice(-1)}</span>
              <div className="min-w-0 flex-1">
                <strong>{chat.anonymous_alias}</strong>
                <p className="truncate text-sm text-muted">
                  {chat.short_headline ?? ru.miniApp.community.continueInBot}
                </p>
              </div>
              <span className="activity-dot" />
            </div>
            <div className="mt-4 flex flex-wrap gap-2">
              <Button
                variant="secondary"
                onClick={() => reveal.mutate(chat.id)}
                loading={reveal.isPending}
              >
                <ExternalLink className="h-4 w-4" /> {ru.miniApp.community.contactExchange}
              </Button>
              <Button
                variant="secondary"
                onClick={() => {
                  const description = window.prompt(ru.miniApp.community.reportPrompt) ?? '';
                  if (!description) return;
                  report.mutate({
                    reportedUserId: chat.other_user_id,
                    conversationId: chat.id,
                    category: 'other',
                    description,
                  });
                }}
              >
                <AlertTriangle className="h-4 w-4" /> {ru.miniApp.community.report}
              </Button>
              <Button
                variant="secondary"
                onClick={() => {
                  if (window.confirm(ru.miniApp.community.blockConfirm)) {
                    block.mutate(chat.other_user_id);
                  }
                }}
                loading={block.isPending}
              >
                <Ban className="h-4 w-4" /> {ru.miniApp.community.block}
              </Button>
            </div>
            {reveal.data?.revealed ? (
              <p className="mt-3 text-sm text-soft">
                {ru.miniApp.community.mutualContact}{' '}
                {reveal.data.contacts
                  ?.map((contact) => contact.username)
                  .filter(Boolean)
                  .join(', ') || ru.miniApp.community.usernameMissing}
              </p>
            ) : reveal.isSuccess ? (
              <p className="mt-3 text-sm text-muted">{ru.miniApp.community.contactPending}</p>
            ) : null}
            {report.data ? (
              <p className="mt-3 text-sm text-soft">
                {ru.miniApp.community.reportSent(report.data.reportId)}
              </p>
            ) : null}
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
        <p className="eyebrow">{ru.miniApp.community.premiumEyebrow}</p>
        <h1 className="font-display text-5xl font-semibold">RoleMate Premium</h1>
        <p>{ru.miniApp.community.premiumDescription}</p>
      </section>
      <div className="mt-6 grid gap-3 sm:grid-cols-2">
        {ru.miniApp.community.premiumFeatures.map((item) => (
          <Card key={item} className="flex items-center gap-3 p-4">
            <Check className="h-4 w-4 text-lilac" />
            <span className="text-sm">{item}</span>
          </Card>
        ))}
      </div>
      <SectionTitle eyebrow={ru.miniApp.community.paymentEyebrow}>
        {ru.miniApp.community.choosePlan}
      </SectionTitle>
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
      <p className="mt-6 text-center text-xs text-muted">{ru.miniApp.attribution}</p>
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
      <SectionTitle eyebrow={ru.miniApp.community.referralEyebrow}>
        {ru.miniApp.community.inviteFriends}
      </SectionTitle>
      <Card className="referral-card">
        <Gift className="h-10 w-10 text-lilac" />
        <h2 className="font-display text-3xl">{ru.miniApp.community.referralReward}</h2>
        <p>{ru.miniApp.community.referralCondition}</p>
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
          <small>{ru.miniApp.community.invited}</small>
        </Card>
        <Card>
          <strong>{data.qualified ?? 0}</strong>
          <small>{ru.miniApp.community.qualified}</small>
        </Card>
        <Card>
          <strong>{data.rewardDays}</strong>
          <small>{ru.miniApp.community.daysGranted}</small>
        </Card>
      </div>
      <p className="mt-6 text-center text-xs text-muted">{ru.miniApp.attribution}</p>
    </div>
  );
}

export function SettingsPage() {
  const settings = useQuery({ queryKey: ['settings'], queryFn: api.settings });
  const [form, setForm] = useState<SettingsInput | null>(null);
  const save = useMutation({ mutationFn: api.saveSettings });
  const searchState = useMutation({ mutationFn: api.setSearchEnabled });
  useEffect(() => {
    if (!settings.data) return;
    setForm({
      notificationsEnabled: Boolean(settings.data.notifications_enabled),
      matchNotificationsEnabled: Boolean(settings.data.match_notifications_enabled),
      messageNotificationsEnabled: Boolean(settings.data.message_notifications_enabled),
      referralNotificationsEnabled: Boolean(settings.data.referral_notifications_enabled),
      premiumNotificationsEnabled: Boolean(settings.data.premium_notifications_enabled),
      privacyShieldEnabled: Boolean(settings.data.privacy_shield_enabled),
      showOnlineStatus: Boolean(settings.data.show_online_status),
      showPremiumBadge: Boolean(settings.data.show_premium_badge),
      theme: settings.data.theme,
    });
  }, [settings.data]);
  if (!form) return <Skeleton className="h-96" />;
  const toggles: Array<[keyof SettingsInput, string]> = [
    ['notificationsEnabled', ru.miniApp.community.settingLabels[0]],
    ['matchNotificationsEnabled', ru.miniApp.community.settingLabels[1]],
    ['messageNotificationsEnabled', ru.miniApp.community.settingLabels[2]],
    ['referralNotificationsEnabled', ru.miniApp.community.settingLabels[3]],
    ['premiumNotificationsEnabled', ru.miniApp.community.settingLabels[4]],
    ['privacyShieldEnabled', ru.miniApp.community.settingLabels[5]],
    ['showOnlineStatus', ru.miniApp.community.settingLabels[6]],
    ['showPremiumBadge', ru.miniApp.community.settingLabels[7]],
  ];
  return (
    <div>
      <SectionTitle eyebrow={ru.miniApp.community.settingsEyebrow}>
        {ru.miniApp.community.settingsTitle}
      </SectionTitle>
      <div className="space-y-3">
        {toggles.map(([key, label]) => (
          <Card key={key} className="setting-row">
            <span>{label}</span>
            <input
              type="checkbox"
              checked={Boolean(form[key])}
              onChange={(event) => setForm({ ...form, [key]: event.target.checked })}
            />
          </Card>
        ))}
        <Card className="setting-row">
          <span>{ru.miniApp.community.theme}</span>
          <select
            className="input-field max-w-40"
            value={form.theme}
            onChange={(event) =>
              setForm({ ...form, theme: event.target.value as SettingsInput['theme'] })
            }
          >
            <option value="telegram">Telegram</option>
            <option value="light">{ru.miniApp.community.lightTheme}</option>
            <option value="dark">{ru.miniApp.community.darkTheme}</option>
          </select>
        </Card>
      </div>
      <div className="mt-4 flex flex-wrap gap-2">
        <Button onClick={() => save.mutate(form)} loading={save.isPending}>
          <Save className="h-4 w-4" /> {ru.miniApp.community.save}
        </Button>
        <Button variant="secondary" onClick={() => searchState.mutate(false)}>
          {ru.miniApp.community.pauseSearch}
        </Button>
        <Button variant="secondary" onClick={() => searchState.mutate(true)}>
          {ru.miniApp.community.resumeSearch}
        </Button>
      </div>
      {save.isSuccess ? (
        <p className="mt-3 text-sm text-soft">{ru.miniApp.community.settingsSaved}</p>
      ) : null}
      <Card className="mt-4 p-5">
        <div className="flex gap-3">
          <ShieldCheck className="text-lilac" />
          <div>
            <strong>{ru.miniApp.community.anonymityEnabled}</strong>
            <p className="mt-1 text-sm text-muted">{ru.miniApp.community.anonymityDescription}</p>
          </div>
        </div>
      </Card>
      <p className="mt-6 text-center text-xs text-muted">{ru.miniApp.attribution}</p>
    </div>
  );
}
