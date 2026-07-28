import { Component, useState, type ErrorInfo, type ReactNode } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { ru } from '@rolemate/shared';
import {
  Activity,
  AlertTriangle,
  Ban,
  Crown,
  Database,
  FileCheck,
  Flag,
  Heart,
  History,
  MessageCircle,
  Search,
  Send,
  Server,
  Shield,
  Star,
  UserPlus,
  Users,
} from 'lucide-react';
import { Redirect } from 'wouter';
import { api, type AdminConfig, type Product } from '../api.js';
import { Button, Card, SectionTitle, Skeleton } from '../components/ui.js';
import { useUserStore } from '../store.js';

type AdminSection =
  | 'dashboard'
  | 'users'
  | 'profiles'
  | 'reports'
  | 'payments'
  | 'referrals'
  | 'broadcasts'
  | 'flags'
  | 'system'
  | 'audit';

export function AdminPage() {
  const isAdmin = useUserStore((state) => state.user?.isAdmin);
  const [section, setSection] = useState<AdminSection>('dashboard');
  if (!isAdmin) return <Redirect to="/" replace />;
  return (
    <div>
      <SectionTitle eyebrow={ru.miniApp.admin.eyebrow}>{ru.miniApp.admin.title}</SectionTitle>
      <div className="admin-banner">
        <Shield />
        <div>
          <strong>{ru.miniApp.admin.protectedTitle}</strong>
          <p>{ru.miniApp.admin.protectedDescription}</p>
        </div>
      </div>
      <div className="mt-4 flex flex-wrap gap-2">
        {(
          [
            ['dashboard', ru.miniApp.admin.sections[0]],
            ['users', ru.miniApp.admin.sections[1]],
            ['profiles', ru.miniApp.admin.sections[2]],
            ['reports', ru.miniApp.admin.sections[3]],
            ['payments', ru.miniApp.admin.sections[4]],
            ['referrals', ru.miniApp.admin.sections[5]],
            ['broadcasts', ru.miniApp.admin.sections[6]],
            ['flags', ru.miniApp.admin.sections[7]],
            ['system', ru.miniApp.admin.sections[8]],
            ['audit', ru.miniApp.admin.sections[9]],
          ] as const
        ).map(([key, label]) => (
          <Button
            key={key}
            variant={section === key ? 'primary' : 'secondary'}
            onClick={() => setSection(key)}
          >
            {label}
          </Button>
        ))}
      </div>
      <div className="mt-6">
        <AdminSectionBoundary key={section}>
          {section === 'dashboard' ? <Dashboard /> : null}
          {section === 'users' ? <UsersQueue /> : null}
          {section === 'profiles' ? <ProfilesQueue /> : null}
          {section === 'reports' ? <ReportsQueue /> : null}
          {section === 'payments' ? <Payments /> : null}
          {section === 'referrals' ? <Referrals /> : null}
          {section === 'broadcasts' ? <Broadcasts /> : null}
          {section === 'flags' ? <Flags /> : null}
          {section === 'system' ? <SystemStatus /> : null}
          {section === 'audit' ? <AuditLog /> : null}
        </AdminSectionBoundary>
      </div>
    </div>
  );
}

class AdminSectionBoundary extends Component<
  { children: ReactNode },
  { failed: boolean; details: string }
> {
  override state = { failed: false, details: '' };

  static getDerivedStateFromError(error: unknown) {
    return {
      failed: true,
      details: error instanceof Error ? error.message : ru.miniApp.admin.unknownSectionError,
    };
  }

  override componentDidCatch(error: Error, info: ErrorInfo) {
    console.error('Admin section render failed', { name: error.name, stack: info.componentStack });
  }

  override render() {
    if (!this.state.failed) return this.props.children;
    return (
      <Card className="admin-error-card">
        <AlertTriangle />
        <div>
          <strong>{ru.miniApp.admin.sectionErrorTitle}</strong>
          <p>{this.state.details}</p>
          <Button className="mt-3" onClick={() => this.setState({ failed: false, details: '' })}>
            {ru.miniApp.admin.retrySection}
          </Button>
        </div>
      </Card>
    );
  }
}

function Dashboard() {
  const stats = useQuery({ queryKey: ['admin-dashboard'], queryFn: api.adminDashboard });
  if (stats.isLoading) return <Skeleton className="h-96" />;
  if (stats.isError) return <AdminRequestError error={stats.error} retry={() => stats.refetch()} />;
  const data = stats.data;
  const items = [
    [ru.miniApp.admin.stats[0], data?.users, Users],
    [ru.miniApp.admin.stats[1], data?.newUsers24h, UserPlus],
    [ru.miniApp.admin.stats[2], data?.activeUsers24h, Activity],
    [ru.miniApp.admin.stats[3], data?.profiles, FileCheck],
    [ru.miniApp.admin.stats[4], data?.matches, Heart],
    [ru.miniApp.admin.stats[5], data?.conversations, MessageCircle],
    [ru.miniApp.admin.stats[6], data?.openReports, AlertTriangle],
    [ru.miniApp.admin.stats[7], data?.bannedUsers, Ban],
    [ru.miniApp.admin.stats[8], data?.premiumUsers, Crown],
    [ru.miniApp.admin.stats[9], data?.starsPayments, Database],
    [ru.miniApp.admin.stats[10], data?.qualifiedReferrals, UserPlus],
    [ru.miniApp.admin.stats[11], data?.captcha24h, Shield],
    [ru.miniApp.admin.stats[12], data?.pendingJobs, History],
    [ru.miniApp.admin.stats[13], data?.failedJobs, AlertTriangle],
  ] as const;
  return (
    <div className="admin-grid">
      {items.map(([label, value, Icon]) => (
        <Card key={label} className="admin-stat">
          <Icon />
          <strong>{value ?? 0}</strong>
          <small>{label}</small>
        </Card>
      ))}
    </div>
  );
}

function UsersQueue() {
  const queryClient = useQueryClient();
  const [search, setSearch] = useState('');
  const users = useQuery({
    queryKey: ['admin-users', search],
    queryFn: () => api.adminUsers(search),
  });
  const moderate = useMutation({
    mutationFn: (input: {
      userId: string;
      action:
        'warn' | 'temporary_ban' | 'permanent_ban' | 'unban' | 'disable_profile' | 'reset_captcha';
      reason: string;
      bannedUntil?: string;
    }) => api.adminModerateUser(input.userId, input),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['admin-users'] }),
  });
  const premium = useMutation({
    mutationFn: (input: { userId: string; durationDays: number; reason: string }) =>
      api.adminGrantPremium(input.userId, input.durationDays, input.reason),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['admin-users'] }),
  });
  const revokePremium = useMutation({
    mutationFn: (userId: string) =>
      api.adminRevokePremium(userId, ru.miniApp.admin.ownerRevokeReason),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['admin-users'] }),
  });
  if (users.isLoading) return <Skeleton className="h-72" />;
  if (users.isError) return <AdminRequestError error={users.error} retry={() => users.refetch()} />;
  return (
    <div>
      <label className="flex items-center gap-2">
        <Search className="h-4 w-4" />
        <input
          className="input-field"
          value={search}
          onChange={(event) => setSearch(event.target.value)}
          placeholder={ru.miniApp.admin.searchPlaceholder}
        />
      </label>
      <div className="mt-4 space-y-3">
        {users.data?.map((user) => (
          <Card key={user.id} className="p-4">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <div>
                <strong>{user.display_name ?? user.telegram_first_name}</strong>
                <p className="text-sm text-muted">
                  {user.telegram_user_id}{' '}
                  {user.telegram_username ? `@${user.telegram_username}` : ''} · risk{' '}
                  {user.risk_score}
                </p>
              </div>
              <span className="status-pill">{user.is_banned ? 'banned' : user.status}</span>
            </div>
            <div className="mt-3 flex flex-wrap gap-2">
              {user.is_banned ? (
                <Button
                  variant="secondary"
                  onClick={() =>
                    moderate.mutate({
                      userId: user.id,
                      action: 'unban',
                      reason: ru.miniApp.admin.ownerUnbanReason,
                    })
                  }
                >
                  {ru.miniApp.admin.unban}
                </Button>
              ) : (
                <Button
                  variant="secondary"
                  onClick={() => {
                    const reason = window.prompt(ru.miniApp.admin.banReasonPrompt);
                    if (reason)
                      moderate.mutate({ userId: user.id, action: 'permanent_ban', reason });
                  }}
                >
                  {ru.miniApp.admin.ban}
                </Button>
              )}
              <Button
                variant="secondary"
                onClick={() => {
                  const value = window.prompt(ru.miniApp.admin.premiumDaysPrompt, '7');
                  const days = Number(value);
                  if (Number.isInteger(days) && days > 0)
                    premium.mutate({
                      userId: user.id,
                      durationDays: days,
                      reason: ru.miniApp.admin.ownerGrantReason,
                    });
                }}
              >
                {ru.miniApp.admin.grantPremium}
              </Button>
              <Button variant="secondary" onClick={() => revokePremium.mutate(user.id)}>
                {ru.miniApp.admin.revokePremium}
              </Button>
              <Button
                variant="secondary"
                onClick={() =>
                  moderate.mutate({
                    userId: user.id,
                    action: 'reset_captcha',
                    reason: ru.miniApp.admin.ownerResetCaptchaReason,
                  })
                }
              >
                {ru.miniApp.admin.resetCaptcha}
              </Button>
              <Button
                variant="secondary"
                onClick={() => {
                  const reason = window.prompt(ru.miniApp.admin.warningReasonPrompt);
                  if (reason) moderate.mutate({ userId: user.id, action: 'warn', reason });
                }}
              >
                {ru.miniApp.admin.warn}
              </Button>
              {!user.is_banned ? (
                <Button
                  variant="secondary"
                  onClick={() => {
                    const reason = window.prompt(ru.miniApp.admin.temporaryBanReasonPrompt);
                    if (!reason) return;
                    const bannedUntil = new Date(Date.now() + 24 * 60 * 60 * 1_000).toISOString();
                    moderate.mutate({
                      userId: user.id,
                      action: 'temporary_ban',
                      reason,
                      bannedUntil,
                    });
                  }}
                >
                  {ru.miniApp.admin.temporaryBan}
                </Button>
              ) : null}
              <Button
                variant="secondary"
                onClick={() =>
                  moderate.mutate({
                    userId: user.id,
                    action: 'disable_profile',
                    reason: ru.miniApp.admin.ownerDisableProfileReason,
                  })
                }
              >
                {ru.miniApp.admin.disableProfile}
              </Button>
            </div>
            <MutationFeedback
              states={[moderate, premium, revokePremium]}
              success={ru.miniApp.admin.actionCompleted}
            />
          </Card>
        ))}
      </div>
    </div>
  );
}

function ProfilesQueue() {
  const queryClient = useQueryClient();
  const profiles = useQuery({
    queryKey: ['admin-profiles'],
    queryFn: () => api.adminProfiles('all'),
  });
  const moderate = useMutation({
    mutationFn: (input: {
      profileId: string;
      status: 'approved' | 'rejected' | 'paused' | 'archived';
      reason: string;
    }) => api.adminModerateProfile(input.profileId, input.status, input.reason),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['admin-profiles'] }),
  });
  if (profiles.isLoading) return <Skeleton className="h-72" />;
  if (profiles.isError)
    return <AdminRequestError error={profiles.error} retry={() => profiles.refetch()} />;
  return (
    <div className="space-y-3">
      {profiles.data?.map((profile) => (
        <Card key={profile.id} className="p-4">
          <div className="flex justify-between gap-3">
            <div>
              <strong>{profile.display_name}</strong>
              <p className="text-sm text-muted">
                {ru.miniApp.admin.telegramUser(profile.telegram_user_id)} · risk{' '}
                {profile.risk_score}
              </p>
            </div>
            <span className="status-pill">{profile.moderation_status}</span>
          </div>
          <h3 className="mt-3 font-semibold">{profile.short_headline}</h3>
          <p className="mt-2 line-clamp-4 text-sm text-soft">{profile.about}</p>
          <div className="mt-3 flex flex-wrap gap-2">
            <Button
              onClick={() =>
                moderate.mutate({
                  profileId: profile.id,
                  status: 'approved',
                  reason: ru.miniApp.admin.ownerApprovedReason,
                })
              }
            >
              {ru.miniApp.admin.approve}
            </Button>
            <Button
              variant="secondary"
              onClick={() => {
                const reason = window.prompt(ru.miniApp.admin.rejectionReasonPrompt);
                if (reason) moderate.mutate({ profileId: profile.id, status: 'rejected', reason });
              }}
            >
              {ru.miniApp.admin.reject}
            </Button>
            <Button
              variant="secondary"
              onClick={() =>
                moderate.mutate({
                  profileId: profile.id,
                  status: 'archived',
                  reason: ru.miniApp.admin.ownerArchivedReason,
                })
              }
            >
              {ru.miniApp.admin.archive}
            </Button>
            <Button
              variant="secondary"
              onClick={() =>
                moderate.mutate({
                  profileId: profile.id,
                  status: 'paused',
                  reason: ru.miniApp.admin.ownerPausedReason,
                })
              }
            >
              {ru.miniApp.admin.pauseProfile}
            </Button>
          </div>
        </Card>
      ))}
      <MutationFeedback states={[moderate]} success={ru.miniApp.admin.actionCompleted} />
      <MediaQueue />
    </div>
  );
}

function MediaQueue() {
  const queryClient = useQueryClient();
  const media = useQuery({
    queryKey: ['admin-media'],
    queryFn: () => api.adminMedia('pending'),
  });
  const moderate = useMutation({
    mutationFn: (input: { mediaId: string; status: 'approved' | 'rejected'; reason: string }) =>
      api.adminModerateMedia(input.mediaId, input.status, input.reason),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['admin-media'] }),
  });
  if (media.isLoading) return <Skeleton className="mt-6 h-72" />;
  if (media.isError) return <AdminRequestError error={media.error} retry={() => media.refetch()} />;
  return (
    <section className="mt-6">
      <h2 className="font-display text-2xl">{ru.miniApp.admin.mediaQueueTitle}</h2>
      <div className="mt-3 grid gap-3 sm:grid-cols-2">
        {media.data?.map((item) => (
          <Card className="overflow-hidden" key={item.id}>
            <img
              className="aspect-square w-full object-cover"
              src={`/api/profile-media/${item.id}`}
              alt=""
              loading="lazy"
            />
            <div className="p-4">
              <strong>{item.display_name}</strong>
              <p className="text-xs text-muted">
                {ru.miniApp.admin.telegramUser(item.telegram_user_id)}
              </p>
              <div className="mt-3 flex gap-2">
                <Button
                  onClick={() =>
                    moderate.mutate({
                      mediaId: item.id,
                      status: 'approved',
                      reason: ru.miniApp.admin.mediaApprovedReason,
                    })
                  }
                >
                  {ru.miniApp.admin.approve}
                </Button>
                <Button
                  variant="secondary"
                  onClick={() => {
                    const reason = window.prompt(ru.miniApp.admin.mediaRejectedReasonPrompt);
                    if (reason) moderate.mutate({ mediaId: item.id, status: 'rejected', reason });
                  }}
                >
                  {ru.miniApp.admin.reject}
                </Button>
              </div>
            </div>
          </Card>
        ))}
      </div>
      <MutationFeedback states={[moderate]} success={ru.miniApp.admin.actionCompleted} />
    </section>
  );
}

function ReportsQueue() {
  const queryClient = useQueryClient();
  const reports = useQuery({
    queryKey: ['admin-reports'],
    queryFn: () => api.adminReports('all'),
  });
  const resolve = useMutation({
    mutationFn: (input: {
      reportId: string;
      status: 'reviewing' | 'resolved' | 'dismissed';
      resolution: string;
    }) => api.adminResolveReport(input.reportId, input.status, input.resolution),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['admin-reports'] }),
  });
  if (reports.isLoading) return <Skeleton className="h-72" />;
  if (reports.isError)
    return <AdminRequestError error={reports.error} retry={() => reports.refetch()} />;
  return (
    <div className="space-y-3">
      {reports.data?.map((report) => (
        <Card key={report.id} className="p-4">
          <div className="flex justify-between gap-3">
            <strong>{report.category}</strong>
            <span className="status-pill">{report.status}</span>
          </div>
          <p className="mt-2 text-sm text-soft">
            {report.description || ru.miniApp.admin.noComment}
          </p>
          <p className="mt-2 text-xs text-muted">
            {ru.miniApp.admin.reportedUser}{' '}
            {report.reported_display_name ?? report.reported_telegram_id}
          </p>
          <div className="mt-3 flex gap-2">
            {report.status === 'open' ? (
              <Button
                variant="secondary"
                onClick={() =>
                  resolve.mutate({
                    reportId: report.id,
                    status: 'reviewing',
                    resolution: ru.miniApp.admin.reviewStarted,
                  })
                }
              >
                {ru.miniApp.admin.startReview}
              </Button>
            ) : null}
            <Button
              onClick={() =>
                resolve.mutate({
                  reportId: report.id,
                  status: 'resolved',
                  resolution:
                    window.prompt(
                      ru.miniApp.admin.resolutionPrompt,
                      ru.miniApp.admin.violationConfirmed,
                    ) ?? '',
                })
              }
            >
              {ru.miniApp.admin.close}
            </Button>
            <Button
              variant="secondary"
              onClick={() =>
                resolve.mutate({
                  reportId: report.id,
                  status: 'dismissed',
                  resolution: ru.miniApp.admin.violationNotConfirmed,
                })
              }
            >
              {ru.miniApp.admin.dismiss}
            </Button>
          </div>
        </Card>
      ))}
      <MutationFeedback states={[resolve]} success={ru.miniApp.admin.actionCompleted} />
    </div>
  );
}

function Payments() {
  const queryClient = useQueryClient();
  const [status, setStatus] = useState<
    'all' | 'pending' | 'precheckout_approved' | 'paid' | 'refunded' | 'failed' | 'expired'
  >('all');
  const payments = useQuery({
    queryKey: ['admin-payments', status],
    queryFn: () => api.adminPayments(status),
  });
  const products = useQuery({ queryKey: ['admin-products'], queryFn: api.adminProducts });
  const refund = useMutation({
    mutationFn: api.adminRefundPayment,
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ['admin-payments'] });
      void queryClient.invalidateQueries({ queryKey: ['admin-products'] });
    },
  });
  if (payments.isLoading || products.isLoading) return <Skeleton className="h-72" />;
  if (payments.isError)
    return <AdminRequestError error={payments.error} retry={() => payments.refetch()} />;
  if (products.isError)
    return <AdminRequestError error={products.error} retry={() => products.refetch()} />;
  return (
    <div className="space-y-6">
      <section>
        <h2 className="font-display text-2xl">{ru.miniApp.admin.productsTitle}</h2>
        <p className="mt-1 text-xs text-muted">{ru.miniApp.admin.productsDescription}</p>
        <div className="mt-3 space-y-3">
          {products.data?.map((product) => (
            <ProductEditor key={product.id} product={product} />
          ))}
        </div>
      </section>
      <section>
        <div className="admin-toolbar">
          <h2 className="font-display text-2xl">{ru.miniApp.admin.paymentHistory}</h2>
          <select
            className="input-field admin-filter"
            aria-label={ru.miniApp.admin.paymentStatusFilter}
            value={status}
            onChange={(event) => setStatus(event.target.value as typeof status)}
          >
            {Object.entries(ru.miniApp.admin.paymentStatuses).map(([value, label]) => (
              <option key={value} value={value}>
                {label}
              </option>
            ))}
          </select>
        </div>
        {payments.data?.map((payment) => (
          <Card key={payment.id} className="mt-3 p-4">
            <div className="flex justify-between gap-3">
              <span className="flex items-center gap-2">
                <Star className="h-4 w-4 text-lilac" />
                <strong>{payment.product_name}</strong>
              </span>
              <span className={`status-pill status-${payment.status}`}>
                {ru.miniApp.admin.paymentStatuses[payment.status] ?? payment.status}
              </span>
            </div>
            <p className="mt-2 text-sm text-soft">
              {payment.amount} {payment.currency} · Telegram {payment.telegram_user_id}
            </p>
            <p className="mt-1 text-xs text-muted">
              {ru.miniApp.admin.paymentCreated}: {formatAdminDate(payment.created_at)}
            </p>
            {payment.status === 'pending' || payment.status === 'precheckout_approved' ? (
              <p className="mt-1 text-xs text-muted">
                {ru.miniApp.admin.paymentExpires}: {formatAdminDate(payment.expires_at)}
              </p>
            ) : null}
            {payment.paid_at ? (
              <p className="mt-1 text-xs text-muted">
                {ru.miniApp.admin.paymentPaid}: {formatAdminDate(payment.paid_at)}
              </p>
            ) : null}
            {payment.entitlement_ends_at ? (
              <p className="mt-1 text-xs text-muted">
                {ru.miniApp.admin.premiumUntil}: {formatAdminDate(payment.entitlement_ends_at)}
              </p>
            ) : null}
            {payment.status === 'paid' ? (
              <Button
                className="mt-3"
                variant="secondary"
                disabled={refund.isPending}
                onClick={() => {
                  if (window.confirm(ru.miniApp.admin.refundConfirmation(payment.amount))) {
                    refund.mutate(payment.id);
                  }
                }}
              >
                {ru.miniApp.admin.refund}
              </Button>
            ) : null}
          </Card>
        ))}
        {!payments.data?.length ? <Card className="p-4">{ru.miniApp.admin.noData}</Card> : null}
        <MutationFeedback states={[refund]} success={ru.miniApp.admin.refundCompleted} />
      </section>
    </div>
  );
}

function ProductEditor({ product }: { product: Product }) {
  const queryClient = useQueryClient();
  const [starsAmount, setStarsAmount] = useState(product.stars_amount);
  const [isActive, setIsActive] = useState(Boolean(product.is_active));
  const update = useMutation({
    mutationFn: () => api.adminUpdateProduct(product.id, starsAmount, isActive),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ['admin-products'] });
      void queryClient.invalidateQueries({ queryKey: ['products'] });
    },
  });
  return (
    <Card className="p-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <strong>{product.name}</strong>
          <p className="text-xs text-muted">
            {product.duration_days} {ru.miniApp.admin.days} · {product.billing_type}
          </p>
        </div>
        <label className="flex items-center gap-2 text-sm text-soft">
          {ru.miniApp.admin.productEnabled}
          <input
            type="checkbox"
            checked={isActive}
            onChange={(event) => setIsActive(event.target.checked)}
          />
        </label>
      </div>
      <div className="mt-3 flex items-end gap-2">
        <label className="min-w-0 flex-1 text-xs text-muted">
          {ru.miniApp.admin.starsPrice}
          <input
            className="input-field mt-1"
            type="number"
            min={1}
            max={10_000}
            value={starsAmount}
            onChange={(event) => setStarsAmount(Number(event.target.value))}
          />
        </label>
        <Button
          disabled={!Number.isInteger(starsAmount) || starsAmount < 1 || starsAmount > 10_000}
          loading={update.isPending}
          onClick={() => update.mutate()}
        >
          {ru.miniApp.admin.saveProduct}
        </Button>
      </div>
      <MutationFeedback states={[update]} success={ru.miniApp.admin.productSaved} />
    </Card>
  );
}

function formatAdminDate(value: string) {
  const normalized = value.includes('T') ? value : `${value.replace(' ', 'T')}Z`;
  const date = new Date(normalized);
  return Number.isNaN(date.getTime()) ? value : date.toLocaleString('ru-RU');
}

function MutationFeedback({
  states,
  success,
}: {
  states: Array<{ isError: boolean; isSuccess: boolean; error: Error | null }>;
  success: string;
}) {
  const failed = states.find((state) => state.isError);
  if (failed?.error) return <p className="admin-action-error">{failed.error.message}</p>;
  if (states.some((state) => state.isSuccess))
    return <p className="admin-action-success">{success}</p>;
  return null;
}

function Referrals() {
  const queryClient = useQueryClient();
  const referrals = useQuery({
    queryKey: ['admin-referrals'],
    queryFn: () => api.adminReferrals(),
  });
  const review = useMutation({
    mutationFn: (input: { id: string; action: 'confirm' | 'reject' | 'revoke'; reason: string }) =>
      api.adminReviewReferral(input.id, input.action, input.reason),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['admin-referrals'] }),
  });
  if (referrals.isLoading) return <Skeleton className="h-72" />;
  if (referrals.isError)
    return <AdminRequestError error={referrals.error} retry={() => referrals.refetch()} />;
  return (
    <div className="space-y-3">
      <Button
        variant="secondary"
        onClick={() => {
          const rows = referrals.data ?? [];
          const csv = [
            ['id', 'status', 'referrer', 'referred', 'risk', 'reason'].join(','),
            ...rows.map((item) =>
              [
                item.id,
                item.status,
                item.referrer_telegram_id,
                item.referred_telegram_id,
                item.referred_risk_events_score,
                JSON.stringify(item.qualification_reason ?? ''),
              ].join(','),
            ),
          ].join('\n');
          const url = URL.createObjectURL(new Blob([csv], { type: 'text/csv;charset=utf-8' }));
          const link = document.createElement('a');
          link.href = url;
          link.download = 'rolemate-referrals.csv';
          link.click();
          URL.revokeObjectURL(url);
        }}
      >
        {ru.miniApp.admin.exportCsv}
      </Button>
      {referrals.data?.map((referral) => (
        <Card key={referral.id} className="p-4">
          <div className="flex justify-between gap-3">
            <strong>
              {referral.referrer_display_name ?? referral.referrer_telegram_id} →{' '}
              {referral.referred_display_name ?? referral.referred_telegram_id}
            </strong>
            <span className="status-pill">{referral.status}</span>
          </div>
          <p className="mt-2 text-sm text-soft">
            {ru.miniApp.admin.referralFrom}: {referral.referrer_telegram_id} ·{' '}
            {ru.miniApp.admin.referralTo}: {referral.referred_telegram_id}
          </p>
          <p className="mt-1 text-xs text-muted">
            {ru.miniApp.admin.referralRisk}: {referral.referred_risk_events_score}
          </p>
          <div className="mt-3 flex flex-wrap gap-2">
            {referral.status === 'pending' ? (
              <>
                <Button
                  onClick={() =>
                    review.mutate({
                      id: referral.id,
                      action: 'confirm',
                      reason: ru.miniApp.admin.referralConfirmReason,
                    })
                  }
                >
                  {ru.miniApp.admin.confirmReferral}
                </Button>
                <Button
                  variant="secondary"
                  onClick={() => {
                    const reason = window.prompt(ru.miniApp.admin.referralRejectPrompt);
                    if (reason) review.mutate({ id: referral.id, action: 'reject', reason });
                  }}
                >
                  {ru.miniApp.admin.rejectReferral}
                </Button>
              </>
            ) : null}
            {referral.status === 'qualified' ? (
              <Button
                variant="secondary"
                onClick={() => {
                  const reason = window.prompt(ru.miniApp.admin.referralRevokePrompt);
                  if (reason) review.mutate({ id: referral.id, action: 'revoke', reason });
                }}
              >
                {ru.miniApp.admin.revokeReferral}
              </Button>
            ) : null}
          </div>
        </Card>
      ))}
      {!referrals.data?.length ? <Card className="p-4">{ru.miniApp.admin.noData}</Card> : null}
      <MutationFeedback states={[review]} success={ru.miniApp.admin.actionCompleted} />
    </div>
  );
}

function Broadcasts() {
  const queryClient = useQueryClient();
  const [title, setTitle] = useState('');
  const [message, setMessage] = useState('');
  const [segment, setSegment] = useState<'all' | 'active' | 'premium' | 'nonpremium'>('all');
  const [rate, setRate] = useState(20);
  const [confirmations, setConfirmations] = useState<Record<string, string>>({});
  const broadcasts = useQuery({
    queryKey: ['admin-broadcasts'],
    queryFn: api.adminBroadcasts,
  });
  const refresh = () => queryClient.invalidateQueries({ queryKey: ['admin-broadcasts'] });
  const create = useMutation({
    mutationFn: api.adminCreateBroadcast,
    onSuccess: () => {
      setTitle('');
      setMessage('');
      void refresh();
    },
  });
  const dryRun = useMutation({
    mutationFn: api.adminBroadcastDryRun,
    onSuccess: (result, id) => {
      setConfirmations((current) => ({ ...current, [id]: result.confirmationPhrase }));
      void refresh();
    },
  });
  const control = useMutation({
    mutationFn: (input: { id: string; action: 'queue' | 'pause' | 'cancel'; phrase?: string }) =>
      api.adminControlBroadcast(input.id, input.action, input.phrase),
    onSuccess: refresh,
  });
  if (broadcasts.isLoading) return <Skeleton className="h-72" />;
  if (broadcasts.isError)
    return <AdminRequestError error={broadcasts.error} retry={() => broadcasts.refetch()} />;
  return (
    <div className="space-y-4">
      <Card className="p-4">
        <p className="mb-3 text-sm text-soft">{ru.miniApp.admin.broadcastSafety}</p>
        <div className="space-y-3">
          <input
            className="input-field"
            value={title}
            onChange={(event) => setTitle(event.target.value)}
            placeholder={ru.miniApp.admin.broadcastTitle}
          />
          <textarea
            className="input-field min-h-32"
            value={message}
            onChange={(event) => setMessage(event.target.value)}
            placeholder={ru.miniApp.admin.broadcastMessage}
          />
          <select
            className="input-field"
            value={segment}
            onChange={(event) => setSegment(event.target.value as typeof segment)}
          >
            {Object.entries(ru.miniApp.admin.broadcastSegments).map(([value, label]) => (
              <option key={value} value={value}>
                {label}
              </option>
            ))}
          </select>
          <label className="block text-sm text-soft">
            {ru.miniApp.admin.broadcastRate}
            <input
              className="input-field mt-1"
              type="number"
              min={1}
              max={30}
              value={rate}
              onChange={(event) => setRate(Number(event.target.value))}
            />
          </label>
          <Button
            disabled={title.length < 3 || message.length < 3 || create.isPending}
            onClick={() => create.mutate({ title, message, segment, rateLimitPerSecond: rate })}
          >
            <Send className="h-4 w-4" /> {ru.miniApp.admin.createDraft}
          </Button>
        </div>
      </Card>
      {broadcasts.data?.map((broadcast) => (
        <Card key={broadcast.id} className="p-4">
          <div className="flex justify-between gap-3">
            <strong>{broadcast.title}</strong>
            <span className="status-pill">{broadcast.status}</span>
          </div>
          <blockquote className="mt-3 border-l-2 border-accent pl-3 text-sm text-soft">
            {broadcast.message}
          </blockquote>
          <p className="mt-2 text-xs text-muted">
            {ru.miniApp.admin.recipients}: {broadcast.estimated_recipients} ·{' '}
            {ru.miniApp.admin.sent}: {broadcast.sent_count} · {ru.miniApp.admin.errors}:{' '}
            {broadcast.failed_count}
          </p>
          <div className="mt-3 flex flex-wrap gap-2">
            {['draft', 'paused'].includes(broadcast.status) ? (
              <Button variant="secondary" onClick={() => dryRun.mutate(broadcast.id)}>
                {ru.miniApp.admin.dryRun}
              </Button>
            ) : null}
            {confirmations[broadcast.id] ? (
              <Button
                onClick={() => {
                  const phrase = window.prompt(
                    ru.miniApp.admin.confirmationPrompt(confirmations[broadcast.id]!),
                  );
                  if (phrase) control.mutate({ id: broadcast.id, action: 'queue', phrase });
                }}
              >
                {ru.miniApp.admin.queueBroadcast}
              </Button>
            ) : null}
            {['queued', 'running'].includes(broadcast.status) ? (
              <Button
                variant="secondary"
                onClick={() => control.mutate({ id: broadcast.id, action: 'pause' })}
              >
                {ru.miniApp.admin.pauseBroadcast}
              </Button>
            ) : null}
            {!['completed', 'cancelled'].includes(broadcast.status) ? (
              <Button
                variant="secondary"
                onClick={() => control.mutate({ id: broadcast.id, action: 'cancel' })}
              >
                {ru.miniApp.admin.cancelBroadcast}
              </Button>
            ) : null}
          </div>
        </Card>
      ))}
      <MutationFeedback
        states={[create, dryRun, control]}
        success={ru.miniApp.admin.actionCompleted}
      />
    </div>
  );
}

function SystemStatus() {
  const system = useQuery({
    queryKey: ['admin-system'],
    queryFn: api.adminSystem,
    refetchInterval: 30_000,
  });
  if (system.isLoading) return <Skeleton className="h-72" />;
  if (system.isError)
    return <AdminRequestError error={system.error} retry={() => system.refetch()} />;
  const data = system.data;
  if (!data) return null;
  const labels = ru.miniApp.admin.systemLabels;
  const items = [
    [labels.api, data.api],
    [labels.d1, data.d1],
    [labels.version, data.version],
    [labels.commit, data.commitSha],
    [labels.environment, data.environment],
    [labels.uptime, data.uptimeSeconds],
    [
      labels.maintenance,
      data.maintenanceMode ? ru.miniApp.admin.enabled : ru.miniApp.admin.disabled,
    ],
    [labels.jobs, `${data.jobs.pending}/${data.jobs.running}/${data.jobs.failed}`],
    [labels.deadLetters, data.jobs.deadLetters],
    [labels.runtime, data.runtime?.provider ?? '—'],
    [labels.service, data.runtime?.service ?? '—'],
  ];
  return (
    <div className="space-y-4">
      <div className="admin-grid admin-system-grid">
        {items.map(([label, value]) => (
          <Card key={label} className="admin-stat">
            <Server />
            <strong className="admin-system-value">{value}</strong>
            <small>{label}</small>
          </Card>
        ))}
      </div>
      <div className="space-y-2">
        {data.lastFailures.map((failure) => (
          <Card key={`${failure.error_code}-${failure.created_at}`} className="p-4">
            <strong>{failure.error_code}</strong>
            <p className="text-sm text-soft">{failure.safe_message}</p>
            <small>{failure.created_at}</small>
          </Card>
        ))}
        {!data.lastFailures.length ? (
          <Card className="p-4">{ru.miniApp.admin.noSystemErrors}</Card>
        ) : null}
      </div>
    </div>
  );
}

function AdminRequestError({ error, retry }: { error: Error; retry: () => unknown }) {
  return (
    <Card className="admin-error-card">
      <AlertTriangle />
      <div>
        <strong>{ru.miniApp.admin.requestErrorTitle}</strong>
        <p>{error.message}</p>
        <Button className="mt-3" onClick={() => void retry()}>
          {ru.miniApp.admin.retrySection}
        </Button>
      </div>
    </Card>
  );
}

function Flags() {
  const queryClient = useQueryClient();
  const flags = useQuery({ queryKey: ['admin-flags'], queryFn: api.adminFlags });
  const config = useQuery({ queryKey: ['admin-config'], queryFn: api.adminConfig });
  const update = useMutation({
    mutationFn: (input: { key: string; enabled: boolean }) =>
      api.adminUpdateFlag(input.key, input.enabled),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['admin-flags'] }),
  });
  if (flags.isLoading || config.isLoading) return <Skeleton className="h-72" />;
  if (flags.isError) return <AdminRequestError error={flags.error} retry={() => flags.refetch()} />;
  if (config.isError)
    return <AdminRequestError error={config.error} retry={() => config.refetch()} />;
  return (
    <div className="space-y-6">
      <div className="space-y-3">
        {flags.data?.map((flag) => (
          <Card key={flag.key} className="setting-row">
            <span className="flex items-center gap-2">
              <Flag className="h-4 w-4" /> {flag.key}
            </span>
            <input
              type="checkbox"
              checked={Boolean(flag.enabled)}
              onChange={(event) => update.mutate({ key: flag.key, enabled: event.target.checked })}
              disabled={flag.key === 'yookassa_digital_premium'}
            />
          </Card>
        ))}
      </div>
      <MutationFeedback states={[update]} success={ru.miniApp.admin.actionCompleted} />
      <div className="space-y-3">
        {config.data?.map((item) => (
          <ConfigEditor key={item.key} item={item} />
        ))}
      </div>
    </div>
  );
}

function ConfigEditor({ item }: { item: AdminConfig }) {
  const queryClient = useQueryClient();
  const [value, setValue] = useState(item.value);
  const update = useMutation({
    mutationFn: () => api.adminUpdateConfig(item.key, value),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['admin-config'] }),
  });
  return (
    <Card className="p-4">
      <label className="block text-sm text-soft">
        {ru.miniApp.admin.configLabels[item.key]}
        {item.key.endsWith('_text') ? (
          <textarea
            className="input-field mt-2 min-h-24"
            value={value}
            onChange={(event) => setValue(event.target.value)}
          />
        ) : (
          <input
            className="input-field mt-2"
            type="number"
            min={1}
            max={100}
            value={value}
            onChange={(event) => setValue(event.target.value)}
          />
        )}
      </label>
      <Button className="mt-3" onClick={() => update.mutate()} loading={update.isPending}>
        {ru.miniApp.admin.saveConfig}
      </Button>
      <MutationFeedback states={[update]} success={ru.miniApp.admin.configSaved} />
    </Card>
  );
}

function AuditLog() {
  const audit = useQuery({ queryKey: ['admin-audit'], queryFn: api.adminAudit });
  if (audit.isLoading) return <Skeleton className="h-72" />;
  if (audit.isError) return <AdminRequestError error={audit.error} retry={() => audit.refetch()} />;
  return (
    <div className="space-y-3">
      {audit.data?.map((entry) => (
        <Card key={entry.id} className="p-4">
          <div className="flex justify-between gap-3">
            <strong>{entry.action}</strong>
            <span className="status-pill">{entry.result}</span>
          </div>
          <p className="mt-2 text-sm text-soft">{entry.reason}</p>
          <p className="mt-2 text-xs text-muted">
            {entry.created_at} · request {entry.request_id}
          </p>
        </Card>
      ))}
    </div>
  );
}
