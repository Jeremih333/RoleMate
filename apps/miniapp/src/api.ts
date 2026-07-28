import { ru } from '@rolemate/shared';

const API_BASE = '/api';

let csrfToken = sessionStorage.getItem('rm_csrf') ?? '';

export class ApiError extends Error {
  constructor(
    public readonly status: number,
    public readonly code: string,
    message: string,
  ) {
    super(message);
  }
}

async function request<T>(path: string, options: RequestInit & { body?: string } = {}): Promise<T> {
  const method = options.method ?? 'GET';
  const response = await fetch(`${API_BASE}${path}`, {
    ...options,
    credentials: 'include',
    headers: {
      'Content-Type': 'application/json',
      ...(method !== 'GET' && csrfToken ? { 'X-CSRF-Token': csrfToken } : {}),
      ...options.headers,
    },
  });
  if (!response.ok) {
    const body = (await response.json().catch(() => ({}))) as {
      error?: string;
      message?: string;
    };
    throw new ApiError(
      response.status,
      body.error ?? 'REQUEST_FAILED',
      body.message ?? ru.api.requestFailed,
    );
  }
  const payload: unknown = await response.json();
  return payload as T;
}

export const api = {
  async authenticate(initData: string) {
    const result = await request<{
      user: { id: string; telegramUserId: number; role: string };
      csrfToken: string;
    }>('/auth/telegram', { method: 'POST', body: JSON.stringify({ initData }) });
    csrfToken = result.csrfToken;
    sessionStorage.setItem('rm_csrf', csrfToken);
    return result.user;
  },
  me: () =>
    request<{
      userId: string;
      telegramUserId: number;
      role: string;
      isAdmin: boolean;
      riskScore: number;
    }>('/me'),
  profile: () => request<Record<string, unknown>>('/profile'),
  saveProfile: (profile: unknown) =>
    request<{ profileId: string; moderationStatus: string; completion: number }>('/profile', {
      method: 'PUT',
      body: JSON.stringify(profile),
    }),
  search: () => request<SearchProfile[]>('/search?limit=20'),
  swipe: (targetUserId: string, action: 'like' | 'skip' | 'super_like' | 'rewind') =>
    request<{ matched: boolean; matchId?: string }>('/swipes', {
      method: 'POST',
      body: JSON.stringify({ targetUserId, action }),
    }),
  conversations: () => request<Conversation[]>('/conversations'),
  matches: () => request<Match[]>('/matches'),
  block: (blockedUserId: string, reason = 'user_request') =>
    request<{ blocked: true }>('/blocks', {
      method: 'POST',
      body: JSON.stringify({ blockedUserId, reason }),
    }),
  report: (input: {
    reportedUserId: string;
    conversationId?: string;
    category: ReportCategory;
    description: string;
  }) =>
    request<{ reportId: string }>('/reports', {
      method: 'POST',
      body: JSON.stringify(input),
    }),
  requestContactReveal: (conversationId: string) =>
    request<{ revealed: boolean; contacts?: Array<{ userId: string; username: string | null }> }>(
      `/conversations/${conversationId}/contact-reveal`,
      { method: 'POST', body: '{}' },
    ),
  settings: () => request<UserSettings>('/settings'),
  saveSettings: (settings: SettingsInput) =>
    request<{ updated: true }>('/settings', {
      method: 'PUT',
      body: JSON.stringify(settings),
    }),
  setSearchEnabled: (enabled: boolean) =>
    request<{ enabled: boolean }>('/search/state', {
      method: 'POST',
      body: JSON.stringify({ enabled }),
    }),
  products: () => request<Product[]>('/products'),
  invoice: (productId: string) =>
    request<{ invoiceLink?: string }>('/payments/invoice', {
      method: 'POST',
      body: JSON.stringify({ productId }),
    }),
  referrals: () => request<ReferralSummary>('/referrals'),
  adminDashboard: () => request<AdminStats>('/admin/dashboard'),
  adminUsers: (query = '') =>
    request<AdminUser[]>(`/admin/users?q=${encodeURIComponent(query)}&limit=50`),
  adminProfiles: (status = 'pending') =>
    request<AdminProfile[]>(`/admin/profiles?status=${encodeURIComponent(status)}&limit=50`),
  adminReports: (status = 'open') =>
    request<AdminReport[]>(`/admin/reports?status=${encodeURIComponent(status)}&limit=50`),
  adminModerateUser: (
    userId: string,
    input: {
      action: 'warn' | 'temporary_ban' | 'permanent_ban' | 'unban' | 'disable_profile';
      reason: string;
      bannedUntil?: string;
    },
  ) =>
    request<{ updated: true }>(`/admin/users/${userId}/moderate`, {
      method: 'POST',
      body: JSON.stringify(input),
    }),
  adminModerateProfile: (
    profileId: string,
    status: 'approved' | 'rejected' | 'paused' | 'archived',
    reason: string,
  ) =>
    request<{ updated: true }>(`/admin/profiles/${profileId}/moderate`, {
      method: 'POST',
      body: JSON.stringify({ status, reason }),
    }),
  adminResolveReport: (
    reportId: string,
    status: 'reviewing' | 'resolved' | 'dismissed',
    resolution: string,
  ) =>
    request<{ updated: true }>(`/admin/reports/${reportId}/resolve`, {
      method: 'POST',
      body: JSON.stringify({ status, resolution }),
    }),
  adminGrantPremium: (userId: string, durationDays: number, reason: string) =>
    request<{ granted: true }>(`/admin/users/${userId}/premium/grant`, {
      method: 'POST',
      body: JSON.stringify({ durationDays, reason }),
    }),
  adminRevokePremium: (userId: string, reason: string) =>
    request<{ revoked: true }>(`/admin/users/${userId}/premium/revoke`, {
      method: 'POST',
      body: JSON.stringify({ reason }),
    }),
  adminFlags: () => request<FeatureFlag[]>('/admin/flags'),
  adminUpdateFlag: (key: string, enabled: boolean) =>
    request<{ updated: true }>(`/admin/flags/${encodeURIComponent(key)}`, {
      method: 'PUT',
      body: JSON.stringify({ enabled, payload: {} }),
    }),
  adminAudit: () => request<AuditEntry[]>('/admin/audit?limit=50'),
  deleteAccount: () =>
    request<{ deleted: true }>('/account', {
      method: 'DELETE',
      body: JSON.stringify({ confirmation: ru.api.deleteConfirmation }),
    }),
};

export interface SearchProfile {
  id: string;
  user_id: string;
  display_name: string;
  age_group: string;
  short_headline: string;
  about: string;
  fandoms: string;
  genres: string;
  writing_style: string;
  average_post_length: string;
  activity_frequency: string;
  compatibility: number;
  is_premium: number;
}

export interface Conversation {
  id: string;
  status: string;
  anonymous_alias: string;
  other_user_id: string;
  display_name?: string;
  short_headline?: string;
  contact_reveal_status: string;
  last_message_at?: string;
}

export interface Match {
  id: string;
  status: string;
  matched_at: string;
  conversation_id: string;
  other_user_id: string;
  display_name?: string;
  short_headline?: string;
}

export type ReportCategory =
  | 'spam'
  | 'advertising'
  | 'insults'
  | 'harassment'
  | 'unwanted_content'
  | 'impersonation'
  | 'fraud'
  | 'personal_data'
  | 'prohibited_adult_content'
  | 'unsafe_minor'
  | 'other';

export interface UserSettings {
  notifications_enabled: number;
  match_notifications_enabled: number;
  message_notifications_enabled: number;
  referral_notifications_enabled: number;
  premium_notifications_enabled: number;
  privacy_shield_enabled: number;
  show_online_status: number;
  show_premium_badge: number;
  theme: 'telegram' | 'light' | 'dark';
}

export interface SettingsInput {
  notificationsEnabled: boolean;
  matchNotificationsEnabled: boolean;
  messageNotificationsEnabled: boolean;
  referralNotificationsEnabled: boolean;
  premiumNotificationsEnabled: boolean;
  privacyShieldEnabled: boolean;
  showOnlineStatus: boolean;
  showPremiumBadge: boolean;
  theme: 'telegram' | 'light' | 'dark';
}

export interface Product {
  id: string;
  code: string;
  name: string;
  description: string;
  billing_type: string;
  duration_days: number;
  stars_amount: number;
}

export interface ReferralSummary {
  link: string;
  rewardDays: number;
  invited: number;
  qualified: number;
  pending: number;
}

export interface AdminStats {
  users: number;
  newUsers24h: number;
  activeUsers24h: number;
  profiles: number;
  matches: number;
  conversations: number;
  openReports: number;
  bannedUsers: number;
  premiumUsers: number;
  starsPayments: number;
  qualifiedReferrals: number;
  captcha24h: number;
  pendingJobs: number;
  failedJobs: number;
}

export interface AdminUser {
  id: string;
  telegram_user_id: number;
  telegram_username?: string;
  telegram_first_name: string;
  display_name?: string;
  status: string;
  is_banned: number;
  risk_score: number;
  premium_ends_at?: string;
}

export interface AdminProfile {
  id: string;
  user_id: string;
  display_name: string;
  short_headline: string;
  about: string;
  moderation_status: string;
  risk_score: number;
  telegram_user_id: number;
}

export interface AdminReport {
  id: string;
  category: string;
  description?: string;
  status: string;
  reported_user_id: string;
  reported_telegram_id: number;
  reported_display_name?: string;
  created_at: string;
}

export interface FeatureFlag {
  key: string;
  enabled: number;
  payload: string;
}

export interface AuditEntry {
  id: string;
  action: string;
  reason?: string;
  target_user_id?: string;
  request_id: string;
  result: string;
  created_at: string;
}
