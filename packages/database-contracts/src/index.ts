import { z } from 'zod';
import {
  ageGroupSchema,
  createPaymentSchema,
  paginationSchema,
  profileSchema,
  reportCategorySchema,
  swipeActionSchema,
  telegramUserSchema,
} from '@rolemate/shared';

export interface UserRow {
  id: string;
  telegram_user_id: number;
  telegram_username: string | null;
  telegram_first_name: string;
  telegram_language_code: string | null;
  status: string;
  role: string;
  is_onboarding_completed: number;
  is_age_confirmed: number;
  is_rules_accepted: number;
  is_search_enabled: number;
  is_banned: number;
  risk_score: number;
  created_at: string;
  updated_at: string;
}

export interface ProfileRow {
  id: string;
  user_id: string;
  display_name: string;
  age_group: string;
  short_headline: string;
  about: string;
  fandoms: string;
  genres: string;
  moderation_status: string;
  profile_completion_percent: number;
  is_active: number;
  created_at: string;
  updated_at: string;
}

export interface ProductRow {
  id: string;
  code: string;
  name: string;
  description: string;
  billing_type: 'one_time' | 'subscription';
  duration_days: number;
  stars_amount: number;
  is_active: number;
}

export const workerOperations = {
  'users.upsert': z.object({
    telegramUser: telegramUserSchema,
    referralCode: z.string().optional(),
  }),
  'users.get': z.object({ telegramUserId: z.number().int().positive() }),
  'users.acceptRules': z.object({
    userId: z.string().uuid(),
    ageGroup: ageGroupSchema,
  }),
  'users.setSearchEnabled': z.object({
    userId: z.string().uuid(),
    enabled: z.boolean(),
  }),
  'settings.get': z.object({ userId: z.string().uuid() }),
  'settings.update': z.object({
    userId: z.string().uuid(),
    notificationsEnabled: z.boolean(),
    matchNotificationsEnabled: z.boolean(),
    messageNotificationsEnabled: z.boolean(),
    referralNotificationsEnabled: z.boolean(),
    premiumNotificationsEnabled: z.boolean(),
    privacyShieldEnabled: z.boolean(),
    showOnlineStatus: z.boolean(),
    showPremiumBadge: z.boolean(),
    theme: z.enum(['telegram', 'light', 'dark']),
  }),
  'users.delete': z.object({ userId: z.string().uuid() }),
  'profiles.upsert': z.object({ userId: z.string().uuid(), profile: profileSchema }),
  'profiles.getOwn': z.object({ userId: z.string().uuid() }),
  'search.list': z.object({ userId: z.string().uuid() }).merge(paginationSchema),
  'swipes.create': z.object({
    userId: z.string().uuid(),
    targetUserId: z.string().uuid(),
    action: swipeActionSchema,
    source: z.enum(['bot', 'miniapp']),
    idempotencyKey: z.string().min(16).max(128),
  }),
  'matches.list': z.object({ userId: z.string().uuid() }).merge(paginationSchema),
  'conversations.list': z.object({ userId: z.string().uuid() }).merge(paginationSchema),
  'conversations.resolveRelay': z.object({
    telegramUserId: z.number().int().positive(),
    conversationId: z.string().uuid().optional(),
  }),
  'conversations.resolveReply': z.object({
    conversationId: z.string().uuid(),
    replyChatId: z.number().int(),
    replyMessageId: z.number().int(),
    destinationChatId: z.number().int(),
  }),
  'conversations.mapMessage': z.object({
    conversationId: z.string().uuid(),
    senderUserId: z.string().uuid(),
    sourceChatId: z.number().int(),
    sourceMessageId: z.number().int(),
    destinationChatId: z.number().int(),
    destinationMessageId: z.number().int(),
    messageType: z.string().min(1).max(32),
  }),
  'conversations.requestContact': z.object({
    userId: z.string().uuid(),
    conversationId: z.string().uuid(),
  }),
  'conversations.control': z.object({
    userId: z.string().uuid(),
    conversationId: z.string().uuid(),
    action: z.enum(['mute', 'unmute', 'pause', 'resume', 'close']),
  }),
  'blocks.create': z.object({
    blockerUserId: z.string().uuid(),
    blockedUserId: z.string().uuid(),
    reason: z.string().max(500),
  }),
  'reports.create': z.object({
    reporterUserId: z.string().uuid(),
    reportedUserId: z.string().uuid(),
    conversationId: z.string().uuid().optional(),
    category: reportCategorySchema,
    description: z.string().max(1_500),
    evidenceSnapshot: z.array(z.record(z.unknown())).max(20),
  }),
  'risk.record': z.object({
    userId: z.string().uuid().optional(),
    type: z.string().min(1).max(64),
    scoreDelta: z.number().int().min(-100).max(100),
    metadata: z.record(z.unknown()).default({}),
  }),
  'telegramUpdates.claim': z.object({ updateId: z.number().int().nonnegative() }),
  'telegramUpdates.release': z.object({ updateId: z.number().int().nonnegative() }),
  'products.list': z.object({ activeOnly: z.boolean().default(true) }),
  'payments.create': z.object({ userId: z.string().uuid() }).merge(createPaymentSchema),
  'payments.getByPayload': z.object({ invoicePayload: z.string().min(1).max(128) }),
  'payments.markPrecheckout': z.object({
    orderId: z.string().uuid(),
    telegramUserId: z.number().int().positive(),
    currency: z.literal('XTR'),
    totalAmount: z.number().int().positive(),
  }),
  'payments.completeStars': z.object({
    orderId: z.string().uuid(),
    telegramPaymentChargeId: z.string().min(1).max(256),
    providerPaymentChargeId: z.string().max(256),
    totalAmount: z.number().int().positive(),
    subscriptionExpirationDate: z.number().int().positive().optional(),
    isRecurring: z.boolean(),
    isFirstRecurring: z.boolean(),
    telegramUpdateId: z.number().int(),
  }),
  'payments.getForRefund': z.object({ orderId: z.string().uuid() }),
  'payments.markRefunded': z.object({
    orderId: z.string().uuid(),
    providerEventId: z.string().min(1).max(256),
  }),
  'referrals.summary': z.object({ userId: z.string().uuid(), botUsername: z.string() }),
  'captcha.create': z.object({
    userId: z.string().uuid(),
    challengeHash: z.string().length(64),
    expiresAt: z.string().datetime(),
  }),
  'captcha.complete': z.object({
    userId: z.string().uuid(),
    challengeId: z.string().uuid(),
    answerHash: z.string().length(64),
  }),
  'sessions.create': z.object({
    userId: z.string().uuid(),
    sessionHash: z.string().length(64),
    csrfHash: z.string().length(64),
    expiresAt: z.string().datetime(),
  }),
  'sessions.get': z.object({ sessionHash: z.string().length(64) }),
  'sessions.revoke': z.object({ sessionHash: z.string().length(64) }),
  'admin.dashboard': z.object({ adminUserId: z.string().uuid() }),
  'admin.users.list': z
    .object({
      adminUserId: z.string().uuid(),
      query: z.string().max(128).default(''),
    })
    .merge(paginationSchema),
  'admin.profiles.list': z
    .object({
      adminUserId: z.string().uuid(),
      status: z
        .enum(['draft', 'pending', 'approved', 'rejected', 'paused', 'archived', 'all'])
        .default('pending'),
    })
    .merge(paginationSchema),
  'admin.reports.list': z
    .object({
      adminUserId: z.string().uuid(),
      status: z.enum(['open', 'reviewing', 'resolved', 'dismissed', 'all']).default('open'),
    })
    .merge(paginationSchema),
  'admin.payments.list': z
    .object({
      adminUserId: z.string().uuid(),
      status: z
        .enum(['pending', 'precheckout_approved', 'paid', 'refunded', 'failed', 'expired', 'all'])
        .default('all'),
    })
    .merge(paginationSchema),
  'admin.referrals.list': z
    .object({
      adminUserId: z.string().uuid(),
      status: z.enum(['pending', 'qualified', 'rejected', 'all']).default('all'),
    })
    .merge(paginationSchema),
  'admin.referral.review': z.object({
    adminUserId: z.string().uuid(),
    referralId: z.string().uuid(),
    action: z.enum(['confirm', 'reject', 'revoke']),
    reason: z.string().min(3).max(1_000),
  }),
  'admin.broadcasts.list': z.object({ adminUserId: z.string().uuid() }).merge(paginationSchema),
  'admin.broadcasts.create': z.object({
    adminUserId: z.string().uuid(),
    title: z.string().min(3).max(120),
    message: z.string().min(3).max(4_000),
    segment: z.enum(['all', 'active', 'premium', 'nonpremium']),
    rateLimitPerSecond: z.number().int().min(1).max(30),
  }),
  'admin.broadcasts.dryRun': z.object({
    adminUserId: z.string().uuid(),
    broadcastId: z.string().uuid(),
  }),
  'admin.broadcasts.control': z.object({
    adminUserId: z.string().uuid(),
    broadcastId: z.string().uuid(),
    action: z.enum(['queue', 'pause', 'cancel']),
    confirmationPhrase: z.string().max(128).default(''),
  }),
  'admin.system.status': z.object({ adminUserId: z.string().uuid() }),
  'broadcasts.claimBatch': z.object({
    limit: z.number().int().min(1).max(30),
  }),
  'broadcasts.recordBatch': z.object({
    broadcastId: z.string().uuid(),
    jobId: z.string().uuid(),
    results: z
      .array(
        z.object({
          deliveryId: z.string().uuid(),
          status: z.enum(['sent', 'failed', 'skipped']),
          errorCode: z.string().max(64).optional(),
          safeMessage: z.string().max(500).optional(),
        }),
      )
      .min(1)
      .max(30),
  }),
  'admin.user.moderate': z.object({
    adminUserId: z.string().uuid(),
    targetUserId: z.string().uuid(),
    action: z.enum(['warn', 'temporary_ban', 'permanent_ban', 'unban', 'disable_profile']),
    reason: z.string().min(3).max(1_000),
    bannedUntil: z.string().datetime().optional(),
  }),
  'admin.profile.moderate': z.object({
    adminUserId: z.string().uuid(),
    profileId: z.string().uuid(),
    status: z.enum(['approved', 'rejected', 'paused', 'archived']),
    reason: z.string().min(3).max(1_000),
  }),
  'admin.report.resolve': z.object({
    adminUserId: z.string().uuid(),
    reportId: z.string().uuid(),
    status: z.enum(['reviewing', 'resolved', 'dismissed']),
    resolution: z.string().min(3).max(1_000),
  }),
  'admin.premium.grant': z.object({
    adminUserId: z.string().uuid(),
    targetUserId: z.string().uuid(),
    durationDays: z.number().int().min(1).max(365),
    reason: z.string().min(3).max(1_000),
    idempotencyKey: z.string().min(16).max(128),
  }),
  'admin.premium.revoke': z.object({
    adminUserId: z.string().uuid(),
    targetUserId: z.string().uuid(),
    reason: z.string().min(3).max(1_000),
  }),
  'admin.products.update': z.object({
    adminUserId: z.string().uuid(),
    productId: z.string().uuid(),
    starsAmount: z.number().int().min(1).max(10_000),
    isActive: z.boolean(),
  }),
  'admin.flags.list': z.object({ adminUserId: z.string().uuid() }),
  'admin.flags.update': z.object({
    adminUserId: z.string().uuid(),
    key: z.string().min(1).max(64),
    enabled: z.boolean(),
    payload: z.record(z.unknown()).default({}),
  }),
  'admin.audit.list': z.object({ adminUserId: z.string().uuid() }).merge(paginationSchema),
  'admin.audit': z.object({
    adminUserId: z.string().uuid(),
    action: z.string().min(1).max(64),
    targetUserId: z.string().uuid().optional(),
    reason: z.string().max(1_000),
    oldState: z.record(z.unknown()).optional(),
    newState: z.record(z.unknown()).optional(),
    ipSignalHash: z.string().length(64).optional(),
    userAgent: z.string().max(512).optional(),
    requestId: z.string().min(1).max(128),
  }),
} as const;

export type WorkerOperation = keyof typeof workerOperations;
export type WorkerInput<T extends WorkerOperation> = z.infer<(typeof workerOperations)[T]>;

export const workerEnvelopeSchema = z.object({
  operation: z.string(),
  input: z.unknown(),
});

export interface WorkerSuccess<T = unknown> {
  ok: true;
  data: T;
  requestId: string;
}

export interface WorkerFailure {
  ok: false;
  error: {
    code: string;
    message: string;
  };
  requestId: string;
}

export type WorkerResponse<T = unknown> = WorkerSuccess<T> | WorkerFailure;
