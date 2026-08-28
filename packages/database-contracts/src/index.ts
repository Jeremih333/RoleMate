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

const profileUsernameSchema = z
  .string()
  .trim()
  .toLowerCase()
  .min(4)
  .max(32)
  .regex(/^[a-z][a-z0-9_]*$/);
const publicProfileUsernameSchema = z
  .string()
  .trim()
  .toLowerCase()
  .min(4)
  .max(32)
  .regex(/^(?:[a-z][a-z0-9_]*|[\u0430-\u044f\u0451][\u0430-\u044f\u04510-9_]*)$/u);

export const workerOperations = {
  'groupCampaigns.upsertMembership': z.object({
    chatId: z.number().int().safe(),
    chatTitle: z.string().trim().max(255).optional(),
    chatUsername: z.string().trim().max(32).optional(),
    addedByTelegramUserId: z.number().int().positive().optional(),
    botIsAdministrator: z.boolean(),
  }),
  'groupCampaigns.activate': z.object({
    chatId: z.number().int().safe(),
    activatedByTelegramUserId: z.number().int().positive(),
  }),
  'groupCampaigns.disable': z.object({
    chatId: z.number().int().safe(),
    removed: z.boolean().default(false),
  }),
  'groupCampaigns.claimDue': z.object({ limit: z.number().int().min(1).max(20).default(10) }),
  'groupCampaigns.recordBatch': z.object({
    claimToken: z.string().uuid(),
    results: z
      .array(
        z.object({
          chatId: z.number().int().safe(),
          status: z.enum(['sent', 'retry', 'disabled']),
          variantIndex: z.number().int().nonnegative(),
          errorCode: z.string().trim().max(80).optional(),
        }),
      )
      .min(1)
      .max(20),
  }),
  'admin.groupCampaigns.settings.get': z.object({
    adminUserId: z.string().uuid(),
  }),
  'admin.groupCampaigns.settings.update': z.object({
    adminUserId: z.string().uuid(),
    intervalMinutes: z.number().int().min(1).max(1_440),
  }),
  'users.upsert': z.object({
    telegramUser: telegramUserSchema,
    referralCode: z.string().optional(),
  }),
  'users.get': z.object({ telegramUserId: z.number().int().positive() }),
  'users.resolveUsername': z.object({ username: z.string().min(5).max(32) }),
  'users.acceptRules': z.object({
    userId: z.string().uuid(),
    ageGroup: ageGroupSchema,
  }),
  'users.setSearchEnabled': z.object({
    userId: z.string().uuid(),
    enabled: z.boolean(),
  }),
  'users.quickStartContext': z.object({ userId: z.string().uuid() }),
  'conversations.icebreaker': z.object({
    userId: z.string().uuid(),
    conversationId: z.string().uuid(),
  }),
  'users.setReadyToChat': z.object({
    userId: z.string().uuid(),
    // Zero clears the flag; anything else is how long the window lasts.
    minutes: z.number().int().min(0).max(720),
  }),
  'conversations.endGently': z.object({
    userId: z.string().uuid(),
    conversationId: z.string().uuid(),
  }),
  'conversations.sweepDeadMatches': z.object({
    limit: z.number().int().min(1).max(200).optional(),
  }),
  'settings.get': z.object({ userId: z.string().uuid() }),
  'settings.update': z.object({
    userId: z.string().uuid(),
    notificationsEnabled: z.boolean(),
    telegramNotificationsEnabled: z.boolean().default(true),
    matchNotificationsEnabled: z.boolean(),
    messageNotificationsEnabled: z.boolean(),
    mentionNotificationsEnabled: z.boolean().default(true),
    commentNotificationsEnabled: z.boolean().default(true),
    referralNotificationsEnabled: z.boolean(),
    premiumNotificationsEnabled: z.boolean(),
    followerPostNotificationsEnabled: z.boolean().default(true),
    followerQuestionnaireNotificationsEnabled: z.boolean().default(true),
    privacyShieldEnabled: z.boolean(),
    showOnlineStatus: z.boolean(),
    showPremiumBadge: z.boolean(),
    hideDemographics: z.boolean().default(false),
    chatArchiveVisible: z.boolean().default(true),
    autoArchiveNewChats: z.boolean().default(false),
    hideForwardAuthor: z.boolean().default(false),
    quickReaction: z.string().trim().min(1).max(16).default('heart'),
    theme: z.enum(['telegram', 'light', 'dark']),
  }),
  'users.delete': z.object({ userId: z.string().uuid() }),
  'profiles.upsert': z.object({ userId: z.string().uuid(), profile: profileSchema }),
  'profiles.getOwn': z.object({ userId: z.string().uuid() }),
  'profiles.previewOwn': z.object({ userId: z.string().uuid() }),
  'profiles.setActive': z.object({ userId: z.string().uuid(), active: z.boolean() }),
  'profiles.media.list': z.object({ userId: z.string().uuid() }),
  'profiles.mediaUploadIntent.set': z.discriminatedUnion('targetType', [
    z.object({
      userId: z.string().uuid(),
      targetType: z.literal('profile'),
      mediaKind: z.enum(['any', 'visual', 'music']).default('any'),
    }),
    z.object({
      userId: z.string().uuid(),
      targetType: z.literal('questionnaire'),
      questionnaireId: z.string().uuid(),
    }),
  ]),
  'profiles.mediaUploadIntent.get': z.object({ userId: z.string().uuid() }),
  'profiles.mediaUploadIntent.clear': z.object({ userId: z.string().uuid() }),
  'profiles.media.add': z
    .object({
      userId: z.string().uuid(),
      telegramFileId: z.string().min(1).max(512),
      telegramFileUniqueId: z.string().min(1).max(256),
      mediaType: z.enum(['photo', 'animation', 'video', 'audio', 'voice', 'document']),
      trackTitle: z.string().trim().min(1).max(160).optional(),
      trackPerformer: z.string().trim().min(1).max(160).optional(),
      thumbnailTelegramFileId: z.string().min(1).max(512).optional(),
      fileSizeBytes: z
        .number()
        .int()
        .min(0)
        .max(50 * 1024 * 1024)
        .optional(),
      durationSeconds: z.number().int().min(0).max(86_400).optional(),
      width: z.number().int().min(1).max(8_192).optional(),
      height: z.number().int().min(1).max(8_192).optional(),
    })
    .superRefine((value, context) => {
      if (value.mediaType === 'audio' && (value.fileSizeBytes ?? 0) > 20 * 1024 * 1024) {
        context.addIssue({
          code: z.ZodIssueCode.too_big,
          type: 'number',
          maximum: 20 * 1024 * 1024,
          inclusive: true,
          path: ['fileSizeBytes'],
          message: 'Profile music must not exceed 20 MiB',
        });
      }
    }),
  'profiles.media.delete': z.object({
    userId: z.string().uuid(),
    mediaId: z.string().uuid(),
  }),
  'profiles.media.reorder': z.object({
    userId: z.string().uuid(),
    mediaIds: z.array(z.string().uuid()).min(1).max(13),
  }),
  'profiles.audio.reorder': z.object({
    userId: z.string().uuid(),
    mediaIds: z.array(z.string().uuid()).min(1).max(5),
  }),
  'profiles.avatar.set': z.object({
    userId: z.string().uuid(),
    mediaId: z.string().uuid().nullable(),
  }),
  'publicProfiles.getOwn': z.object({ userId: z.string().uuid() }),
  'publicProfiles.get': z.object({
    requesterUserId: z.string().uuid(),
    profileUserId: z.string().uuid(),
  }),
  'publicProfiles.getByUsername': z.object({
    requesterUserId: z.string().uuid(),
    username: publicProfileUsernameSchema,
  }),
  'publicProfiles.search': z
    .object({
      requesterUserId: z.string().uuid(),
      query: z.string().trim().max(80).default(''),
    })
    .merge(paginationSchema),
  'publicProfiles.rate': z.object({
    userId: z.string().uuid(),
    profileUserId: z.string().uuid(),
    value: z.union([z.literal(-1), z.literal(1)]),
  }),
  'publicProfiles.follow': z.object({
    userId: z.string().uuid(),
    profileUserId: z.string().uuid(),
  }),
  'publicProfiles.unfollow': z.object({
    userId: z.string().uuid(),
    profileUserId: z.string().uuid(),
  }),
  'publicProfiles.followers': z
    .object({ requesterUserId: z.string().uuid(), profileUserId: z.string().uuid() })
    .merge(paginationSchema),
  'publicProfiles.following': z
    .object({ requesterUserId: z.string().uuid(), profileUserId: z.string().uuid() })
    .merge(paginationSchema),
  'publicProfiles.update': z.object({
    userId: z.string().uuid(),
    displayName: z.string().trim().min(2).max(80),
    bio: z.string().trim().max(1_500),
    avatarMediaId: z.string().uuid().nullable().optional(),
    avatarMediaIds: z
      .array(z.string().uuid())
      .max(8)
      .refine((ids) => new Set(ids).size === ids.length, 'Avatar media must be unique')
      .optional(),
    visibilityMode: z.enum(['public', 'following_only']).default('public'),
    showFollowers: z.boolean().default(true),
    showFollowing: z.boolean().default(true),
    showQuestionnaires: z.boolean().default(true),
    showPosts: z.boolean().default(true),
    showLastSeen: z.boolean().default(true),
    directMessagePolicy: z.enum(['everyone', 'following_and_staff']).default('everyone'),
    // An index into the fixed palette, not a free-form colour: the palette is
    // picked to stay readable on both themes.
    accentColor: z.number().int().min(0).max(15).nullable().optional(),
    headerEmoji: z.string().trim().min(1).max(8).nullable().optional(),
  }),
  'publicProfiles.updatePrivacy': z.object({
    userId: z.string().uuid(),
    visibilityMode: z.enum(['public', 'following_only']),
    showFollowers: z.boolean(),
    showFollowing: z.boolean(),
    showQuestionnaires: z.boolean(),
    showPosts: z.boolean(),
    showLastSeen: z.boolean(),
    directMessagePolicy: z.enum(['everyone', 'following_and_staff']),
  }),
  'profileUsernames.listOwn': z.object({ userId: z.string().uuid() }),
  'profileUsernames.claim': z.object({
    userId: z.string().uuid(),
    username: profileUsernameSchema,
  }),
  'profileUsernames.replaceOwn': z.object({
    userId: z.string().uuid(),
    username: profileUsernameSchema,
  }),
  'profileUsernames.release': z.object({
    userId: z.string().uuid(),
    username: profileUsernameSchema,
  }),
  'questionnaires.listOwn': z.object({ userId: z.string().uuid() }),
  'questionnaires.listPublic': z
    .object({
      requesterUserId: z.string().uuid(),
      profileUserId: z.string().uuid(),
    })
    .merge(paginationSchema),
  'questionnaires.getOwn': z.object({
    userId: z.string().uuid(),
    questionnaireId: z.string().uuid(),
  }),
  'questionnaires.resolveSwipeTarget': z.object({
    userId: z.string().uuid(),
    questionnaireId: z.string().uuid(),
  }),
  'questionnaires.previewOwn': z.object({
    userId: z.string().uuid(),
    questionnaireId: z.string().uuid(),
  }),
  'questionnaires.create': z.object({
    userId: z.string().uuid(),
    title: z.string().trim().min(2).max(80),
    profile: profileSchema,
  }),
  'questionnaires.clonePrimary': z.object({
    userId: z.string().uuid(),
    title: z.string().trim().min(2).max(80),
  }),
  'questionnaires.update': z.object({
    userId: z.string().uuid(),
    questionnaireId: z.string().uuid(),
    title: z.string().trim().min(2).max(80),
    profile: profileSchema,
  }),
  'questionnaires.delete': z.object({
    userId: z.string().uuid(),
    questionnaireId: z.string().uuid(),
  }),
  'questionnaires.setActive': z.object({
    userId: z.string().uuid(),
    questionnaireId: z.string().uuid(),
    active: z.boolean(),
  }),
  'questionnaires.setPrimary': z.object({
    userId: z.string().uuid(),
    questionnaireId: z.string().uuid(),
  }),
  'questionnaires.media.list': z.object({
    userId: z.string().uuid(),
    questionnaireId: z.string().uuid(),
  }),
  'questionnaires.media.add': z
    .object({
      userId: z.string().uuid(),
      questionnaireId: z.string().uuid(),
      telegramFileId: z.string().min(1).max(512),
      telegramFileUniqueId: z.string().min(1).max(256),
      mediaType: z.enum(['photo', 'animation', 'video', 'audio', 'voice', 'document']),
      trackTitle: z.string().trim().min(1).max(160).optional(),
      trackPerformer: z.string().trim().min(1).max(160).optional(),
      thumbnailTelegramFileId: z.string().min(1).max(512).optional(),
      fileSizeBytes: z
        .number()
        .int()
        .min(0)
        .max(50 * 1024 * 1024)
        .optional(),
      durationSeconds: z.number().int().min(0).max(86_400).optional(),
      width: z.number().int().min(1).max(8_192).optional(),
      height: z.number().int().min(1).max(8_192).optional(),
    })
    .superRefine((value, context) => {
      if (value.mediaType === 'audio' && (value.fileSizeBytes ?? 0) > 20 * 1024 * 1024) {
        context.addIssue({
          code: z.ZodIssueCode.too_big,
          type: 'number',
          maximum: 20 * 1024 * 1024,
          inclusive: true,
          path: ['fileSizeBytes'],
          message: 'Questionnaire music must not exceed 20 MiB',
        });
      }
    }),
  'questionnaires.media.delete': z.object({
    userId: z.string().uuid(),
    questionnaireId: z.string().uuid(),
    mediaId: z.string().uuid(),
  }),
  'questionnaires.media.reorder': z.object({
    userId: z.string().uuid(),
    questionnaireId: z.string().uuid(),
    mediaIds: z.array(z.string().uuid()).min(1).max(8),
  }),
  'questionnaires.recordView': z.object({
    userId: z.string().uuid(),
    questionnaireId: z.string().uuid(),
  }),
  'profiles.media.resolve': z.object({
    requesterUserId: z.string().uuid(),
    mediaId: z.string().uuid(),
  }),
  'profiles.media.resolveThumbnail': z.object({
    requesterUserId: z.string().uuid(),
    mediaId: z.string().uuid(),
  }),
  'search.list': z
    .object({ userId: z.string().uuid(), query: z.string().trim().max(80).default('') })
    .merge(paginationSchema),
  'search.availability': z.object({ userId: z.string().uuid() }),
  'search.preferences.get': z.object({ userId: z.string().uuid() }),
  'search.preferences.update': z.object({
    userId: z.string().uuid(),
    ageGroups: z.array(ageGroupSchema).max(5),
    languages: z.array(z.string().min(1).max(40)).max(10),
    genres: z.array(z.string().min(1).max(80)).max(20),
    fandoms: z.array(z.string().min(1).max(120)).max(20),
    writingStyles: z.array(z.string().min(1).max(40)).max(10),
    activityLevels: z.array(z.string().min(1).max(40)).max(10),
    onlyOnline: z.boolean(),
    onlyWithPhoto: z.boolean(),
    timezones: z.array(z.string().min(1).max(64)).max(12).default([]),
  }),
  'search.filterSets.list': z.object({ userId: z.string().uuid() }),
  'search.filterSets.save': z.object({
    userId: z.string().uuid(),
    name: z.string().trim().min(1).max(40),
    filters: z.object({
      ageGroups: z.array(ageGroupSchema).max(5),
      languages: z.array(z.string().min(1).max(40)).max(10),
      genres: z.array(z.string().min(1).max(80)).max(20),
      fandoms: z.array(z.string().min(1).max(120)).max(20),
      writingStyles: z.array(z.string().min(1).max(40)).max(10),
      activityLevels: z.array(z.string().min(1).max(40)).max(10),
      onlyOnline: z.boolean(),
      onlyWithPhoto: z.boolean(),
      timezones: z.array(z.string().min(1).max(64)).max(12).default([]),
    }),
  }),
  'search.filterSets.activate': z.object({
    userId: z.string().uuid(),
    filterSetId: z.string().uuid(),
  }),
  'search.filterSets.delete': z.object({
    userId: z.string().uuid(),
    filterSetId: z.string().uuid(),
  }),
  'taxonomy.suggestions': z.object({
    userId: z.string().uuid(),
    kind: z.enum([
      'language',
      'fandom',
      'genre',
      'tag',
      'hashtag',
      'plot',
      'setting',
      'looking_for',
      'boundary',
    ]),
    query: z.string().trim().max(60).default(''),
    limit: z.number().int().min(1).max(30).default(12),
  }),
  'taxonomy.selections.record': z.object({
    userId: z.string().uuid(),
    kind: z.enum([
      'language',
      'fandom',
      'genre',
      'tag',
      'hashtag',
      'plot',
      'setting',
      'looking_for',
      'boundary',
    ]),
    value: z.string().trim().min(1).max(120),
  }),
  'swipes.create': z.object({
    userId: z.string().uuid(),
    targetUserId: z.string().uuid(),
    action: swipeActionSchema,
    source: z.enum(['bot', 'miniapp']),
    idempotencyKey: z.string().min(16).max(128),
    questionnaireId: z.string().uuid().optional(),
  }),
  'swipes.rewind': z.object({ userId: z.string().uuid() }),
  'swipes.incoming': z.object({ userId: z.string().uuid() }).merge(paginationSchema),
  'notifications.deliveryTarget': z.object({
    userId: z.string().uuid(),
    kind: z.enum(['like', 'message']),
  }),
  'notifications.mentions.create': z.object({
    actorUserId: z.string().uuid(),
    usernames: z.array(publicProfileUsernameSchema).max(20),
    context: z.enum(['chat', 'questionnaire', 'post', 'comment']),
    entityId: z.string().uuid().optional(),
    openPath: z.string().startsWith('/').max(300),
    sourceKey: z.string().min(8).max(200),
    message: z.string().trim().min(1).max(300),
  }),
  'notifications.activity.create': z.object({
    actorUserId: z.string().uuid(),
    targetUserId: z.string().uuid(),
    kind: z.enum(['comment', 'message']),
    context: z.enum(['chat', 'post', 'comment']),
    entityId: z.string().uuid().optional(),
    openPath: z.string().startsWith('/').max(300),
    sourceKey: z.string().min(8).max(200),
    message: z.string().trim().min(1).max(300),
  }),
  'notifications.telegram.enqueue': z.object({
    targetUserId: z.string().uuid(),
    conversationId: z.string().uuid().optional(),
    category: z
      .enum([
        'message',
        'like',
        'follow',
        'reaction',
        'mention',
        'comment',
        'premium',
        'moderation',
        'follower_post',
        'follower_questionnaire',
      ])
      .default('message'),
    openPath: z.string().startsWith('/').max(300),
    sourceKey: z.string().min(8).max(200),
    message: z.string().trim().min(1).max(300),
  }),
  'notifications.onboarding.enqueueDue': z.object({
    limit: z.number().int().min(1).max(30).default(20),
  }),
  'notifications.onboardingRecovery.enqueue': z.object({
    createdAfter: z.string().datetime({ offset: true }),
    campaign: z.string().regex(/^[a-z0-9-]{8,80}$/),
    botUsername: z.string().regex(/^[A-Za-z0-9_]{5,32}$/),
    limit: z.number().int().min(1).max(300).default(300),
    dryRun: z.boolean().default(true),
  }),
  'notifications.engagement.claimDue': z.object({
    limit: z.number().int().min(1).max(30).default(20),
  }),
  'notifications.engagement.complete': z.object({
    claimToken: z.string().uuid(),
    userId: z.string().uuid(),
    outcome: z.enum(['send', 'subscribed', 'retry']),
  }),
  'notifications.telegram.claimBatch': z.object({
    limit: z.number().int().min(1).max(30),
  }),
  'notifications.telegram.recordBatch': z.object({
    claimToken: z.string().uuid(),
    results: z
      .array(
        z.object({
          notificationId: z.string().uuid(),
          status: z.enum(['sent', 'retry', 'failed']),
          errorCode: z.string().max(64).optional(),
        }),
      )
      .min(1)
      .max(30),
  }),
  'notifications.followers.create': z.object({
    actorUserId: z.string().uuid(),
    entityType: z.enum(['post', 'questionnaire']),
    entityId: z.string().uuid(),
    openPath: z.string().startsWith('/').max(300),
    message: z.string().trim().min(1).max(300),
  }),
  'notifications.list': z.object({ userId: z.string().uuid() }).merge(paginationSchema),
  'notifications.read': z.object({
    userId: z.string().uuid(),
    notificationId: z.string().uuid(),
  }),
  'notifications.dismiss': z.object({
    userId: z.string().uuid(),
    notificationId: z.string().uuid(),
  }),
  'notifications.dismissAll': z.object({ userId: z.string().uuid() }),
  'mentions.resolve': z.object({
    requesterUserId: z.string().uuid(),
    usernames: z.array(publicProfileUsernameSchema).max(20),
  }),
  'premium.status': z.object({ userId: z.string().uuid() }),
  'promotions.apply': z.object({
    userId: z.string().uuid(),
    code: z.string().trim().min(3).max(40),
  }),
  'premium.boost': z.object({ userId: z.string().uuid() }),
  'premium.stats': z.object({ userId: z.string().uuid() }),
  'premium.profileVariants.list': z.object({ userId: z.string().uuid() }),
  'premium.profileVariants.save': z.object({
    userId: z.string().uuid(),
    name: z.string().trim().min(1).max(40),
    shortHeadline: z.string().trim().min(3).max(120),
    about: z.string().trim().min(20).max(2_000),
    plots: z.string().max(2_000),
  }),
  'premium.profileVariants.activate': z.object({
    userId: z.string().uuid(),
    variantId: z.string().uuid(),
  }),
  'premium.profileVariants.getShareable': z.object({
    userId: z.string().uuid(),
    variantId: z.string().uuid(),
  }),
  'premium.profileVariants.delete': z.object({
    userId: z.string().uuid(),
    variantId: z.string().uuid(),
  }),
  'matches.list': z.object({ userId: z.string().uuid() }).merge(paginationSchema),
  'matches.dismiss': z.object({
    userId: z.string().uuid(),
    matchId: z.string().uuid(),
  }),
  'conversations.startDirect': z.object({
    userId: z.string().uuid(),
    targetUserId: z.string().uuid(),
  }),
  'conversations.list': z
    .object({ userId: z.string().uuid(), archived: z.boolean().default(false) })
    .merge(paginationSchema),
  'conversations.archive': z.object({
    userId: z.string().uuid(),
    conversationId: z.string().uuid(),
    archived: z.boolean(),
  }),
  'conversations.pin': z.object({
    userId: z.string().uuid(),
    conversationId: z.string().uuid(),
    pinned: z.boolean(),
  }),
  'conversations.pins.reorder': z.object({
    userId: z.string().uuid(),
    conversationIds: z
      .array(z.string().uuid())
      .max(100)
      .refine((ids) => new Set(ids).size === ids.length, 'Pinned conversations must be unique'),
  }),
  'conversations.draft.get': z.object({
    userId: z.string().uuid(),
    conversationId: z.string().uuid(),
  }),
  'conversations.draft.save': z.object({
    userId: z.string().uuid(),
    conversationId: z.string().uuid(),
    encryptedContent: z.string().min(20).max(8_000),
  }),
  'conversations.draft.delete': z.object({
    userId: z.string().uuid(),
    conversationId: z.string().uuid(),
  }),
  'conversations.presence.set': z.object({
    userId: z.string().uuid(),
    conversationId: z.string().uuid(),
    activity: z.enum(['typing', 'recording_voice', 'sending_media', 'idle']),
  }),
  'conversations.presence.get': z.object({
    userId: z.string().uuid(),
    conversationId: z.string().uuid(),
  }),
  'shares.entity.resolve': z.object({
    userId: z.string().uuid(),
    entityType: z.enum(['post', 'questionnaire']),
    entityId: z.string().uuid(),
  }),
  'shares.playlist.resolve': z.object({
    userId: z.string().uuid(),
    sourceType: z.enum(['post', 'chat']),
    sourceId: z.string().min(1).max(128),
    trackIds: z
      .array(z.string().uuid())
      .min(1)
      .max(20)
      .refine((ids) => new Set(ids).size === ids.length, 'Playlist tracks must be unique'),
  }),
  'shares.record': z.object({
    userId: z.string().uuid(),
    entityType: z.enum(['post', 'questionnaire', 'playlist']),
    entityId: z.string().min(1).max(128),
    conversationId: z.string().uuid(),
  }),
  'conversations.resolveRelay': z.object({
    telegramUserId: z.number().int().positive(),
    conversationId: z.string().uuid().optional(),
  }),
  'conversations.resolveMiniAppRelay': z.object({
    userId: z.string().uuid(),
    conversationId: z.string().uuid(),
  }),
  'conversations.recordMiniAppMessage': z.object({
    userId: z.string().uuid(),
    conversationId: z.string().uuid(),
    destinationMessageId: z.number().int().positive(),
    messageType: z.enum([
      'text',
      'photo',
      'animation',
      'video',
      'audio',
      'voice',
      'profile',
      'scenario',
      'sticker',
      'document',
    ]),
    encryptedContent: z.string().min(20).max(8_000).optional(),
    telegramFileId: z.string().min(1).max(512).optional(),
    mimeType: z.string().min(1).max(128).optional(),
    fileName: z.string().min(1).max(255).optional(),
    trackTitle: z.string().trim().min(1).max(160).optional(),
    trackPerformer: z.string().trim().min(1).max(160).optional(),
    thumbnailTelegramFileId: z.string().min(1).max(512).optional(),
    durationSeconds: z.number().int().nonnegative().max(86_400).optional(),
    mediaGroupId: z.string().uuid().optional(),
    playlistTitle: z.string().trim().min(1).max(120).nullable().optional(),
    replyToMessageId: z.string().uuid().optional(),
    captionPosition: z.enum(['top', 'bottom']).optional(),
  }),
  'conversations.messages.list': z
    .object({
      userId: z.string().uuid(),
      conversationId: z.string().uuid(),
      // False lets the chat list peek at a conversation without clearing unread.
      markRead: z.boolean().default(true),
    })
    .merge(paginationSchema),
  'conversations.messages.get': z.object({
    userId: z.string().uuid(),
    conversationId: z.string().uuid(),
    messageId: z.string().uuid(),
  }),
  'conversations.messages.pins.list': z.object({
    userId: z.string().uuid(),
    conversationId: z.string().uuid(),
  }),
  'conversations.messages.pin': z.object({
    userId: z.string().uuid(),
    conversationId: z.string().uuid(),
    messageId: z.string().uuid(),
    pinned: z.boolean(),
    sharedWithParticipant: z.boolean().default(false),
  }),
  'conversations.messages.encryptedContent': z.object({
    userId: z.string().uuid(),
    conversationId: z.string().uuid(),
    messageId: z.string().uuid(),
  }),
  'conversations.messages.media': z.object({
    userId: z.string().uuid(),
    conversationId: z.string().uuid(),
    messageId: z.string().uuid(),
  }),
  'conversations.messages.thumbnail': z.object({
    userId: z.string().uuid(),
    conversationId: z.string().uuid(),
    messageId: z.string().uuid(),
  }),
  'conversations.messages.deleteSelected': z.object({
    userId: z.string().uuid(),
    conversationId: z.string().uuid(),
    messageIds: z.array(z.string().uuid()).min(1).max(100),
    // Unchecked means "hide from my copy"; checked removes it for both sides.
    forEveryone: z.boolean().default(false),
  }),
  'conversations.messages.forward': z.object({
    userId: z.string().uuid(),
    sourceConversationId: z.string().uuid(),
    messageIds: z.array(z.string().uuid()).min(1).max(100),
    destinationConversationIds: z.array(z.string().uuid()).min(1).max(20),
  }),
  'conversations.messages.react': z.object({
    userId: z.string().uuid(),
    conversationId: z.string().uuid(),
    messageId: z.string().uuid(),
    reaction: z.string().trim().min(1).max(16),
  }),
  'conversations.messages.updateOwnText': z.object({
    userId: z.string().uuid(),
    conversationId: z.string().uuid(),
    messageId: z.string().uuid(),
    encryptedContent: z.string().min(20).max(8_000),
  }),
  'conversations.messages.reorderOwnMedia': z.object({
    userId: z.string().uuid(),
    conversationId: z.string().uuid(),
    mediaGroupId: z.string().uuid(),
    messageIds: z.array(z.string().uuid()).min(2).max(20),
  }),
  'conversations.messages.replaceOwnMedia': z.object({
    userId: z.string().uuid(),
    conversationId: z.string().uuid(),
    messageId: z.string().uuid(),
    messageType: z.enum(['photo', 'animation', 'video', 'audio', 'voice', 'document']),
    telegramFileId: z.string().min(1).max(512),
    mimeType: z.string().min(1).max(128),
    fileName: z.string().min(1).max(255),
    trackTitle: z.string().trim().min(1).max(160).optional(),
    trackPerformer: z.string().trim().min(1).max(160).optional(),
    durationSeconds: z.number().int().nonnegative().max(86_400).optional(),
  }),
  'conversations.deleteOwn': z.object({
    userId: z.string().uuid(),
    conversationId: z.string().uuid(),
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
    messageType: z.enum([
      'text',
      'photo',
      'animation',
      'video',
      'audio',
      'voice',
      'profile',
      'scenario',
      'sticker',
      'document',
    ]),
    encryptedContent: z.string().min(20).max(8_000).optional(),
    telegramFileId: z.string().min(1).max(512).optional(),
    mimeType: z.string().min(1).max(128).optional(),
    fileName: z.string().min(1).max(255).optional(),
    trackTitle: z.string().trim().min(1).max(160).optional(),
    trackPerformer: z.string().trim().min(1).max(160).optional(),
    thumbnailTelegramFileId: z.string().min(1).max(512).optional(),
    durationSeconds: z.number().int().nonnegative().max(86_400).optional(),
    mediaGroupId: z.string().min(1).max(128).optional(),
    playlistTitle: z.string().trim().min(1).max(120).nullable().optional(),
  }),
  'conversations.control': z.object({
    userId: z.string().uuid(),
    conversationId: z.string().uuid(),
    action: z.enum(['mute', 'unmute', 'pause', 'resume', 'close']),
  }),
  // Kept only for backward compatibility with the immutable call tables.
  // No bot-api or MiniApp route exposes these operations.
  'calls.start': z.object({
    userId: z.string().uuid(),
    conversationId: z.string().uuid(),
    kind: z.enum(['audio', 'video']),
  }),
  'calls.poll': z.object({
    userId: z.string().uuid(),
    conversationId: z.string().uuid(),
    afterSequence: z.number().int().nonnegative().default(0),
  }),
  'calls.respond': z.object({
    userId: z.string().uuid(),
    callId: z.string().uuid(),
    accept: z.boolean(),
  }),
  'calls.signal': z.object({
    userId: z.string().uuid(),
    callId: z.string().uuid(),
    type: z.enum(['offer', 'answer', 'ice']),
    payload: z.string().min(2).max(64_000),
  }),
  'calls.end': z.object({
    userId: z.string().uuid(),
    callId: z.string().uuid(),
  }),
  'calls.expire': z.object({}),
  'posts.draft.start': z.object({ userId: z.string().uuid() }),
  'posts.draft.get': z.object({ userId: z.string().uuid() }),
  'posts.draft.attach': z.object({
    userId: z.string().uuid(),
    sourceChatId: z.number().int(),
    sourceMessageId: z.number().int().positive(),
    contentType: z.enum(['text', 'photo', 'document', 'animation', 'video', 'voice', 'audio']),
    textPreview: z.string().max(500),
    title: z.string().trim().max(160).optional(),
    bodyMarkdown: z.string().max(10_000).optional(),
    mediaTelegramFileId: z.string().min(1).max(512).optional(),
    mediaMimeType: z.string().trim().min(3).max(120).optional(),
    mediaThumbnailFileId: z.string().min(1).max(512).optional(),
    trackTitle: z.string().trim().min(1).max(160).optional(),
    trackPerformer: z.string().trim().min(1).max(160).optional(),
    mediaGroupId: z.string().min(1).max(128).optional(),
    playlistTitle: z.string().trim().min(1).max(120).nullable().optional(),
  }),
  'posts.draft.publish': z.object({ userId: z.string().uuid(), postId: z.string().uuid() }),
  'posts.draft.cancel': z.object({ userId: z.string().uuid() }),
  'posts.repost': z.object({ userId: z.string().uuid(), postId: z.string().uuid() }),
  'posts.updateOwn': z.object({
    userId: z.string().uuid(),
    postId: z.string().uuid(),
    title: z.string().trim().max(120),
    bodyMarkdown: z.string().trim().min(1).max(8_000),
    playlistTitle: z.string().trim().min(1).max(120).nullable().optional(),
    tags: z.array(z.string().trim().min(1).max(60)).max(20).default([]),
    fandoms: z.array(z.string().trim().min(1).max(100)).max(20).default([]),
    hashtags: z.array(z.string().trim().min(1).max(60)).max(20).default([]),
  }),
  'posts.media.removeOwn': z.object({
    userId: z.string().uuid(),
    postId: z.string().uuid(),
    mediaId: z.string().uuid().optional(),
  }),
  'posts.mediaEdit.start': z.object({
    userId: z.string().uuid(),
    postId: z.string().uuid(),
  }),
  'posts.mediaEdit.get': z.object({ userId: z.string().uuid() }),
  'posts.mediaEdit.attach': z.object({
    userId: z.string().uuid(),
    sourceChatId: z.number().int(),
    sourceMessageId: z.number().int().positive(),
    contentType: z.enum(['photo', 'document', 'animation', 'video', 'voice', 'audio']),
    mediaTelegramFileId: z.string().min(1).max(512),
    mediaMimeType: z.string().trim().min(3).max(120).optional(),
    mediaThumbnailFileId: z.string().min(1).max(512).optional(),
    trackTitle: z.string().trim().min(1).max(160).optional(),
    trackPerformer: z.string().trim().min(1).max(160).optional(),
  }),
  'posts.feed.next': z.object({ userId: z.string().uuid() }),
  'posts.get': z.object({ userId: z.string().uuid(), postId: z.string().uuid() }),
  'posts.media.resolve': z.object({ userId: z.string().uuid(), postId: z.string().uuid() }),
  'posts.media.resolveItem': z.object({
    userId: z.string().uuid(),
    postId: z.string().uuid(),
    mediaId: z.string().uuid(),
  }),
  'posts.own.list': z.object({ userId: z.string().uuid() }).merge(paginationSchema),
  'posts.feed.list': z
    .object({
      userId: z.string().uuid(),
      sort: z.enum(['interesting', 'new']).default('interesting'),
      followingOnly: z.boolean().default(false),
    })
    .merge(paginationSchema),
  'posts.author.list': z
    .object({
      userId: z.string().uuid(),
      authorUserId: z.string().uuid(),
    })
    .merge(paginationSchema),
  'posts.search': z
    .object({ userId: z.string().uuid(), query: z.string().trim().max(80).default('') })
    .merge(paginationSchema),
  'posts.comments.list': z
    .object({
      userId: z.string().uuid(),
      postId: z.string().uuid(),
      sort: z.enum(['interesting', 'new']).default('interesting'),
    })
    .merge(paginationSchema),
  'posts.comments.create': z.object({
    userId: z.string().uuid(),
    postId: z.string().uuid(),
    body: z.string().trim().min(1).max(1_000),
    parentCommentId: z.string().uuid().optional(),
    voice: z
      .object({
        telegramFileId: z.string().min(1).max(512),
        durationSeconds: z.number().int().min(0).max(600).optional(),
        fileSizeBytes: z.number().int().min(0).optional(),
      })
      .optional(),
  }),
  'posts.comments.voice.resolve': z.object({
    userId: z.string().uuid(),
    commentId: z.string().uuid(),
  }),
  'posts.comments.updateOwn': z.object({
    userId: z.string().uuid(),
    commentId: z.string().uuid(),
    body: z.string().trim().min(1).max(1_000),
  }),
  'posts.comments.deleteOwn': z.object({
    userId: z.string().uuid(),
    commentId: z.string().uuid(),
  }),
  'posts.comments.rate': z.object({
    userId: z.string().uuid(),
    commentId: z.string().uuid(),
    value: z.union([z.literal(-1), z.literal(1)]),
  }),
  'posts.rate': z.object({
    userId: z.string().uuid(),
    postId: z.string().uuid(),
    value: z.union([z.literal(-1), z.literal(1)]),
  }),
  'posts.recordView': z.object({
    userId: z.string().uuid(),
    postId: z.string().uuid(),
  }),
  'posts.engagement.list': z.object({
    userId: z.string().uuid(),
    postId: z.string().uuid(),
    kind: z.enum(['ratings', 'shares']),
  }),
  'posts.hide': z.object({
    userId: z.string().uuid(),
    postId: z.string().uuid(),
  }),
  'posts.delete': z.object({ userId: z.string().uuid(), postId: z.string().uuid() }),
  'posting.requirements.due': z.object({ userId: z.string().uuid() }),
  'posting.requirements.recordView': z.object({ userId: z.string().uuid() }),
  'posting.requirements.markVerified': z.object({
    userId: z.string().uuid(),
    requirementId: z.string().uuid(),
  }),
  'posting.requirements.snooze': z.object({
    userId: z.string().uuid(),
    requirementId: z.string().uuid(),
  }),
  'posting.requirements.botVerify': z.object({
    telegramUserId: z.number().int().positive(),
    requirementId: z.string().uuid(),
    secretHash: z.string().length(64),
  }),
  'blocks.create': z.object({
    blockerUserId: z.string().uuid(),
    blockedUserId: z.string().uuid(),
    reason: z.string().max(500),
  }),
  'blocks.list': z.object({ blockerUserId: z.string().uuid() }),
  'blocks.remove': z.object({
    blockerUserId: z.string().uuid(),
    blockedUserId: z.string().uuid(),
  }),
  'reports.create': z.object({
    reporterUserId: z.string().uuid(),
    reportedUserId: z.string().uuid(),
    conversationId: z.string().uuid().optional(),
    postId: z.string().uuid().optional(),
    questionnaireId: z.string().uuid().optional(),
    commentId: z.string().uuid().optional(),
    profileUserId: z.string().uuid().optional(),
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
  'telegramUpdates.claim': z.object({
    updateId: z.number().int().nonnegative(),
    claimToken: z.string().uuid().optional(),
  }),
  'telegramUpdates.complete': z.object({
    updateId: z.number().int().nonnegative(),
    claimToken: z.string().uuid(),
  }),
  'telegramUpdates.release': z.object({
    updateId: z.number().int().nonnegative(),
    claimToken: z.string().uuid().optional(),
  }),
  'products.list': z.object({ activeOnly: z.boolean().default(true) }),
  'products.listForUser': z.object({
    userId: z.string().uuid(),
    activeOnly: z.boolean().default(true),
  }),
  'payments.create': z.object({ userId: z.string().uuid() }).merge(createPaymentSchema),
  'payments.createGift': z.object({
    userId: z.string().uuid(),
    conversationId: z.string().uuid(),
    productId: z.string().uuid(),
    idempotencyKey: z.string().min(16).max(128),
  }),
  'payments.expirePending': z.object({}),
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
  'sessions.refresh': z.object({
    sessionHash: z.string().length(64),
    csrfHash: z.string().length(64),
    expiresAt: z.string().datetime(),
  }),
  'sessions.revoke': z.object({ sessionHash: z.string().length(64) }),
  'system.runtime': z.object({}),
  'moderators.assign': z.object({
    ownerTelegramUserId: z.number().int().positive(),
    targetTelegramUserId: z.number().int().positive(),
  }),
  'moderators.remove': z.object({
    ownerTelegramUserId: z.number().int().positive(),
    targetTelegramUserId: z.number().int().positive(),
  }),
  'moderators.list': z.object({
    ownerTelegramUserId: z.number().int().positive(),
  }),
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
      query: z.string().max(128).default(''),
      status: z
        .enum(['draft', 'pending', 'approved', 'rejected', 'paused', 'archived', 'all'])
        .default('pending'),
    })
    .merge(paginationSchema),
  'admin.publicProfiles.list': z
    .object({
      adminUserId: z.string().uuid(),
      query: z.string().max(128).default(''),
      status: z.enum(['active', 'blocked', 'all']).default('all'),
    })
    .merge(paginationSchema),
  'admin.publicProfile.moderate': z.object({
    adminUserId: z.string().uuid(),
    profileUserId: z.string().uuid(),
    status: z.enum(['active', 'blocked', 'limited', 'shadow_banned']),
    reason: z.string().min(3).max(1_000),
  }),
  'admin.profileUsernames.replace': z.object({
    adminUserId: z.string().uuid(),
    targetUserId: z.string().uuid(),
    usernames: z.array(publicProfileUsernameSchema).max(5),
  }),
  'admin.questionnaires.list': z
    .object({
      adminUserId: z.string().uuid(),
      query: z.string().max(128).default(''),
      status: z
        .enum(['draft', 'pending', 'approved', 'rejected', 'paused', 'archived', 'all'])
        .default('all'),
    })
    .merge(paginationSchema),
  'admin.questionnaire.moderate': z.object({
    adminUserId: z.string().uuid(),
    questionnaireId: z.string().uuid(),
    status: z.enum(['approved', 'rejected', 'paused', 'archived']),
    reason: z.string().min(3).max(1_000),
  }),
  'admin.posts.list': z
    .object({
      adminUserId: z.string().uuid(),
      status: z.enum(['active', 'deleted', 'blocked', 'all']).default('active'),
      query: z.string().max(128).default(''),
    })
    .merge(paginationSchema),
  'admin.post.moderate': z.object({
    adminUserId: z.string().uuid(),
    postId: z.string().uuid(),
    status: z.enum(['active', 'blocked', 'limited', 'shadow_banned']),
    reason: z.string().min(3).max(1_000),
  }),
  'admin.comment.delete': z.object({
    adminUserId: z.string().uuid(),
    commentId: z.string().uuid(),
    reason: z.string().min(3).max(1_000),
  }),
  'admin.media.list': z
    .object({
      adminUserId: z.string().uuid(),
      status: z.enum(['pending', 'approved', 'rejected', 'all']).default('pending'),
    })
    .merge(paginationSchema),
  'admin.media.moderate': z.object({
    adminUserId: z.string().uuid(),
    mediaId: z.string().uuid(),
    status: z.enum(['approved', 'rejected']),
    reason: z.string().max(1_000),
  }),
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
    buttonText: z.string().min(1).max(64).optional(),
    buttonUrl: z.string().url().max(512).optional(),
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
    action: z.enum([
      'warn',
      'temporary_ban',
      'permanent_ban',
      'unban',
      'disable_profile',
      'reset_captcha',
    ]),
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
  'admin.promotions.list': z.object({ adminUserId: z.string().uuid() }).merge(paginationSchema),
  'admin.promotions.create': z.object({
    adminUserId: z.string().uuid(),
    code: z.string().trim().min(3).max(40),
    type: z.enum(['discount', 'premium_days']),
    discountStars: z.number().int().min(0).max(10_000),
    discountRubles: z.number().int().min(0).max(1_000_000),
    premiumDays: z.number().int().min(0).max(3_650),
    eligibleProductIds: z.array(z.string().uuid()).max(100),
    expiresAt: z.string().datetime().optional(),
    maxActivations: z.number().int().min(1).max(1_000_000).optional(),
  }),
  'admin.promotions.update': z.object({
    adminUserId: z.string().uuid(),
    promotionId: z.string().uuid(),
    code: z.string().trim().min(3).max(40),
    type: z.enum(['discount', 'premium_days']),
    discountStars: z.number().int().min(0).max(10_000),
    discountRubles: z.number().int().min(0).max(1_000_000),
    premiumDays: z.number().int().min(0).max(3_650),
    eligibleProductIds: z.array(z.string().uuid()).max(100),
    expiresAt: z.string().datetime().nullable(),
    maxActivations: z.number().int().min(1).max(1_000_000).nullable(),
    isActive: z.boolean(),
  }),
  'admin.promotions.delete': z.object({
    adminUserId: z.string().uuid(),
    promotionId: z.string().uuid(),
  }),
  'admin.postingRequirements.list': z
    .object({ adminUserId: z.string().uuid() })
    .merge(paginationSchema),
  'admin.postingRequirements.create': z.object({
    adminUserId: z.string().uuid(),
    type: z.enum(['channel', 'supergroup', 'bot']),
    title: z.string().trim().min(3).max(120),
    targetChatId: z.string().max(64).optional(),
    username: z.string().max(32).optional(),
    actionUrl: z.string().url().max(500),
    botVerificationSecretHash: z.string().length(64).optional(),
    expiresAt: z.string().datetime().optional(),
    maxConversions: z.number().int().min(1).max(1_000_000).optional(),
  }),
  'admin.postingRequirements.update': z.object({
    adminUserId: z.string().uuid(),
    requirementId: z.string().uuid(),
    isActive: z.boolean(),
  }),
  'admin.flags.list': z.object({ adminUserId: z.string().uuid() }),
  'admin.flags.update': z.object({
    adminUserId: z.string().uuid(),
    key: z.string().min(1).max(64),
    enabled: z.boolean(),
    payload: z.record(z.unknown()).default({}),
  }),
  'admin.config.list': z.object({ adminUserId: z.string().uuid() }),
  'admin.config.update': z.object({
    adminUserId: z.string().uuid(),
    key: z.enum([
      'search_limit',
      'relay_rate_limit',
      'free_daily_profile_limit',
      'premium_daily_profile_limit',
      'free_super_like_limit',
      'premium_super_like_limit',
      'boost_cooldown_days',
      'support_text',
      'maintenance_text',
    ]),
    value: z.string().max(4_000),
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
