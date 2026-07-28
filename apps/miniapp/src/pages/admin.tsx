import { useState } from 'react';
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
  Shield,
  UserPlus,
  Users,
} from 'lucide-react';
import { Redirect } from 'wouter';
import { api } from '../api.js';
import { Button, Card, SectionTitle, Skeleton } from '../components/ui.js';
import { useUserStore } from '../store.js';

type AdminSection = 'dashboard' | 'users' | 'profiles' | 'reports' | 'flags' | 'audit';

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
            ['flags', ru.miniApp.admin.sections[4]],
            ['audit', ru.miniApp.admin.sections[5]],
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
        {section === 'dashboard' ? <Dashboard /> : null}
        {section === 'users' ? <UsersQueue /> : null}
        {section === 'profiles' ? <ProfilesQueue /> : null}
        {section === 'reports' ? <ReportsQueue /> : null}
        {section === 'flags' ? <Flags /> : null}
        {section === 'audit' ? <AuditLog /> : null}
      </div>
    </div>
  );
}

function Dashboard() {
  const stats = useQuery({ queryKey: ['admin-dashboard'], queryFn: api.adminDashboard });
  if (stats.isLoading) return <Skeleton className="h-96" />;
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
      action: 'warn' | 'temporary_ban' | 'permanent_ban' | 'unban' | 'disable_profile';
      reason: string;
    }) => api.adminModerateUser(input.userId, input),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['admin-users'] }),
  });
  const premium = useMutation({
    mutationFn: (input: { userId: string; durationDays: number; reason: string }) =>
      api.adminGrantPremium(input.userId, input.durationDays, input.reason),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['admin-users'] }),
  });
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
              <Button
                variant="secondary"
                onClick={() =>
                  void api
                    .adminRevokePremium(user.id, ru.miniApp.admin.ownerRevokeReason)
                    .then(() => queryClient.invalidateQueries({ queryKey: ['admin-users'] }))
                }
              >
                {ru.miniApp.admin.revokePremium}
              </Button>
            </div>
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
  return (
    <div className="space-y-3">
      {profiles.data?.map((profile) => (
        <Card key={profile.id} className="p-4">
          <div className="flex justify-between gap-3">
            <div>
              <strong>{profile.display_name}</strong>
              <p className="text-sm text-muted">
                Telegram {profile.telegram_user_id} · risk {profile.risk_score}
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
              Approve
            </Button>
            <Button
              variant="secondary"
              onClick={() => {
                const reason = window.prompt(ru.miniApp.admin.rejectionReasonPrompt);
                if (reason) moderate.mutate({ profileId: profile.id, status: 'rejected', reason });
              }}
            >
              Reject
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
          </div>
        </Card>
      ))}
    </div>
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
    </div>
  );
}

function Flags() {
  const queryClient = useQueryClient();
  const flags = useQuery({ queryKey: ['admin-flags'], queryFn: api.adminFlags });
  const update = useMutation({
    mutationFn: (input: { key: string; enabled: boolean }) =>
      api.adminUpdateFlag(input.key, input.enabled),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['admin-flags'] }),
  });
  return (
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
  );
}

function AuditLog() {
  const audit = useQuery({ queryKey: ['admin-audit'], queryFn: api.adminAudit });
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
