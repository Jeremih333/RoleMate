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
      body.message ?? 'Не удалось выполнить запрос',
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
  products: () => request<Product[]>('/products'),
  invoice: (productId: string) =>
    request<{ invoiceLink?: string }>('/payments/invoice', {
      method: 'POST',
      body: JSON.stringify({ productId }),
    }),
  referrals: () => request<ReferralSummary>('/referrals'),
  adminDashboard: () => request<AdminStats>('/admin/dashboard'),
  deleteAccount: () =>
    request<{ deleted: true }>('/account', {
      method: 'DELETE',
      body: JSON.stringify({ confirmation: 'УДАЛИТЬ' }),
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
  last_message_at?: string;
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
  profiles: number;
  matches: number;
  conversations: number;
  openReports: number;
  premiumUsers: number;
  starsPayments: number;
}
