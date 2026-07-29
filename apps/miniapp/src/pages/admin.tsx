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
import {
  api,
  type AdminConfig,
  type AdminPromotion,
  type AdminPromotionInput,
  type AdminPromotionUpdateInput,
  type PostingRequirementInput,
  type Product,
} from '../api.js';
import { Button, Card, SectionTitle, Skeleton } from '../components/ui.js';
import { ProfileAvatar } from '../components/profile-avatar.js';
import { ProfileMarkdown } from '../components/markdown.js';
import { useUserStore } from '../store.js';

type AdminSection =
  | 'dashboard'
  | 'users'
  | 'publicProfiles'
  | 'questionnaires'
  | 'posts'
  | 'reports'
  | 'payments'
  | 'referrals'
  | 'broadcasts'
  | 'flags'
  | 'system'
  | 'audit'
  | 'promotions'
  | 'postingRequirements'
  | 'moderators';

export function AdminPage() {
  const isAdmin = useUserStore((state) => state.user?.isAdmin);
  const isOwner = useUserStore((state) => state.user?.isOwner);
  const [section, setSection] = useState<AdminSection>(isOwner ? 'dashboard' : 'users');
  if (!isAdmin) return <Redirect to="/" replace />;
  const ownerSections = [
    ['dashboard', ru.miniApp.admin.sections[0]],
    ['payments', ru.miniApp.admin.sections[4]],
    ['referrals', ru.miniApp.admin.sections[5]],
    ['broadcasts', ru.miniApp.admin.sections[6]],
    ['flags', ru.miniApp.admin.sections[7]],
    ['system', ru.miniApp.admin.sections[8]],
    ['audit', ru.miniApp.admin.sections[9]],
    ['promotions', ru.miniApp.admin.sections[10]],
    ['postingRequirements', ru.miniApp.admin.sections[11]],
    ['moderators', ru.miniApp.admin.sections[12]],
  ] as const;
  const moderationSections = [
    ['users', ru.miniApp.admin.sections[1]],
    ['publicProfiles', ru.miniApp.admin.sections[13]],
    ['questionnaires', ru.miniApp.admin.sections[2]],
    ['posts', ru.miniApp.admin.sections[14]],
    ['reports', ru.miniApp.admin.sections[3]],
  ] as const;
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
        {[
          ...(isOwner ? ownerSections.slice(0, 1) : []),
          ...moderationSections,
          ...(isOwner ? ownerSections.slice(1) : []),
        ].map(([key, label]) => (
          <Button
            key={key}
            data-testid={`admin-section-${key}`}
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
          {section === 'users' ? <UsersQueue isOwner={Boolean(isOwner)} /> : null}
          {section === 'publicProfiles' ? <PublicProfilesQueue isOwner={Boolean(isOwner)} /> : null}
          {section === 'questionnaires' ? <QuestionnairesQueue /> : null}
          {section === 'posts' ? <PostsQueue /> : null}
          {section === 'reports' ? <ReportsQueue /> : null}
          {section === 'payments' ? <Payments /> : null}
          {section === 'referrals' ? <Referrals /> : null}
          {section === 'broadcasts' ? <Broadcasts /> : null}
          {section === 'flags' ? <Flags /> : null}
          {section === 'system' ? <SystemStatus /> : null}
          {section === 'audit' ? <AuditLog /> : null}
          {section === 'promotions' ? <Promotions /> : null}
          {section === 'postingRequirements' ? <PostingRequirements /> : null}
          {section === 'moderators' ? <Moderators /> : null}
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

function UsersQueue({ isOwner }: { isOwner: boolean }) {
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
                <strong>{user.telegram_first_name}</strong>
                <p className="text-sm text-muted">
                  {user.telegram_user_id}{' '}
                  {user.telegram_username ? `@${user.telegram_username}` : ''} ·{' '}
                  {ru.miniApp.admin.riskLabel} {user.risk_score}
                </p>
              </div>
              <span className="status-pill">
                {ru.miniApp.admin.userStatuses[user.is_banned ? 'banned' : user.status] ??
                  user.status}
              </span>
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
              {isOwner ? (
                <>
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
                </>
              ) : null}
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
                data-testid={`moderation-warn-${user.id}`}
                loading={moderate.isPending}
                disabled={moderate.isPending}
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

function PublicProfilesQueue({ isOwner }: { isOwner: boolean }) {
  const queryClient = useQueryClient();
  const [search, setSearch] = useState('');
  const profiles = useQuery({
    queryKey: ['admin-public-profiles', search],
    queryFn: () => api.adminPublicProfiles('all', search),
  });
  const moderate = useMutation({
    mutationFn: (input: { profileUserId: string; status: 'active' | 'blocked'; reason: string }) =>
      api.adminModeratePublicProfile(input.profileUserId, input.status, input.reason),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['admin-public-profiles'] }),
  });
  const replaceUsernames = useMutation({
    mutationFn: ({ userId, usernames }: { userId: string; usernames: string[] }) =>
      api.adminReplaceProfileUsernames(userId, usernames),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['admin-public-profiles'] }),
  });
  if (profiles.isLoading) return <Skeleton className="h-72" />;
  if (profiles.isError)
    return <AdminRequestError error={profiles.error} retry={() => profiles.refetch()} />;
  return (
    <div className="space-y-3">
      <label className="flex items-center gap-2">
        <Search className="h-4 w-4" />
        <input
          className="input-field"
          value={search}
          onChange={(event) => setSearch(event.target.value)}
          placeholder={ru.miniApp.admin.contentSearchPlaceholder}
        />
      </label>
      {profiles.data?.map((profile) => (
        <Card key={profile.id} className="p-4">
          <div className="flex items-start gap-3">
            <ProfileAvatar
              mediaId={profile.avatar_media_id}
              renderMode={profile.avatar_render_mode}
              name={profile.display_name}
            />
            <div className="min-w-0 flex-1">
              <strong className="break-words">{profile.display_name}</strong>
              <p className="mt-1 break-all text-xs text-muted">
                {ru.miniApp.admin.contentId(profile.id)}
              </p>
              <p className="text-xs text-muted">
                {ru.miniApp.admin.telegramUser(profile.telegram_user_id)} ·{' '}
                {ru.miniApp.admin.riskLabel} {profile.risk_score}
              </p>
            </div>
            <span className="status-pill">
              {ru.miniApp.admin.publicProfileStatuses[profile.moderation_status] ??
                profile.moderation_status}
            </span>
          </div>
          <p className="mt-3 whitespace-pre-wrap break-words text-sm text-soft">{profile.bio}</p>
          <p className="mt-3 text-xs text-muted">
            {ru.miniApp.social.questionnaireCount(profile.questionnaire_count)} ·{' '}
            {ru.miniApp.social.postCount(profile.post_count)}
          </p>
          <div className="mt-3 flex flex-wrap gap-2">
            {profile.moderation_status === 'blocked' ? (
              <Button
                loading={moderate.isPending}
                onClick={() =>
                  moderate.mutate({
                    profileUserId: profile.id,
                    status: 'active',
                    reason: ru.miniApp.admin.restorePublicProfileReason,
                  })
                }
              >
                {ru.miniApp.admin.restorePublicProfile}
              </Button>
            ) : (
              <Button
                variant="danger"
                loading={moderate.isPending}
                onClick={() => {
                  const reason = window.prompt(ru.miniApp.admin.blockPublicProfilePrompt)?.trim();
                  if (reason && reason.length >= 3) {
                    moderate.mutate({
                      profileUserId: profile.id,
                      status: 'blocked',
                      reason,
                    });
                  }
                }}
              >
                {ru.miniApp.admin.blockPublicProfile}
              </Button>
            )}
            {isOwner ? (
              <Button
                variant="secondary"
                loading={replaceUsernames.isPending}
                onClick={() => {
                  const current = (() => {
                    try {
                      const parsed: unknown = JSON.parse(profile.usernames ?? '[]');
                      return Array.isArray(parsed) ? parsed.join(', ') : '';
                    } catch {
                      return '';
                    }
                  })();
                  const value = window.prompt(ru.miniApp.admin.profileUsernamesPrompt, current);
                  if (value === null) return;
                  const usernames = Array.from(
                    new Set(
                      value
                        .split(',')
                        .map((item) => item.trim().replace(/^@/, '').toLowerCase())
                        .filter(Boolean),
                    ),
                  ).slice(0, 5);
                  replaceUsernames.mutate({ userId: profile.id, usernames });
                }}
              >
                {ru.miniApp.admin.manageProfileUsernames}
              </Button>
            ) : null}
          </div>
        </Card>
      ))}
      <MutationFeedback
        states={[moderate, replaceUsernames]}
        success={ru.miniApp.admin.actionCompleted}
      />
    </div>
  );
}

function PostsQueue() {
  const queryClient = useQueryClient();
  const [search, setSearch] = useState('');
  const posts = useQuery({
    queryKey: ['admin-posts', search],
    queryFn: () => api.adminPosts('all', search),
  });
  const moderate = useMutation({
    mutationFn: (input: {
      postId: string;
      status: 'active' | 'blocked' | 'limited' | 'shadow_banned';
      reason: string;
    }) => api.adminModeratePost(input.postId, input.status, input.reason),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['admin-posts'] }),
  });
  if (posts.isLoading) return <Skeleton className="h-72" />;
  if (posts.isError) return <AdminRequestError error={posts.error} retry={() => posts.refetch()} />;
  return (
    <div className="space-y-3">
      <label className="flex items-center gap-2">
        <Search className="h-4 w-4" />
        <input
          className="input-field"
          value={search}
          onChange={(event) => setSearch(event.target.value)}
          placeholder={ru.miniApp.admin.contentSearchPlaceholder}
        />
      </label>
      {posts.data?.map((post) => (
        <Card key={post.id} className="p-4">
          <div className="flex items-start justify-between gap-3">
            <div className="min-w-0">
              <strong className="break-words">{post.display_name || post.author_user_id}</strong>
              <p className="mt-1 break-all text-xs text-muted">
                {ru.miniApp.admin.contentId(post.id)}
              </p>
              <p className="text-xs text-muted">
                {ru.miniApp.admin.telegramUser(post.telegram_user_id)} · {post.content_type}
              </p>
            </div>
            <span className="status-pill">
              {ru.miniApp.admin.postStatuses[post.status] ?? post.status}
            </span>
            <span className="status-pill">
              {ru.miniApp.admin.reachStatuses[post.reach_status] ?? post.reach_status}
            </span>
          </div>
          <p className="mt-3 whitespace-pre-wrap break-words text-sm text-soft">
            {post.text_preview || ru.miniApp.admin.noComment}
          </p>
          <div className="mt-3 flex flex-wrap gap-2">
            {post.status === 'blocked' ? (
              <Button
                loading={moderate.isPending}
                onClick={() =>
                  moderate.mutate({
                    postId: post.id,
                    status: 'active',
                    reason: ru.miniApp.admin.restorePostReason,
                  })
                }
              >
                {ru.miniApp.admin.restorePost}
              </Button>
            ) : null}
            {post.status === 'active' ? (
              <>
                <Button
                  variant="secondary"
                  loading={moderate.isPending}
                  onClick={() =>
                    moderate.mutate({
                      postId: post.id,
                      status: 'limited',
                      reason: ru.miniApp.admin.limitPostReason,
                    })
                  }
                >
                  {ru.miniApp.admin.limitPost}
                </Button>
                <Button
                  variant="secondary"
                  loading={moderate.isPending}
                  onClick={() =>
                    moderate.mutate({
                      postId: post.id,
                      status: 'shadow_banned',
                      reason: ru.miniApp.admin.shadowBanPostReason,
                    })
                  }
                >
                  {ru.miniApp.admin.shadowBanPost}
                </Button>
                <Button
                  variant="danger"
                  loading={moderate.isPending}
                  onClick={() => {
                    const reason = window.prompt(ru.miniApp.admin.blockPostPrompt)?.trim();
                    if (reason && reason.length >= 3) {
                      moderate.mutate({ postId: post.id, status: 'blocked', reason });
                    }
                  }}
                >
                  {ru.miniApp.admin.blockPost}
                </Button>
              </>
            ) : null}
            {post.status === 'active' && post.reach_status !== 'normal' ? (
              <Button
                loading={moderate.isPending}
                onClick={() =>
                  moderate.mutate({
                    postId: post.id,
                    status: 'active',
                    reason: ru.miniApp.admin.restorePostReachReason,
                  })
                }
              >
                {ru.miniApp.admin.restorePostReach}
              </Button>
            ) : null}
          </div>
        </Card>
      ))}
      <MutationFeedback states={[moderate]} success={ru.miniApp.admin.actionCompleted} />
    </div>
  );
}

function QuestionnairesQueue() {
  const queryClient = useQueryClient();
  const [search, setSearch] = useState('');
  const profiles = useQuery({
    queryKey: ['admin-questionnaires', search],
    queryFn: () => api.adminQuestionnaires('all', search),
  });
  const moderate = useMutation({
    mutationFn: (input: {
      profileId: string;
      status: 'approved' | 'rejected' | 'paused' | 'archived';
      reason: string;
    }) => api.adminModerateQuestionnaire(input.profileId, input.status, input.reason),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['admin-questionnaires'] }),
  });
  if (profiles.isLoading) return <Skeleton className="h-72" />;
  if (profiles.isError)
    return <AdminRequestError error={profiles.error} retry={() => profiles.refetch()} />;
  return (
    <div className="space-y-3">
      <label className="flex items-center gap-2">
        <Search className="h-4 w-4" />
        <input
          className="input-field"
          value={search}
          onChange={(event) => setSearch(event.target.value)}
          placeholder={ru.miniApp.admin.contentSearchPlaceholder}
        />
      </label>
      {profiles.data?.map((profile) => (
        <Card key={profile.id} className="p-4">
          <div className="flex justify-between gap-3">
            <div>
              <strong>{profile.display_name}</strong>
              <p className="break-all text-xs text-muted">
                {ru.miniApp.admin.contentId(profile.id)}
              </p>
              <p className="text-sm text-muted">
                {ru.miniApp.admin.telegramUser(profile.telegram_user_id)} ·{' '}
                {ru.miniApp.admin.riskLabel} {profile.risk_score}
              </p>
            </div>
            <span className="status-pill">
              {ru.miniApp.admin.profileStatuses[profile.moderation_status] ??
                profile.moderation_status}
            </span>
          </div>
          <h3 className="mt-3 font-semibold">{profile.short_headline}</h3>
          <p className="mt-2 line-clamp-4 text-sm text-soft">{profile.about}</p>
          <div className="mt-3 flex flex-wrap gap-2">
            <Button
              loading={moderate.isPending}
              disabled={moderate.isPending}
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
              loading={moderate.isPending}
              disabled={moderate.isPending}
              onClick={() => {
                const reason = window.prompt(ru.miniApp.admin.rejectionReasonPrompt);
                if (reason) moderate.mutate({ profileId: profile.id, status: 'rejected', reason });
              }}
            >
              {ru.miniApp.admin.reject}
            </Button>
            <Button
              variant="secondary"
              loading={moderate.isPending}
              disabled={moderate.isPending}
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
              loading={moderate.isPending}
              disabled={moderate.isPending}
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
            <ModerationMediaPreview item={item} />
            <div className="p-4">
              <strong>{item.display_name}</strong>
              <p className="text-xs text-muted">
                {ru.miniApp.admin.telegramUser(item.telegram_user_id)}
              </p>
              <div className="mt-3 flex gap-2">
                <Button
                  loading={moderate.isPending}
                  disabled={moderate.isPending}
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
                  loading={moderate.isPending}
                  disabled={moderate.isPending}
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

function ModerationMediaPreview({
  item,
}: {
  item: {
    id: string;
    media_type: 'photo' | 'animation' | 'video' | 'audio' | 'voice' | 'document';
  };
}) {
  const [failed, setFailed] = useState(false);
  const [attempt, setAttempt] = useState(0);
  const source = `/api/profile-media/${item.id}?attempt=${attempt}`;
  if (failed) {
    return (
      <div className="flex aspect-square flex-col items-center justify-center gap-3 p-4 text-center">
        <AlertTriangle className="h-7 w-7 text-red-300" />
        <p className="text-sm text-soft">{ru.miniApp.admin.mediaLoadFailed}</p>
        <Button
          variant="secondary"
          onClick={() => {
            setAttempt((value) => value + 1);
            setFailed(false);
          }}
        >
          {ru.miniApp.admin.retryMedia}
        </Button>
      </div>
    );
  }
  if (item.media_type === 'video') {
    return (
      <video
        className="aspect-square w-full bg-black object-contain"
        src={source}
        controls
        playsInline
        preload="metadata"
        onError={() => setFailed(true)}
      />
    );
  }
  if (item.media_type === 'audio' || item.media_type === 'voice') {
    return (
      <div className="flex aspect-square items-center p-4">
        <audio
          className="w-full"
          src={source}
          controls
          preload="metadata"
          onError={() => setFailed(true)}
        />
      </div>
    );
  }
  if (item.media_type === 'document') {
    return (
      <a
        className="flex aspect-square items-center justify-center p-4 text-lilac underline"
        href={source}
      >
        {ru.miniApp.profile.openMedia}
      </a>
    );
  }
  return (
    <img
      className="aspect-square w-full object-cover"
      src={source}
      alt=""
      loading="lazy"
      onError={() => setFailed(true)}
    />
  );
}

function ReportsQueue() {
  const queryClient = useQueryClient();
  const [expandedReportId, setExpandedReportId] = useState<string | null>(null);
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
  const disableProfile = useMutation({
    mutationFn: (userId: string) =>
      api.adminModerateUser(userId, {
        action: 'disable_profile',
        reason: ru.miniApp.admin.reportProfileDisabledReason,
      }),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ['admin-reports'] });
      void queryClient.invalidateQueries({ queryKey: ['admin-questionnaires'] });
      void queryClient.invalidateQueries({ queryKey: ['admin-public-profiles'] });
    },
  });
  if (reports.isLoading) return <Skeleton className="h-72" />;
  if (reports.isError)
    return <AdminRequestError error={reports.error} retry={() => reports.refetch()} />;
  return (
    <div className="space-y-3">
      {reports.data?.map((report) => (
        <Card key={report.id} className="p-4">
          <div className="flex justify-between gap-3">
            <strong>{ru.bot.reportCategories[report.category] ?? report.category}</strong>
            <span className="status-pill">
              {ru.miniApp.admin.reportStatuses[report.status] ?? report.status}
            </span>
          </div>
          <p className="mt-2 text-sm text-soft">
            {report.description || ru.miniApp.admin.noComment}
          </p>
          <p className="mt-2 text-xs text-muted">
            {ru.miniApp.admin.reportedUser}{' '}
            {report.reported_display_name ?? report.reported_telegram_id}
          </p>
          <Button
            className="mt-3"
            variant="secondary"
            onClick={() =>
              setExpandedReportId((current) => (current === report.id ? null : report.id))
            }
          >
            {expandedReportId === report.id
              ? ru.miniApp.admin.collapseReport
              : ru.miniApp.admin.expandReport}
          </Button>
          {expandedReportId === report.id ? (
            <div className="mt-3 rounded-2xl border border-white/10 bg-black/15 p-4">
              <strong>{ru.miniApp.admin.reportContextTitle}</strong>
              {report.target_title ? (
                <p className="mt-2 whitespace-pre-wrap break-words text-sm">
                  {report.target_title}
                </p>
              ) : null}
              {report.target_body && report.target_body !== report.target_title ? (
                <ProfileMarkdown className="mt-2 break-words text-sm text-soft" allowLinks={false}>
                  {report.target_body}
                </ProfileMarkdown>
              ) : null}
              {report.target_type === 'conversation' ? (
                <p className="mt-2 text-xs text-muted">
                  {ru.miniApp.admin.reportConversationPrivacy}
                </p>
              ) : null}
              <div className="mt-3 space-y-2">
                {parseReportContext(report.context_items).map((item, index) => (
                  <div
                    className={`rounded-xl border border-white/10 p-3 ${
                      item.parentCommentId ? 'ml-5' : ''
                    }`}
                    key={item.id ?? `${report.id}-${index}`}
                  >
                    {item.displayName ? (
                      <strong className="text-sm">{item.displayName}</strong>
                    ) : null}
                    {item.body ? (
                      <p className="mt-1 whitespace-pre-wrap break-words text-sm">{item.body}</p>
                    ) : null}
                    {item.messageType ? <p className="text-sm">{item.messageType}</p> : null}
                    {item.createdAt ? (
                      <p className="mt-1 text-xs text-muted">
                        {new Date(item.createdAt).toLocaleString('ru-RU')}
                      </p>
                    ) : null}
                  </div>
                ))}
              </div>
            </div>
          ) : null}
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
            <Button
              variant="secondary"
              onClick={() => disableProfile.mutate(report.reported_user_id)}
              loading={disableProfile.isPending}
            >
              {ru.miniApp.admin.blockFromReport}
            </Button>
          </div>
        </Card>
      ))}
      <MutationFeedback
        states={[resolve, disableProfile]}
        success={ru.miniApp.admin.actionCompleted}
      />
    </div>
  );
}

function parseReportContext(value: string): Array<{
  id?: string;
  parentCommentId?: string | null;
  body?: string;
  displayName?: string;
  messageType?: string;
  createdAt?: string;
}> {
  try {
    const parsed: unknown = JSON.parse(value || '[]');
    if (!Array.isArray(parsed)) return [];
    return parsed.flatMap((item) => {
      if (typeof item !== 'object' || item === null) return [];
      const record = item as Record<string, unknown>;
      return [
        {
          ...(typeof record.id === 'string' ? { id: record.id } : {}),
          ...(typeof record.parent_comment_id === 'string' || record.parent_comment_id === null
            ? { parentCommentId: record.parent_comment_id }
            : {}),
          ...(typeof record.body === 'string' ? { body: record.body } : {}),
          ...(typeof record.display_name === 'string' ? { displayName: record.display_name } : {}),
          ...(typeof record.message_type === 'string' ? { messageType: record.message_type } : {}),
          ...(typeof record.created_at === 'string' ? { createdAt: record.created_at } : {}),
        },
      ];
    });
  } catch {
    return [];
  }
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

function Promotions() {
  const queryClient = useQueryClient();
  const promotions = useQuery({ queryKey: ['admin-promotions'], queryFn: api.adminPromotions });
  const products = useQuery({ queryKey: ['admin-products'], queryFn: api.adminProducts });
  const emptyForm: AdminPromotionInput = {
    code: '',
    type: 'discount',
    discountStars: 0,
    discountRubles: 0,
    premiumDays: 0,
    eligibleProductIds: [],
  };
  const [form, setForm] = useState<AdminPromotionInput>(emptyForm);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editingActive, setEditingActive] = useState(true);
  const promotionInput = (
    promotion: AdminPromotion,
    isActive = Boolean(promotion.is_active),
  ): AdminPromotionUpdateInput => {
    let eligibleProductIds: string[] = [];
    try {
      const parsed: unknown = JSON.parse(promotion.eligible_product_ids);
      if (Array.isArray(parsed))
        eligibleProductIds = parsed.filter((item): item is string => typeof item === 'string');
    } catch {
      eligibleProductIds = [];
    }
    return {
      code: promotion.code,
      type: promotion.type,
      discountStars: promotion.discount_stars,
      discountRubles: promotion.discount_rubles,
      premiumDays: promotion.premium_days,
      eligibleProductIds,
      expiresAt: promotion.expires_at ?? null,
      maxActivations: promotion.max_activations ?? null,
      isActive,
    };
  };
  const resetForm = () => {
    setForm(emptyForm);
    setEditingId(null);
    setEditingActive(true);
  };
  const create = useMutation({
    mutationFn: api.adminCreatePromotion,
    onSuccess: () => {
      resetForm();
      void queryClient.invalidateQueries({ queryKey: ['admin-promotions'] });
    },
  });
  const update = useMutation({
    mutationFn: ({ id, input }: { id: string; input: AdminPromotionUpdateInput }) =>
      api.adminUpdatePromotion(id, input),
    onSuccess: () => {
      resetForm();
      void queryClient.invalidateQueries({ queryKey: ['admin-promotions'] });
    },
  });
  const remove = useMutation({
    mutationFn: api.adminDeletePromotion,
    onSuccess: () => void queryClient.invalidateQueries({ queryKey: ['admin-promotions'] }),
  });
  if (promotions.isLoading || products.isLoading) return <Skeleton className="h-72" />;
  return (
    <div className="space-y-4">
      <Card className="space-y-3 p-4">
        <h2 className="font-display text-2xl">
          {editingId ? ru.miniApp.admin.promoEdit : ru.miniApp.admin.promoCreate}
        </h2>
        <input
          className="input-field"
          value={form.code}
          onChange={(event) => setForm({ ...form, code: event.target.value.toUpperCase() })}
          placeholder={ru.miniApp.admin.promoCode}
        />
        <select
          className="input-field"
          value={form.type}
          onChange={(event) =>
            setForm({ ...form, type: event.target.value as AdminPromotionInput['type'] })
          }
        >
          <option value="discount">{ru.miniApp.admin.promoDiscount}</option>
          <option value="premium_days">{ru.miniApp.admin.promoPremiumDays}</option>
        </select>
        {form.type === 'discount' ? (
          <div className="grid gap-3 sm:grid-cols-2">
            <input
              className="input-field"
              type="number"
              min={0}
              value={form.discountStars}
              onChange={(event) => setForm({ ...form, discountStars: Number(event.target.value) })}
              placeholder={ru.miniApp.admin.discountStars}
            />
            <input
              className="input-field"
              type="number"
              min={0}
              value={form.discountRubles}
              onChange={(event) => setForm({ ...form, discountRubles: Number(event.target.value) })}
              placeholder={ru.miniApp.admin.discountRubles}
            />
          </div>
        ) : (
          <input
            className="input-field"
            type="number"
            min={1}
            value={form.premiumDays}
            onChange={(event) => setForm({ ...form, premiumDays: Number(event.target.value) })}
            placeholder={ru.miniApp.admin.premiumDays}
          />
        )}
        {form.type === 'discount' ? (
          <div>
            <strong className="text-sm">{ru.miniApp.admin.eligiblePlans}</strong>
            <div className="mt-2 flex flex-wrap gap-2">
              {products.data?.map((product) => (
                <label className="tag" key={product.id}>
                  <input
                    type="checkbox"
                    checked={form.eligibleProductIds.includes(product.id)}
                    onChange={(event) =>
                      setForm({
                        ...form,
                        eligibleProductIds: event.target.checked
                          ? [...form.eligibleProductIds, product.id]
                          : form.eligibleProductIds.filter((id) => id !== product.id),
                      })
                    }
                  />{' '}
                  {product.name}
                </label>
              ))}
            </div>
          </div>
        ) : null}
        <input
          className="input-field"
          type="datetime-local"
          value={form.expiresAt ? form.expiresAt.slice(0, 16) : ''}
          onChange={(event) => {
            const next = { ...form };
            if (event.target.value) next.expiresAt = new Date(event.target.value).toISOString();
            else delete next.expiresAt;
            setForm(next);
          }}
        />
        <input
          className="input-field"
          type="number"
          min={1}
          value={form.maxActivations ?? ''}
          onChange={(event) => {
            const next = { ...form };
            if (event.target.value) next.maxActivations = Number(event.target.value);
            else delete next.maxActivations;
            setForm(next);
          }}
          placeholder={ru.miniApp.admin.maxActivations}
        />
        <Button
          data-testid={editingId ? 'promotion-save' : 'promotion-create'}
          onClick={() =>
            editingId
              ? update.mutate({
                  id: editingId,
                  input: {
                    ...form,
                    expiresAt: form.expiresAt ?? null,
                    maxActivations: form.maxActivations ?? null,
                    isActive: editingActive,
                  },
                })
              : create.mutate(form)
          }
          loading={create.isPending || update.isPending}
          disabled={
            form.code.trim().length < 3 ||
            (form.type === 'discount' &&
              (form.eligibleProductIds.length === 0 ||
                (form.discountStars === 0 && form.discountRubles === 0))) ||
            (form.type === 'premium_days' && form.premiumDays === 0)
          }
        >
          {editingId ? ru.miniApp.admin.savePromo : ru.miniApp.admin.create}
        </Button>
        {editingId ? (
          <Button variant="secondary" onClick={resetForm}>
            {ru.miniApp.admin.cancelPromoEdit}
          </Button>
        ) : null}
        <MutationFeedback states={[create, update]} success={ru.miniApp.admin.actionCompleted} />
      </Card>
      {promotions.data?.map((promotion) => (
        <Card className="p-4" key={promotion.id}>
          <div className="flex items-center justify-between gap-3">
            <div>
              <strong>{promotion.code}</strong>
              <p className="text-sm text-muted">
                {promotion.type === 'discount'
                  ? `${promotion.discount_stars} Stars · ${promotion.discount_rubles} ₽`
                  : `${promotion.premium_days} ${ru.miniApp.admin.daysShort} Premium`}
                {' · '}
                {promotion.activation_count}/{promotion.max_activations ?? '∞'}
              </p>
            </div>
            <div className="flex flex-wrap gap-2">
              <Button
                variant="secondary"
                onClick={() =>
                  update.mutate({
                    id: promotion.id,
                    input: promotionInput(promotion, !promotion.is_active),
                  })
                }
              >
                {promotion.is_active ? ru.miniApp.admin.deactivate : ru.miniApp.admin.activate}
              </Button>
              <Button
                variant="secondary"
                data-testid={`promotion-edit-${promotion.id}`}
                onClick={() => {
                  const input = promotionInput(promotion);
                  const { isActive, expiresAt, maxActivations, ...editable } = input;
                  setForm({
                    ...editable,
                    ...(expiresAt ? { expiresAt } : {}),
                    ...(maxActivations ? { maxActivations } : {}),
                  });
                  setEditingId(promotion.id);
                  setEditingActive(isActive);
                  window.scrollTo({ top: 0, behavior: 'smooth' });
                }}
              >
                {ru.miniApp.admin.editPromo}
              </Button>
              <Button
                variant="secondary"
                data-testid={`promotion-delete-${promotion.id}`}
                onClick={() => {
                  if (window.confirm(ru.miniApp.admin.deletePromoConfirm)) {
                    remove.mutate(promotion.id);
                  }
                }}
                loading={remove.isPending}
              >
                {ru.miniApp.admin.deletePromo}
              </Button>
            </div>
          </div>
        </Card>
      ))}
      <MutationFeedback states={[remove]} success={ru.miniApp.admin.promoDeleted} />
    </div>
  );
}

function Moderators() {
  const queryClient = useQueryClient();
  const [telegramId, setTelegramId] = useState('');
  const moderators = useQuery({
    queryKey: ['admin-moderators'],
    queryFn: api.adminModerators,
  });
  const assign = useMutation({
    mutationFn: api.adminAssignModerator,
    onSuccess: () => {
      setTelegramId('');
      void queryClient.invalidateQueries({ queryKey: ['admin-moderators'] });
    },
  });
  const remove = useMutation({
    mutationFn: api.adminRemoveModerator,
    onSuccess: () => void queryClient.invalidateQueries({ queryKey: ['admin-moderators'] }),
  });
  const parsedTelegramId = Number(telegramId);
  const canAssign = Number.isSafeInteger(parsedTelegramId) && parsedTelegramId > 0;
  if (moderators.isLoading) return <Skeleton className="h-72" />;
  if (moderators.isError) {
    return <AdminRequestError error={moderators.error} retry={() => moderators.refetch()} />;
  }
  return (
    <div className="space-y-4">
      <Card className="space-y-3 p-4">
        <h2 className="font-display text-2xl">{ru.miniApp.admin.moderatorsTitle}</h2>
        <p className="text-sm text-muted">{ru.miniApp.admin.moderatorsDescription}</p>
        <input
          className="input-field"
          inputMode="numeric"
          value={telegramId}
          onChange={(event) => setTelegramId(event.target.value.replace(/\D/g, ''))}
          placeholder={ru.miniApp.admin.moderatorTelegramId}
          aria-label={ru.miniApp.admin.moderatorTelegramId}
        />
        <Button
          data-testid="moderator-assign"
          disabled={!canAssign}
          loading={assign.isPending}
          onClick={() => assign.mutate(parsedTelegramId)}
        >
          {ru.miniApp.admin.assignModerator}
        </Button>
        <MutationFeedback states={[assign]} success={ru.miniApp.admin.moderatorAssigned} />
      </Card>
      {moderators.data?.length ? (
        moderators.data.map((moderator) => (
          <Card className="p-4" key={moderator.telegram_user_id}>
            <div className="flex flex-wrap items-center justify-between gap-3">
              <div>
                <strong>{moderator.telegram_first_name}</strong>
                <p className="text-sm text-muted">
                  {moderator.telegram_user_id}{' '}
                  {moderator.telegram_username ? `@${moderator.telegram_username}` : ''}
                </p>
              </div>
              <Button
                data-testid={`moderator-remove-${moderator.telegram_user_id}`}
                variant="secondary"
                loading={remove.isPending && remove.variables === moderator.telegram_user_id}
                onClick={() => {
                  if (
                    window.confirm(
                      ru.miniApp.admin.removeModeratorConfirm(moderator.telegram_user_id),
                    )
                  ) {
                    remove.mutate(moderator.telegram_user_id);
                  }
                }}
              >
                {ru.miniApp.admin.removeModerator}
              </Button>
            </div>
          </Card>
        ))
      ) : (
        <Card className="p-4 text-sm text-muted">{ru.miniApp.admin.noModerators}</Card>
      )}
      <MutationFeedback states={[remove]} success={ru.miniApp.admin.moderatorRemoved} />
    </div>
  );
}

function PostingRequirements() {
  const queryClient = useQueryClient();
  const requirements = useQuery({
    queryKey: ['admin-posting-requirements'],
    queryFn: api.adminPostingRequirements,
  });
  const [form, setForm] = useState<PostingRequirementInput>({
    type: 'channel',
    title: '',
    targetChatId: '',
    username: '',
    actionUrl: '',
    createInvite: false,
  });
  const [integration, setIntegration] = useState<{
    secret?: string;
    callback?: string;
  } | null>(null);
  const create = useMutation({
    mutationFn: api.adminCreatePostingRequirement,
    onSuccess: (result) => {
      setIntegration({
        ...(result.integrationSecret ? { secret: result.integrationSecret } : {}),
        ...(result.callbackUrl ? { callback: result.callbackUrl } : {}),
      });
      void queryClient.invalidateQueries({ queryKey: ['admin-posting-requirements'] });
    },
  });
  const update = useMutation({
    mutationFn: ({ id, active }: { id: string; active: boolean }) =>
      api.adminUpdatePostingRequirement(id, active),
    onSuccess: () =>
      void queryClient.invalidateQueries({ queryKey: ['admin-posting-requirements'] }),
  });
  if (requirements.isLoading) return <Skeleton className="h-72" />;
  return (
    <div className="space-y-4">
      <Card className="space-y-3 p-4">
        <h2 className="font-display text-2xl">{ru.miniApp.admin.requirementCreate}</h2>
        <select
          className="input-field"
          value={form.type}
          onChange={(event) =>
            setForm({ ...form, type: event.target.value as PostingRequirementInput['type'] })
          }
        >
          <option value="channel">{ru.miniApp.admin.requirementChannel}</option>
          <option value="supergroup">{ru.miniApp.admin.requirementChat}</option>
          <option value="bot">{ru.miniApp.admin.requirementBot}</option>
        </select>
        <input
          className="input-field"
          value={form.title}
          onChange={(event) => setForm({ ...form, title: event.target.value })}
          placeholder={ru.miniApp.admin.requirementTitle}
        />
        {form.type !== 'bot' ? (
          <input
            className="input-field"
            value={form.targetChatId}
            onChange={(event) => setForm({ ...form, targetChatId: event.target.value })}
            placeholder={ru.miniApp.admin.targetChatId}
          />
        ) : (
          <input
            className="input-field"
            value={form.username}
            onChange={(event) => setForm({ ...form, username: event.target.value })}
            placeholder={ru.miniApp.admin.botUsername}
          />
        )}
        <input
          className="input-field"
          value={form.actionUrl}
          onChange={(event) => setForm({ ...form, actionUrl: event.target.value })}
          placeholder={ru.miniApp.admin.subscriptionUrl}
        />
        {form.type !== 'bot' ? (
          <label className="setting-row">
            <span>{ru.miniApp.admin.generateInvite}</span>
            <input
              type="checkbox"
              checked={form.createInvite}
              onChange={(event) => setForm({ ...form, createInvite: event.target.checked })}
            />
          </label>
        ) : null}
        <input
          className="input-field"
          type="datetime-local"
          onChange={(event) => {
            const next = { ...form };
            if (event.target.value) next.expiresAt = new Date(event.target.value).toISOString();
            else delete next.expiresAt;
            setForm(next);
          }}
        />
        <input
          className="input-field"
          type="number"
          min={1}
          onChange={(event) => {
            const next = { ...form };
            if (event.target.value) next.maxConversions = Number(event.target.value);
            else delete next.maxConversions;
            setForm(next);
          }}
          placeholder={ru.miniApp.admin.maxConversions}
        />
        <Button onClick={() => create.mutate(form)} loading={create.isPending}>
          {ru.miniApp.admin.create}
        </Button>
        {integration?.secret ? (
          <div className="error-box">
            <strong>{ru.miniApp.admin.integrationSecretOnce}</strong>
            <code className="mt-2 block break-all">{integration.secret}</code>
            <code className="mt-2 block break-all">{integration.callback}</code>
          </div>
        ) : null}
        <MutationFeedback states={[create]} success={ru.miniApp.admin.actionCompleted} />
      </Card>
      {requirements.data?.map((requirement) => (
        <Card className="p-4" key={requirement.id}>
          <div className="flex items-center justify-between gap-3">
            <div>
              <strong>{requirement.title}</strong>
              <p className="text-sm text-muted">
                {requirement.type} · {requirement.conversion_count}/
                {requirement.max_conversions ?? '∞'}
              </p>
              <a className="text-xs text-lilac" href={requirement.action_url}>
                {requirement.action_url}
              </a>
            </div>
            <Button
              variant="secondary"
              onClick={() => update.mutate({ id: requirement.id, active: !requirement.is_active })}
            >
              {requirement.is_active ? ru.miniApp.admin.deactivate : ru.miniApp.admin.activate}
            </Button>
          </div>
        </Card>
      ))}
    </div>
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
