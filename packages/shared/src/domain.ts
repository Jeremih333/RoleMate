import type { AgeGroup, ProfileInput } from './schemas.js';

const ADULT_GROUPS = new Set<AgeGroup>(['18_20', '21_25', '26_plus']);

export function areAgeGroupsCompatible(
  viewer: AgeGroup,
  candidate: AgeGroup,
  adultTopics: boolean,
): boolean {
  if (adultTopics) return ADULT_GROUPS.has(viewer) && ADULT_GROUPS.has(candidate);
  if (viewer === 'under_16') return candidate === 'under_16';
  if (viewer === '16_17') return candidate === '16_17';
  if (ADULT_GROUPS.has(viewer)) return ADULT_GROUPS.has(candidate);
  return false;
}

export interface SearchCandidate {
  userId: string;
  ageGroup: AgeGroup;
  fandoms: string[];
  genres: string[];
  languages: string[];
  writingStyle: string;
  activityFrequency: string;
  timezoneOffsetMinutes: number;
  lastActiveAt: Date;
  moderationScore: number;
  premiumBoost: boolean;
  hasPhoto: boolean;
}

export interface SearchContext {
  viewerUserId: string;
  viewerAgeGroup: AgeGroup;
  fandoms: string[];
  genres: string[];
  languages: string[];
  writingStyles: string[];
  activityLevels: string[];
  timezoneOffsetMinutes: number;
  adultTopics: boolean;
  onlyWithPhoto: boolean;
}

function overlap(left: string[], right: string[]): number {
  const normalized = new Set(left.map((value) => value.toLocaleLowerCase('ru')));
  return right.filter((value) => normalized.has(value.toLocaleLowerCase('ru'))).length;
}

export function scoreCandidate(context: SearchContext, candidate: SearchCandidate): number {
  if (context.viewerUserId === candidate.userId) return Number.NEGATIVE_INFINITY;
  if (!areAgeGroupsCompatible(context.viewerAgeGroup, candidate.ageGroup, context.adultTopics)) {
    return Number.NEGATIVE_INFINITY;
  }
  if (context.onlyWithPhoto && !candidate.hasPhoto) return Number.NEGATIVE_INFINITY;
  if (candidate.moderationScore < 0) return Number.NEGATIVE_INFINITY;

  let score = 0;
  score += Math.min(overlap(context.fandoms, candidate.fandoms), 4) * 18;
  score += Math.min(overlap(context.genres, candidate.genres), 4) * 10;
  score += Math.min(overlap(context.languages, candidate.languages), 2) * 12;
  if (context.writingStyles.includes(candidate.writingStyle)) score += 12;
  if (context.activityLevels.includes(candidate.activityFrequency)) score += 8;
  const timezoneDifference = Math.abs(
    context.timezoneOffsetMinutes - candidate.timezoneOffsetMinutes,
  );
  score += Math.max(0, 8 - Math.floor(timezoneDifference / 120));
  const activeHoursAgo = (Date.now() - candidate.lastActiveAt.getTime()) / 3_600_000;
  score += activeHoursAgo <= 24 ? 8 : activeHoursAgo <= 168 ? 3 : 0;
  score += Math.min(candidate.moderationScore, 5);
  if (candidate.premiumBoost) score += 5;
  return Math.min(100, Math.max(0, score));
}

export function profileCompletion(profile: Partial<ProfileInput>): number {
  const required: (keyof ProfileInput)[] = [
    'displayName',
    'ageGroup',
    'shortHeadline',
    'about',
    'roleplayExperience',
    'preferredRole',
    'writingStyle',
    'averagePostLength',
    'activityFrequency',
    'timezone',
    'languages',
    'fandoms',
    'genres',
    'lookingFor',
    'boundaries',
  ];
  const completed = required.filter((key) => {
    const value = profile[key];
    return Array.isArray(value) ? value.length > 0 : value !== undefined && value !== '';
  }).length;
  return Math.round((completed / required.length) * 100);
}

export function canonicalMatchPair(left: string, right: string): [string, string] {
  if (left === right) throw new Error('A user cannot match with themselves');
  return left.localeCompare(right) < 0 ? [left, right] : [right, left];
}

export function extendPremium(
  currentEnd: Date | null,
  durationSeconds: number,
  now = new Date(),
): Date {
  if (!Number.isSafeInteger(durationSeconds) || durationSeconds <= 0) {
    throw new Error('Premium duration must be a positive integer');
  }
  const base = currentEnd && currentEnd > now ? currentEnd : now;
  return new Date(base.getTime() + durationSeconds * 1_000);
}

export interface Entitlement {
  status: 'active' | 'revoked' | 'expired';
  startsAt: Date;
  endsAt: Date;
}

export function hasActiveEntitlement(entitlements: Entitlement[], now = new Date()): boolean {
  return entitlements.some(
    (item) => item.status === 'active' && item.startsAt <= now && item.endsAt > now,
  );
}

export type PaymentStatus = 'pending' | 'precheckout_approved' | 'paid' | 'refunded' | 'failed';

const allowedPaymentTransitions: Record<PaymentStatus, PaymentStatus[]> = {
  pending: ['precheckout_approved', 'failed'],
  precheckout_approved: ['paid', 'failed'],
  paid: ['refunded'],
  refunded: [],
  failed: [],
};

export function assertPaymentTransition(from: PaymentStatus, to: PaymentStatus): void {
  if (!allowedPaymentTransitions[from].includes(to)) {
    throw new Error(`Invalid payment transition: ${from} -> ${to}`);
  }
}

export interface ReferralCandidate {
  referrerUserId: string;
  referredUserId: string;
  isNewUser: boolean;
  rulesAccepted: boolean;
  ageConfirmed: boolean;
  captchaRequired: boolean;
  captchaPassed: boolean;
  profileApproved: boolean;
  isBanned: boolean;
  riskScore: number;
  existingReferrerUserId?: string;
}

export function qualifyReferral(input: ReferralCandidate): { qualified: boolean; reason: string } {
  if (input.referrerUserId === input.referredUserId) {
    return { qualified: false, reason: 'self_referral' };
  }
  if (!input.isNewUser || input.existingReferrerUserId) {
    return { qualified: false, reason: 'already_attributed' };
  }
  if (!input.rulesAccepted || !input.ageConfirmed) {
    return { qualified: false, reason: 'onboarding_incomplete' };
  }
  if (input.captchaRequired && !input.captchaPassed) {
    return { qualified: false, reason: 'captcha_incomplete' };
  }
  if (!input.profileApproved) return { qualified: false, reason: 'profile_incomplete' };
  if (input.isBanned) return { qualified: false, reason: 'account_blocked' };
  if (input.riskScore >= 70) return { qualified: false, reason: 'manual_review' };
  return { qualified: true, reason: 'qualified' };
}

export type RiskEvent =
  | 'rapid_actions'
  | 'mass_likes'
  | 'duplicate_messages'
  | 'referral_anomaly'
  | 'contact_spam'
  | 'unauthorized_admin'
  | 'captcha_failure'
  | 'report_received';

const riskWeights: Record<RiskEvent, number> = {
  rapid_actions: 8,
  mass_likes: 15,
  duplicate_messages: 12,
  referral_anomaly: 20,
  contact_spam: 15,
  unauthorized_admin: 35,
  captcha_failure: 8,
  report_received: 6,
};

export function calculateRiskScore(current: number, events: RiskEvent[]): number {
  return Math.min(
    100,
    Math.max(0, current + events.reduce((sum, event) => sum + riskWeights[event], 0)),
  );
}

export function requiresCaptcha(
  riskScore: number,
  action: 'read' | 'write' | 'sensitive',
): boolean {
  const threshold = action === 'sensitive' ? 35 : action === 'write' ? 50 : 70;
  return riskScore >= threshold;
}
