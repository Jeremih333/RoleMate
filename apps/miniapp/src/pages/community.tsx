import { useEffect, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { ru } from '@rolemate/shared';
import {
  AlertTriangle,
  Ban,
  BellOff,
  Check,
  Copy,
  Crown,
  ExternalLink,
  Gift,
  Heart,
  MessageCircle,
  PauseCircle,
  Save,
  ShieldCheck,
  LogOut,
} from 'lucide-react';
import { api, type SettingsInput } from '../api.js';
import { Button, Card, EmptyState, SectionTitle, Skeleton } from '../components/ui.js';
import { getTelegram } from '../telegram.js';

export function MatchesPage() {
  const queryClient = useQueryClient();
  const matches = useQuery({ queryKey: ['matches'], queryFn: api.matches });
  const premium = useQuery({ queryKey: ['premium-status'], queryFn: api.premiumStatus });
  const incoming = useQuery({
    queryKey: ['incoming-likes'],
    queryFn: api.incomingLikes,
    enabled: premium.data?.premium === true,
  });
  const likeBack = useMutation({
    mutationFn: (userId: string) => api.swipe(userId, 'like'),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ['matches'] });
      void queryClient.invalidateQueries({ queryKey: ['incoming-likes'] });
    },
  });
  if (matches.isLoading) return <Skeleton className="h-80" />;
  return (
    <div>
      <SectionTitle eyebrow={ru.miniApp.community.matchesEyebrow}>
        {ru.miniApp.community.matchesTitle}
      </SectionTitle>
      <div className="space-y-3">
        {(matches.data ?? []).map((match) => (
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
        {!matches.data?.length ? (
          <EmptyState
            icon={<Heart className="h-7 w-7" />}
            title={ru.miniApp.community.matchesEmptyTitle}
            description={ru.miniApp.community.matchesEmptyDescription}
          />
        ) : null}
      </div>
      <SectionTitle eyebrow="Premium">{ru.miniApp.community.incomingLikesTitle}</SectionTitle>
      {!premium.data?.premium ? (
        <Card className="p-4 text-sm text-soft">{ru.miniApp.community.incomingLikesPremium}</Card>
      ) : (
        <div className="space-y-3">
          {incoming.data?.map((like) => (
            <Card key={like.swipe_id} className="p-4">
              <div className="flex items-center justify-between gap-3">
                <div>
                  <strong>{like.display_name}</strong>
                  <p className="text-sm text-muted">{like.short_headline}</p>
                </div>
                <span className="status-pill">{like.action}</span>
              </div>
              <Button
                className="mt-3"
                onClick={() => likeBack.mutate(like.user_id)}
                loading={likeBack.isPending}
              >
                <Heart className="h-4 w-4" /> {ru.miniApp.community.likeBack}
              </Button>
            </Card>
          ))}
        </div>
      )}
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
  const control = useMutation({
    mutationFn: (input: {
      conversationId: string;
      action: 'mute' | 'unmute' | 'pause' | 'resume' | 'close';
    }) => api.controlConversation(input.conversationId, input.action),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['conversations'] }),
  });
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
                onClick={() =>
                  control.mutate({
                    conversationId: chat.id,
                    action: chat.is_muted ? 'unmute' : 'mute',
                  })
                }
              >
                <BellOff className="h-4 w-4" />{' '}
                {chat.is_muted ? ru.miniApp.community.unmute : ru.miniApp.community.mute}
              </Button>
              {chat.status !== 'closed' ? (
                <Button
                  variant="secondary"
                  onClick={() =>
                    control.mutate({
                      conversationId: chat.id,
                      action: chat.status === 'paused' ? 'resume' : 'pause',
                    })
                  }
                >
                  <PauseCircle className="h-4 w-4" />{' '}
                  {chat.status === 'paused'
                    ? ru.miniApp.community.resumeChat
                    : ru.miniApp.community.pauseChat}
                </Button>
              ) : null}
              {chat.status !== 'closed' ? (
                <Button
                  variant="secondary"
                  onClick={() => {
                    if (window.confirm(ru.miniApp.community.closeChatConfirm)) {
                      control.mutate({ conversationId: chat.id, action: 'close' });
                    }
                  }}
                >
                  <LogOut className="h-4 w-4" /> {ru.miniApp.community.closeChat}
                </Button>
              ) : null}
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
  const status = useQuery({ queryKey: ['premium-status'], queryFn: api.premiumStatus });
  const stats = useQuery({
    queryKey: ['premium-stats'],
    queryFn: api.premiumStats,
    enabled: status.data?.premium === true,
  });
  const boost = useMutation({ mutationFn: api.premiumBoost });
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
        <h1 className="font-display text-5xl font-semibold">{ru.miniApp.community.premiumTitle}</h1>
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
      {status.data?.premium ? (
        <Card className="mt-4 p-4">
          {stats.data ? (
            <p className="text-sm text-soft">
              {ru.miniApp.community.premiumStats(
                stats.data.viewsToday,
                stats.data.viewsSevenDays,
                stats.data.viewsTotal,
                stats.data.incomingLikes,
              )}
            </p>
          ) : null}
          {status.data.earlyAccess ? (
            <p className="mt-2 text-sm text-lilac">{ru.miniApp.community.earlyAccessEnabled}</p>
          ) : null}
          <Button
            className="mt-3"
            onClick={() => boost.mutate()}
            loading={boost.isPending}
            disabled={boost.isSuccess}
          >
            {boost.isSuccess
              ? ru.miniApp.community.boostActivated
              : ru.miniApp.community.activateBoost}
          </Button>
        </Card>
      ) : null}
      {status.data?.premium ? <PremiumProfileVariants /> : null}
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

function PremiumProfileVariants() {
  const queryClient = useQueryClient();
  const variants = useQuery({ queryKey: ['profile-variants'], queryFn: api.profileVariants });
  const [name, setName] = useState('');
  const [shortHeadline, setShortHeadline] = useState('');
  const [about, setAbout] = useState('');
  const [plots, setPlots] = useState('');
  const save = useMutation({
    mutationFn: api.saveProfileVariant,
    onSuccess: () => {
      setName('');
      setShortHeadline('');
      setAbout('');
      setPlots('');
      void queryClient.invalidateQueries({ queryKey: ['profile-variants'] });
    },
  });
  const activate = useMutation({
    mutationFn: api.activateProfileVariant,
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ['profile-variants'] });
      void queryClient.invalidateQueries({ queryKey: ['profile'] });
    },
  });
  const remove = useMutation({
    mutationFn: api.deleteProfileVariant,
    onSuccess: () => void queryClient.invalidateQueries({ queryKey: ['profile-variants'] }),
  });
  return (
    <Card className="mt-4 space-y-3 p-4">
      <h2 className="font-display text-2xl">{ru.miniApp.community.profileVariantsTitle}</h2>
      <input
        className="input-field"
        value={name}
        maxLength={40}
        onChange={(event) => setName(event.target.value)}
        placeholder={ru.miniApp.community.profileVariantName}
      />
      <input
        className="input-field"
        value={shortHeadline}
        maxLength={120}
        onChange={(event) => setShortHeadline(event.target.value)}
        placeholder={ru.miniApp.community.profileVariantHeadline}
      />
      <textarea
        className="input-field min-h-24"
        value={about}
        maxLength={2_000}
        onChange={(event) => setAbout(event.target.value)}
        placeholder={ru.miniApp.community.profileVariantAbout}
      />
      <textarea
        className="input-field min-h-20"
        value={plots}
        maxLength={2_000}
        onChange={(event) => setPlots(event.target.value)}
        placeholder={ru.miniApp.community.profileVariantPlots}
      />
      <Button
        loading={save.isPending}
        disabled={!name.trim() || shortHeadline.trim().length < 3 || about.trim().length < 20}
        onClick={() => save.mutate({ name, shortHeadline, about, plots })}
      >
        {ru.miniApp.community.saveProfileVariant}
      </Button>
      <div className="space-y-2">
        {variants.data?.map((variant) => (
          <div className="setting-row" key={variant.id}>
            <span>
              {variant.name}
              {variant.is_active ? ' ✓' : ''}
            </span>
            <span className="flex gap-2">
              <button onClick={() => activate.mutate(variant.id)}>
                {ru.miniApp.community.activateProfileVariant}
              </button>
              <button onClick={() => remove.mutate(variant.id)}>
                {ru.miniApp.community.deleteProfileVariant}
              </button>
            </span>
          </div>
        ))}
      </div>
    </Card>
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
  const premium = useQuery({ queryKey: ['premium-status'], queryFn: api.premiumStatus });
  const [form, setForm] = useState<SettingsInput | null>(null);
  const save = useMutation({ mutationFn: api.saveSettings });
  const searchState = useMutation({ mutationFn: api.setSearchEnabled });
  const deleteAccount = useMutation({ mutationFn: api.deleteAccount });
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
              disabled={
                !premium.data?.premium && (key === 'showOnlineStatus' || key === 'showPremiumBadge')
              }
              onChange={(event) => setForm({ ...form, [key]: event.target.checked })}
            />
          </Card>
        ))}
        {!premium.data?.premium ? (
          <p className="text-sm text-muted">{ru.miniApp.community.premiumPrivacyOnly}</p>
        ) : null}
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
      <Card className="mt-4 border border-red-400/20 p-5">
        <strong>{ru.miniApp.community.deleteAccountTitle}</strong>
        <p className="mt-1 text-sm text-muted">{ru.miniApp.community.deleteAccountDescription}</p>
        <Button
          className="mt-3"
          variant="secondary"
          loading={deleteAccount.isPending}
          disabled={deleteAccount.isSuccess}
          onClick={() => {
            const confirmation = window.prompt(ru.miniApp.community.deleteAccountPrompt);
            if (confirmation === ru.api.deleteConfirmation) deleteAccount.mutate();
          }}
        >
          {ru.miniApp.community.deleteAccountButton}
        </Button>
        {deleteAccount.isSuccess ? (
          <p className="mt-3 text-sm text-soft">{ru.miniApp.community.deleteAccountDone}</p>
        ) : null}
      </Card>
      <p className="mt-6 text-center text-xs text-muted">{ru.miniApp.attribution}</p>
    </div>
  );
}
