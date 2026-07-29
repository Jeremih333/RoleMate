import { ru, type ProfileInput } from '@rolemate/shared';

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
      isOwner: boolean;
      riskScore: number;
    }>('/me'),
  profile: () => request<UserProfileSummary>('/profile'),
  profilePreview: () => request<SearchProfile>('/profile/preview'),
  saveProfile: (profile: ProfileInput) =>
    request<{ profileId: string; moderationStatus: string; completion: number }>('/profile', {
      method: 'PUT',
      body: JSON.stringify(profile),
    }),
  setProfileActive: (active: boolean) =>
    request<{ active: boolean }>('/profile/state', {
      method: 'PUT',
      body: JSON.stringify({ active }),
    }),
  profileMedia: () => request<ProfileMedia[]>('/profile/media'),
  deleteProfileMedia: (mediaId: string) =>
    request<{ deleted: true }>(`/profile/media/${mediaId}`, { method: 'DELETE' }),
  search: (query = '') =>
    request<SearchProfile[]>(`/search?limit=20&q=${encodeURIComponent(query)}`),
  searchAvailability: () => request<SearchAvailability>('/search/availability'),
  searchPreferences: () => request<SearchPreferences>('/search/preferences'),
  saveSearchPreferences: (preferences: SearchPreferencesInput) =>
    request<{ updated: true }>('/search/preferences', {
      method: 'PUT',
      body: JSON.stringify(preferences),
    }),
  filterSets: () => request<SavedFilterSet[]>('/search/filter-sets'),
  saveFilterSet: (name: string, filters: SearchPreferencesInput) =>
    request<SavedFilterSet>('/search/filter-sets', {
      method: 'POST',
      body: JSON.stringify({ name, filters }),
    }),
  activateFilterSet: (filterSetId: string) =>
    request<{ activated: true }>(`/search/filter-sets/${filterSetId}/activate`, {
      method: 'POST',
      body: '{}',
    }),
  deleteFilterSet: (filterSetId: string) =>
    request<{ deleted: true }>(`/search/filter-sets/${filterSetId}`, { method: 'DELETE' }),
  swipe: (targetUserId: string, action: 'like' | 'skip' | 'super_like' | 'rewind') =>
    request<{ matched: boolean; matchId?: string }>('/swipes', {
      method: 'POST',
      body: JSON.stringify({ targetUserId, action }),
    }),
  rewind: () =>
    request<{ rewound: true; targetUserId: string }>('/swipes/rewind', {
      method: 'POST',
      body: '{}',
    }),
  incomingLikes: () => request<IncomingLike[]>('/swipes/incoming'),
  premiumStatus: () => request<PremiumStatus>('/premium/status'),
  applyPromotion: (code: string) =>
    request<{
      type: 'discount' | 'premium_days';
      discountStars?: number;
      discountRubles?: number;
      premiumDays?: number;
      eligibleProductIds?: string[];
    }>('/promotions/apply', {
      method: 'POST',
      body: JSON.stringify({ code }),
    }),
  premiumBoost: () =>
    request<{ boosted: true }>('/premium/boost', {
      method: 'POST',
      body: '{}',
    }),
  premiumStats: () => request<PremiumStats>('/premium/stats'),
  profileVariants: () => request<ProfileVariant[]>('/premium/profile-variants'),
  saveProfileVariant: (input: ProfileVariantInput) =>
    request<{ id: string }>('/premium/profile-variants', {
      method: 'POST',
      body: JSON.stringify(input),
    }),
  activateProfileVariant: (variantId: string) =>
    request<{ activated: true }>(`/premium/profile-variants/${variantId}/activate`, {
      method: 'POST',
      body: '{}',
    }),
  deleteProfileVariant: (variantId: string) =>
    request<{ deleted: true }>(`/premium/profile-variants/${variantId}`, { method: 'DELETE' }),
  conversations: () => request<Conversation[]>('/conversations'),
  sendConversationMedia: (
    conversationId: string,
    input: {
      kind: ChatMediaKind;
      fileName: string;
      mimeType: string;
      dataBase64: string;
    },
  ) =>
    request<{ sent: true; messageType: ChatMediaKind }>(`/conversations/${conversationId}/media`, {
      method: 'POST',
      body: JSON.stringify(input),
    }),
  shareConversationProfile: (conversationId: string) =>
    request<{ sent: true }>(`/conversations/${conversationId}/profile-share`, {
      method: 'POST',
      body: '{}',
    }),
  giftPremiumInvoice: (conversationId: string, productId: string) =>
    request<{ invoiceLink?: string }>(`/conversations/${conversationId}/premium-gift/invoice`, {
      method: 'POST',
      body: JSON.stringify({ productId }),
    }),
  callTurnCredentials: (conversationId: string) =>
    request<TurnCredentials>(`/conversations/${conversationId}/calls/turn-credentials`),
  startCall: (conversationId: string, kind: 'audio' | 'video') =>
    request<AnonymousCall>(`/conversations/${conversationId}/calls`, {
      method: 'POST',
      body: JSON.stringify({ kind }),
    }),
  pollCall: (conversationId: string, afterSequence: number) =>
    request<CallPoll>(`/conversations/${conversationId}/calls/poll?afterSequence=${afterSequence}`),
  respondCall: (callId: string, accept: boolean) =>
    request<{ status: string }>(`/calls/${callId}/respond`, {
      method: 'POST',
      body: JSON.stringify({ accept }),
    }),
  signalCall: (callId: string, type: CallSignal['type'], payload: string) =>
    request<{ sequence: number }>(`/calls/${callId}/signal`, {
      method: 'POST',
      body: JSON.stringify({ type, payload }),
    }),
  endCall: (callId: string) =>
    request<{ status: string }>(`/calls/${callId}/end`, {
      method: 'POST',
      body: '{}',
    }),
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
  controlConversation: (
    conversationId: string,
    action: 'mute' | 'unmute' | 'pause' | 'resume' | 'close',
  ) =>
    request<{ status: string; muted: boolean }>(`/conversations/${conversationId}/control`, {
      method: 'POST',
      body: JSON.stringify({ action }),
    }),
  rateConversation: (conversationId: string, value: -1 | 1) =>
    request<{ saved: true }>(`/conversations/${conversationId}/rating`, {
      method: 'POST',
      body: JSON.stringify({ value }),
    }),
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
  adminModerators: () => request<AdminModerator[]>('/admin/moderators'),
  adminAssignModerator: (telegramUserId: number) =>
    request<{ assigned: true }>('/admin/moderators', {
      method: 'POST',
      body: JSON.stringify({ telegramUserId }),
    }),
  adminRemoveModerator: (telegramUserId: number) =>
    request<{ removed: true }>(`/admin/moderators/${telegramUserId}`, {
      method: 'DELETE',
      body: '{}',
    }),
  adminUsers: (query = '') =>
    request<AdminUser[]>(`/admin/users?q=${encodeURIComponent(query)}&limit=50`),
  adminProfiles: (status = 'all', query = '') =>
    request<AdminProfile[]>(
      `/admin/profiles?status=${encodeURIComponent(status)}&q=${encodeURIComponent(query)}&limit=50`,
    ),
  adminMedia: (status = 'pending') =>
    request<AdminMedia[]>(`/admin/media?status=${encodeURIComponent(status)}&limit=50`),
  adminModerateMedia: (mediaId: string, status: 'approved' | 'rejected', reason: string) =>
    request<{ updated: true }>(`/admin/media/${mediaId}/moderate`, {
      method: 'POST',
      body: JSON.stringify({ status, reason }),
    }),
  adminReports: (status = 'open') =>
    request<AdminReport[]>(`/admin/reports?status=${encodeURIComponent(status)}&limit=50`),
  adminPayments: (status = 'all') =>
    request<AdminPayment[]>(`/admin/payments?status=${encodeURIComponent(status)}&limit=50`),
  adminProducts: () => request<Product[]>('/admin/products'),
  adminUpdateProduct: (productId: string, starsAmount: number, isActive: boolean) =>
    request<{ updated: true }>(`/admin/products/${productId}`, {
      method: 'PUT',
      body: JSON.stringify({ starsAmount, isActive }),
    }),
  adminPromotions: () => request<AdminPromotion[]>('/admin/promotions'),
  adminCreatePromotion: (input: AdminPromotionInput) =>
    request<{ id: string }>('/admin/promotions', {
      method: 'POST',
      body: JSON.stringify(input),
    }),
  adminUpdatePromotion: (promotionId: string, input: AdminPromotionUpdateInput) =>
    request<{ updated: true }>(`/admin/promotions/${promotionId}`, {
      method: 'PUT',
      body: JSON.stringify(input),
    }),
  adminDeletePromotion: (promotionId: string) =>
    request<{ deleted: true; archived: boolean }>(`/admin/promotions/${promotionId}`, {
      method: 'DELETE',
      body: '{}',
    }),
  adminPostingRequirements: () => request<PostingRequirement[]>('/admin/posting-requirements'),
  adminCreatePostingRequirement: (input: PostingRequirementInput) =>
    request<{ id: string; integrationSecret?: string; callbackUrl?: string }>(
      '/admin/posting-requirements',
      { method: 'POST', body: JSON.stringify(input) },
    ),
  adminUpdatePostingRequirement: (requirementId: string, isActive: boolean) =>
    request<{ updated: true }>(`/admin/posting-requirements/${requirementId}`, {
      method: 'PUT',
      body: JSON.stringify({ isActive }),
    }),
  adminRefundPayment: (orderId: string) =>
    request<{ refunded: true }>(`/admin/payments/${orderId}/refund`, {
      method: 'POST',
      body: '{}',
    }),
  adminReferrals: (status = 'all') =>
    request<AdminReferral[]>(`/admin/referrals?status=${encodeURIComponent(status)}&limit=50`),
  adminReviewReferral: (
    referralId: string,
    action: 'confirm' | 'reject' | 'revoke',
    reason: string,
  ) =>
    request<{ updated: true }>(`/admin/referrals/${referralId}/review`, {
      method: 'POST',
      body: JSON.stringify({ action, reason }),
    }),
  adminBroadcasts: () => request<AdminBroadcast[]>('/admin/broadcasts?limit=50'),
  adminCreateBroadcast: (input: {
    title: string;
    message: string;
    segment: 'all' | 'active' | 'premium' | 'nonpremium';
    rateLimitPerSecond: number;
  }) =>
    request<{ id: string; status: string }>('/admin/broadcasts', {
      method: 'POST',
      body: JSON.stringify(input),
    }),
  adminBroadcastDryRun: (broadcastId: string) =>
    request<{ estimatedRecipients: number; confirmationPhrase: string }>(
      `/admin/broadcasts/${broadcastId}/dry-run`,
      { method: 'POST', body: '{}' },
    ),
  adminControlBroadcast: (
    broadcastId: string,
    action: 'queue' | 'pause' | 'cancel',
    confirmationPhrase = '',
  ) =>
    request<{ updated: true }>(`/admin/broadcasts/${broadcastId}/control`, {
      method: 'POST',
      body: JSON.stringify({ action, confirmationPhrase }),
    }),
  adminSystem: () => request<AdminSystemStatus>('/admin/system'),
  adminModerateUser: (
    userId: string,
    input: {
      action:
        'warn' | 'temporary_ban' | 'permanent_ban' | 'unban' | 'disable_profile' | 'reset_captcha';
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
  adminConfig: () => request<AdminConfig[]>('/admin/config'),
  adminUpdateConfig: (key: AdminConfig['key'], value: string) =>
    request<{ updated: true }>(`/admin/config/${key}`, {
      method: 'PUT',
      body: JSON.stringify({ value }),
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
  age_group: string | null;
  gender: string | null;
  short_headline: string;
  about: string;
  fandoms: string;
  genres: string;
  tags: string;
  writing_style: string;
  average_post_length: string;
  activity_frequency: string;
  compatibility: number;
  is_premium: number;
  has_premium: number;
  media_id?: string | null;
  media_type?: ProfileMedia['media_type'] | null;
  media_items?: string;
  rating_likes: number;
  rating_dislikes: number;
  rating_score: number;
}

export interface UserProfileSummary extends Record<string, unknown> {
  profile_completion_percent: number;
  in_search_pool: number;
  is_active: number;
  moderation_status: string;
}

export interface SearchAvailability {
  otherProfiles: number;
  otherSearchable: number;
  safeCandidates: number;
}

export interface ProfileMedia {
  id: string;
  media_type: 'photo' | 'animation' | 'video' | 'audio' | 'voice' | 'document';
  sort_order: number;
  moderation_status: 'pending' | 'approved' | 'rejected';
  created_at: string;
}

export interface SearchPreferences {
  premium: boolean;
  age_groups: string;
  languages: string;
  genres: string;
  fandoms: string;
  writing_styles: string;
  activity_levels: string;
  only_online: number;
  only_with_photo: number;
}

export interface SearchPreferencesInput {
  ageGroups: Array<'under_16' | '16_17' | '18_20' | '21_25' | '26_plus'>;
  languages: string[];
  genres: string[];
  fandoms: string[];
  writingStyles: string[];
  activityLevels: string[];
  onlyOnline: boolean;
  onlyWithPhoto: boolean;
}

export interface SavedFilterSet {
  id: string;
  name: string;
  filters: string;
  is_active: number;
}

export interface IncomingLike extends SearchProfile {
  swipe_id: string;
  action: 'like' | 'super_like';
  created_at: string;
}

export interface PremiumStatus {
  premium: boolean;
  endsAt?: string;
  earlyAccess: boolean;
  usage: {
    profileViews: number;
    profileViewLimit: number;
    superLikes: number;
    superLikeLimit: number;
  };
}

export interface ProfileVariant {
  id: string;
  name: string;
  short_headline: string;
  about: string;
  plots: string;
  is_active: number;
}

export interface ProfileVariantInput {
  name: string;
  shortHeadline: string;
  about: string;
  plots: string;
}

export interface PremiumStats {
  viewsToday: number;
  viewsSevenDays: number;
  viewsTotal: number;
  incomingLikes: number;
}

export interface Conversation {
  id: string;
  status: string;
  anonymous_alias: string;
  other_user_id: string;
  display_name?: string;
  short_headline?: string;
  contact_reveal_status: string;
  is_muted: number;
  last_message_at?: string;
}

export type ChatMediaKind = 'photo' | 'animation' | 'video' | 'audio' | 'voice' | 'video_note';

export interface AnonymousCall {
  id: string;
  kind: 'audio' | 'video';
  status: 'ringing' | 'active' | 'declined' | 'ended' | 'missed';
  isInitiator: boolean;
}

export interface CallSignal {
  sequence: number;
  type: 'offer' | 'answer' | 'ice';
  payload: string;
}

export interface CallPoll {
  call: AnonymousCall | null;
  signals: CallSignal[];
}

export interface TurnCredentials {
  iceServers: RTCIceServer[];
  iceTransportPolicy: 'relay';
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
  hide_demographics: number;
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
  hideDemographics: boolean;
  theme: 'telegram' | 'light' | 'dark';
}

export interface AdminPromotion {
  id: string;
  code: string;
  type: 'discount' | 'premium_days';
  discount_stars: number;
  discount_rubles: number;
  premium_days: number;
  eligible_product_ids: string;
  expires_at?: string;
  max_activations?: number;
  activation_count: number;
  is_active: number;
}

export interface AdminPromotionInput {
  code: string;
  type: 'discount' | 'premium_days';
  discountStars: number;
  discountRubles: number;
  premiumDays: number;
  eligibleProductIds: string[];
  expiresAt?: string;
  maxActivations?: number;
}

export type AdminPromotionUpdateInput = Omit<
  AdminPromotionInput,
  'expiresAt' | 'maxActivations'
> & {
  expiresAt: string | null;
  maxActivations: number | null;
  isActive: boolean;
};

export interface PostingRequirement {
  id: string;
  type: 'channel' | 'supergroup' | 'bot';
  title: string;
  target_chat_id?: string;
  username?: string;
  action_url: string;
  expires_at?: string;
  max_conversions?: number;
  conversion_count: number;
  is_active: number;
}

export interface PostingRequirementInput {
  type: 'channel' | 'supergroup' | 'bot';
  title: string;
  targetChatId?: string;
  username?: string;
  actionUrl?: string;
  createInvite: boolean;
  expiresAt?: string;
  maxConversions?: number;
}

export interface Product {
  id: string;
  code: string;
  name: string;
  description: string;
  billing_type: string;
  duration_days: number;
  stars_amount: number;
  original_stars_amount?: number;
  effective_stars_amount?: number;
  applied_discount_stars?: number;
  is_active: number;
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
  status: string;
  is_banned: number;
  risk_score: number;
  premium_ends_at?: string;
}

export interface AdminModerator {
  telegram_user_id: number;
  telegram_username?: string;
  telegram_first_name: string;
  assigned_at: string;
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

export interface AdminMedia {
  id: string;
  media_type: 'photo' | 'animation' | 'video' | 'audio' | 'voice' | 'document';
  moderation_status: 'pending' | 'approved' | 'rejected';
  profile_id: string;
  user_id: string;
  display_name: string;
  telegram_user_id: number;
  created_at: string;
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

export interface AdminPayment {
  id: string;
  provider: string;
  currency: string;
  amount: number;
  status: string;
  product_name: string;
  product_id: string;
  product_code: string;
  billing_type: string;
  duration_days: number;
  telegram_user_id: number;
  telegram_username?: string;
  telegram_payment_charge_id?: string;
  entitlement_ends_at?: string;
  entitlement_status?: string;
  expires_at: string;
  paid_at?: string;
  refunded_at?: string;
  created_at: string;
}

export interface AdminReferral {
  id: string;
  status: string;
  qualification_reason?: string;
  qualified_at?: string;
  created_at: string;
  referrer_telegram_id: number;
  referred_telegram_id: number;
  referrer_display_name?: string;
  referred_display_name?: string;
  referred_risk_events_score: number;
}

export interface AdminBroadcast {
  id: string;
  title: string;
  message: string;
  segment: 'all' | 'active' | 'premium' | 'nonpremium';
  status: string;
  rate_limit_per_second: number;
  estimated_recipients: number;
  sent_count: number;
  failed_count: number;
  delivery_errors: number;
  dry_run_at?: string;
  created_at: string;
}

export interface AdminSystemStatus {
  d1: string;
  api: string;
  version: string;
  commitSha: string;
  environment: string;
  uptimeSeconds: number;
  checkedAt: string;
  maintenanceMode: boolean;
  jobs: { pending: number; running: number; failed: number; deadLetters: number };
  lastFailures: Array<{ error_code: string; safe_message: string; created_at: string }>;
  runtime?: { provider?: string; service?: string | null };
}

export interface FeatureFlag {
  key: string;
  enabled: number;
  payload: string;
}

export interface AdminConfig {
  key:
    | 'search_limit'
    | 'relay_rate_limit'
    | 'free_daily_profile_limit'
    | 'premium_daily_profile_limit'
    | 'free_super_like_limit'
    | 'premium_super_like_limit'
    | 'boost_cooldown_days'
    | 'support_text'
    | 'maintenance_text';
  value: string;
  updated_at?: string;
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
