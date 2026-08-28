import path from 'node:path';
import { fileURLToPath } from 'node:url';
import Fastify, { type FastifyInstance, type FastifyReply, type FastifyRequest } from 'fastify';
import cookie from '@fastify/cookie';
import cors from '@fastify/cors';
import helmet from '@fastify/helmet';
import rateLimit from '@fastify/rate-limit';
import staticFiles from '@fastify/static';
import swagger from '@fastify/swagger';
import swaggerUi from '@fastify/swagger-ui';
import {
  OWNER_TELEGRAM_ID,
  menuLaunchRouteSchema,
  ageGroupSchema,
  profileSchema,
  ru,
  sha256,
  validateTelegramInitData,
  verifyMenuLaunchToken,
} from '@rolemate/shared';
import { z } from 'zod';
import { createBot } from './bot.js';
import { buildQuickStartProfile } from './quick-start.js';
import { DataApiError, DataApiClient, findDataApiError } from './d1-client.js';
import type { AppEnv } from './env.js';
import { assertCsrf, createSession, getSession, refreshSession } from './session.js';
import { TelegramStarsProvider } from './payments/telegram-stars.js';
import { dispatchBroadcastBatch } from './broadcast.js';
import { validateUserContentLinks } from './content-policy.js';
import { InlineKeyboard, InputFile } from 'grammy';
import { decryptChatContent, encryptChatContent } from './chat-crypto.js';
import { telegramAudioMetadata } from './telegram-audio-metadata.js';
import { dispatchTelegramNotificationBatch } from './telegram-notifications.js';

const authBodySchema = z.object({ initData: z.string().min(1).max(8_192) });

function telegramUpdateChatId(update: unknown): number | undefined {
  if (!update || typeof update !== 'object') return undefined;
  const root = update as Record<string, unknown>;
  const candidates = [
    root.message,
    root.edited_message,
    root.channel_post,
    root.edited_channel_post,
    root.my_chat_member,
    root.callback_query &&
    typeof root.callback_query === 'object' &&
    'message' in root.callback_query
      ? root.callback_query.message
      : undefined,
  ];
  for (const candidate of candidates) {
    if (!candidate || typeof candidate !== 'object' || !('chat' in candidate)) continue;
    const chat = candidate.chat;
    if (chat && typeof chat === 'object' && 'id' in chat && typeof chat.id === 'number') {
      return chat.id;
    }
  }
  return undefined;
}

function telegramApiErrorCode(error: unknown): number | undefined {
  let candidate: unknown = error;
  for (let depth = 0; depth < 3; depth += 1) {
    if (!candidate || typeof candidate !== 'object') return undefined;
    if (
      'error_code' in candidate &&
      typeof (candidate as { error_code?: unknown }).error_code === 'number'
    ) {
      return (candidate as { error_code: number }).error_code;
    }
    candidate = 'error' in candidate ? (candidate as { error?: unknown }).error : undefined;
  }
  return undefined;
}
const menuAuthBodySchema = z.object({
  token: z.string().min(80).max(1_024),
  route: menuLaunchRouteSchema,
});
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
const swipeBodySchema = z.object({
  targetUserId: z.string().uuid(),
  questionnaireId: z.string().uuid().optional(),
  action: z.enum(['like', 'skip', 'super_like', 'rewind']),
});
const deleteBodySchema = z.object({ confirmation: z.literal(ru.api.deleteConfirmation) });
const captchaBodySchema = z.object({
  token: z.string().min(1).max(4_096),
  action: z.string().max(64),
});
const blockBodySchema = z.object({
  blockedUserId: z.string().uuid(),
  reason: z.string().max(500).default('user_request'),
});
const reportBodySchema = z.object({
  reportedUserId: z.string().uuid(),
  conversationId: z.string().uuid().optional(),
  postId: z.string().uuid().optional(),
  questionnaireId: z.string().uuid().optional(),
  commentId: z.string().uuid().optional(),
  profileUserId: z.string().uuid().optional(),
  category: z.enum([
    'spam',
    'advertising',
    'insults',
    'harassment',
    'unwanted_content',
    'impersonation',
    'fraud',
    'personal_data',
    'prohibited_adult_content',
    'unsafe_minor',
    'other',
  ]),
  description: z.string().max(1_500).default(''),
});
const settingsBodySchema = z.object({
  notificationsEnabled: z.boolean(),
  telegramNotificationsEnabled: z.boolean(),
  matchNotificationsEnabled: z.boolean(),
  messageNotificationsEnabled: z.boolean(),
  mentionNotificationsEnabled: z.boolean(),
  commentNotificationsEnabled: z.boolean(),
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
});
const chatMediaBodySchema = z.object({
  kind: z.enum(['photo', 'animation', 'video', 'audio', 'voice']),
  fileName: z.string().trim().min(1).max(180),
  mimeType: z.string().trim().min(3).max(120),
  dataBase64: z.string().min(1).max(28_100_000),
  mediaGroupId: z.string().uuid().optional(),
  playlistTitle: z.string().trim().min(1).max(120).nullable().optional(),
  notifyRecipient: z.boolean().default(true),
  replyToMessageId: z.string().uuid().optional(),
  caption: z.string().trim().max(4_000).optional(),
  captionPosition: z.enum(['top', 'bottom']).default('bottom'),
});
const telegramProfileShareSchema = z.object({
  kind: z.literal('telegram_profile'),
  displayName: z.string().trim().min(1).max(128),
  username: z.string().trim().max(32).nullable(),
  url: z
    .string()
    .max(160)
    .refine(
      (value) =>
        /^https:\/\/t\.me\/[A-Za-z0-9_]{4,32}$/.test(value) ||
        /^tg:\/\/user\?id=\d{1,20}$/.test(value),
    ),
  avatarFileId: z.string().min(1).max(512).nullable().optional(),
});

function recordValue(value: unknown): Record<string, unknown> | undefined {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : undefined;
}

function telegramFileRequestInit(request: FastifyRequest): RequestInit {
  const requestedRange = request.headers.range;
  const range =
    typeof requestedRange === 'string' && /^bytes=\d*-\d*$/.test(requestedRange)
      ? requestedRange
      : undefined;
  return {
    ...(range ? { headers: { Range: range } } : {}),
    signal: AbortSignal.timeout(20_000),
  };
}

function applySeekableMediaHeaders(reply: FastifyReply, response: Response): void {
  if (response.status === 206) reply.code(206);
  reply.header('Accept-Ranges', response.headers.get('accept-ranges') ?? 'bytes');
  const contentRange = response.headers.get('content-range');
  if (contentRange) reply.header('Content-Range', contentRange);
  const contentLength = response.headers.get('content-length');
  if (contentLength) reply.header('Content-Length', contentLength);
}

function telegramMediaFileId(message: unknown, kind: z.infer<typeof chatMediaBodySchema>['kind']) {
  const value = recordValue(message);
  if (!value) return undefined;
  if (kind === 'photo' && Array.isArray(value.photo)) {
    const photo = recordValue(value.photo.at(-1));
    return typeof photo?.file_id === 'string' ? photo.file_id : undefined;
  }
  const media =
    kind === 'voice'
      ? (recordValue(value.voice) ?? recordValue(value.audio) ?? recordValue(value.document))
      : (recordValue(value[kind]) ?? recordValue(value.document));
  return typeof media?.file_id === 'string' ? media.file_id : undefined;
}

async function verifyTurnstile(secret: string, token: string, remoteIp?: string): Promise<boolean> {
  if (!secret) return false;
  const form = new URLSearchParams({ secret, response: token });
  if (remoteIp) form.set('remoteip', remoteIp);
  const response = await fetch('https://challenges.cloudflare.com/turnstile/v0/siteverify', {
    method: 'POST',
    body: form,
    signal: AbortSignal.timeout(5_000),
  });
  if (!response.ok) return false;
  const rawResult: unknown = await response.json();
  const result = rawResult as { success?: boolean };
  return result.success === true;
}

export interface ServerOptions {
  serveMiniApp?: boolean;
  startBroadcastDispatcher?: boolean;
  dataApiFetch?: typeof fetch;
  telegramFetch?: typeof fetch;
  logger?: boolean;
  apiDocs?: boolean;
  syncBotCommands?: boolean;
}

export async function buildServer(
  env: AppEnv,
  options: ServerOptions = {},
): Promise<FastifyInstance> {
  const serveMiniApp = options.serveMiniApp ?? true;
  const startBroadcastDispatcher = options.startBroadcastDispatcher ?? true;
  const app = Fastify({
    logger:
      options.logger === false
        ? false
        : {
            level: env.LOG_LEVEL,
            redact: {
              paths: [
                'req.headers.authorization',
                'req.headers.cookie',
                'req.body.initData',
                'req.body.token',
                'req.body.dataBase64',
                'res.headers["set-cookie"]',
              ],
              censor: '[REDACTED]',
            },
          },
    bodyLimit: 256 * 1024,
    requestIdHeader: 'x-request-id',
    genReqId: () => crypto.randomUUID(),
    trustProxy: true,
  });
  const dataApi = new DataApiClient({
    baseUrl: env.D1_WORKER_URL,
    serviceId: env.INTERNAL_SERVICE_ID,
    secret: env.INTERNAL_API_SECRET,
    ...(options.dataApiFetch ? { fetchImpl: options.dataApiFetch } : {}),
  });
  const bot = createBot(env, dataApi, options.telegramFetch, options.syncBotCommands);
  if (env.TELEGRAM_BOT_TOKEN) await bot.init();
  const queueChatTelegramNotification = async (input: {
    targetUserId: string;
    conversationId: string;
    sourceKey: string;
  }): Promise<void> => {
    try {
      const queued = await dataApi.execute<{ queued: boolean }>('notifications.telegram.enqueue', {
        targetUserId: input.targetUserId,
        conversationId: input.conversationId,
        category: 'message',
        openPath: `/chats?conversation=${encodeURIComponent(input.conversationId)}`,
        sourceKey: input.sourceKey,
        message: ru.bot.newMessageNotification,
      });
      if (!queued.queued) return;
      await dispatchTelegramNotificationBatch(bot, dataApi, env, (error) => {
        app.log.error(
          {
            event: 'telegram_notification_dispatch_failed',
            error: error instanceof Error ? error.message : 'unknown',
          },
          'queued Telegram notification remains pending for scheduled retry',
        );
      });
    } catch (error) {
      app.log.error(
        {
          event: 'telegram_notification_enqueue_failed',
          error: error instanceof Error ? error.message : 'unknown',
        },
        'chat delivery remains successful even when its Telegram notification cannot be queued',
      );
    }
  };
  const extractMentions = (text: string): string[] =>
    [
      ...new Set(
        [...text.matchAll(/(^|[^\p{L}\p{N}_])@([a-z][a-z0-9_]{3,31})/giu)].map((match) =>
          match[2]!.toLowerCase(),
        ),
      ),
    ].slice(0, 20);
  const queueTelegramActivityNotification = async (input: {
    targetUserId: string;
    category:
      | 'like'
      | 'follow'
      | 'reaction'
      | 'mention'
      | 'comment'
      | 'premium'
      | 'moderation'
      | 'follower_post'
      | 'follower_questionnaire';
    message: string;
    openPath: string;
    sourceKey: string;
  }): Promise<void> => {
    try {
      const queued = await dataApi.execute<{ queued: boolean }>('notifications.telegram.enqueue', {
        ...input,
      });
      if (queued.queued) {
        await dispatchTelegramNotificationBatch(bot, dataApi, env, (error) => {
          app.log.error(
            {
              event: 'telegram_notification_dispatch_failed',
              error: error instanceof Error ? error.message : 'unknown',
            },
            'queued Telegram notification remains pending for scheduled retry',
          );
        });
      }
    } catch (error) {
      app.log.error(
        {
          event: 'telegram_activity_notification_enqueue_failed',
          error: error instanceof Error ? error.message : 'unknown',
        },
        'the user action succeeded; Telegram delivery will not change its result',
      );
    }
  };
  const notifyMentions = async (input: {
    actorUserId: string;
    text: string;
    context: 'chat' | 'questionnaire' | 'post' | 'comment';
    entityId?: string;
    openPath: string;
    sourceKey: string;
  }): Promise<void> => {
    const usernames = extractMentions(input.text);
    if (!usernames.length) return;
    const message = ru.bot.mentionNotification(ru.bot.mentionPlaces[input.context]);
    const deliveries = await dataApi.execute<
      Array<{ user_id: string; telegram_user_id: number | null; open_path: string }>
    >('notifications.mentions.create', {
      actorUserId: input.actorUserId,
      usernames,
      context: input.context,
      ...(input.entityId ? { entityId: input.entityId } : {}),
      openPath: input.openPath,
      sourceKey: input.sourceKey,
      message,
    });
    await Promise.allSettled(
      deliveries.map((delivery) =>
        queueTelegramActivityNotification({
          targetUserId: delivery.user_id,
          category: 'mention',
          message,
          openPath: delivery.open_path,
          sourceKey: `${input.sourceKey}:telegram:${delivery.user_id}`,
        }),
      ),
    );
  };
  const notifyFollowers = async (input: {
    actorUserId: string;
    entityType: 'post' | 'questionnaire';
    entityId: string;
    openPath: string;
    message: string;
  }): Promise<void> => {
    const deliveries = await dataApi.execute<
      Array<{ user_id: string; telegram_user_id: number | null; open_path: string }>
    >('notifications.followers.create', input);
    await Promise.allSettled(
      deliveries.map((delivery) =>
        queueTelegramActivityNotification({
          targetUserId: delivery.user_id,
          category: input.entityType === 'post' ? 'follower_post' : 'follower_questionnaire',
          message: input.message,
          openPath: delivery.open_path,
          sourceKey: `follower:${input.entityType}:${input.entityId}:telegram:${delivery.user_id}`,
        }),
      ),
    );
  };
  const stars = new TelegramStarsProvider(bot);
  let broadcastTimer: NodeJS.Timeout | undefined;
  let broadcastDispatching = false;
  let runtimeCache: {
    maintenanceMode: boolean;
    maintenanceText: string;
    expiresAt: number;
  } | null = null;

  await app.register(cookie, {
    secret: env.SESSION_SECRET,
    hook: 'onRequest',
  });

  app.addHook('onReady', () => {
    if (!startBroadcastDispatcher || !env.TELEGRAM_BOT_TOKEN || !env.D1_WORKER_URL) return;
    broadcastTimer = setInterval(() => {
      if (broadcastDispatching) return;
      broadcastDispatching = true;
      void dispatchBroadcastBatch(bot, dataApi, (error) => {
        app.log.error(
          { error: error instanceof Error ? error.message : 'unknown' },
          'broadcast dispatcher failed',
        );
      }).finally(() => {
        broadcastDispatching = false;
      });
    }, 1_000);
    broadcastTimer.unref();
  });
  app.addHook('onClose', () => {
    if (broadcastTimer) clearInterval(broadcastTimer);
  });
  await app.register(cors, {
    origin: env.ALLOWED_ORIGINS.split(',').map((value) => value.trim()),
    credentials: true,
    methods: ['GET', 'POST', 'PUT', 'DELETE', 'OPTIONS'],
  });
  app.addHook('preHandler', async (request, reply) => {
    if (
      !request.url.startsWith('/api/') ||
      request.url.startsWith('/api/admin/') ||
      request.url.startsWith('/api/auth/')
    ) {
      return;
    }
    if (!runtimeCache || runtimeCache.expiresAt < Date.now()) {
      const state = await dataApi.execute<{
        maintenanceMode: boolean;
        maintenanceText: string;
      }>('system.runtime', {});
      runtimeCache = { ...state, expiresAt: Date.now() + 30_000 };
    }
    if (runtimeCache.maintenanceMode) {
      return reply.code(503).send({
        error: 'MAINTENANCE_MODE',
        message: runtimeCache.maintenanceText || ru.api.maintenance,
      });
    }
  });
  await app.register(helmet, {
    contentSecurityPolicy: {
      directives: {
        defaultSrc: ["'self'"],
        scriptSrc: ["'self'", 'https://telegram.org', 'https://challenges.cloudflare.com'],
        frameSrc: ["'self'", 'https://challenges.cloudflare.com', 'https://t.me'],
        connectSrc: ["'self'", 'https://telegram.org', 'https://challenges.cloudflare.com'],
        imgSrc: ["'self'", 'data:', 'blob:', 'https:'],
        styleSrc: ["'self'", "'unsafe-inline'"],
      },
    },
    crossOriginEmbedderPolicy: false,
  });
  await app.register(rateLimit, {
    max: 120,
    timeWindow: '1 minute',
    keyGenerator: (request) => request.ip,
    errorResponseBuilder: () => ({
      statusCode: 429,
      error: 'RATE_LIMITED',
      message: ru.api.rateLimit,
    }),
  });
  if (options.apiDocs !== false) {
    await app.register(swagger, {
      openapi: {
        info: { title: `${env.BOT_NAME} API`, version: '0.1.0' },
        servers: env.PUBLIC_BASE_URL ? [{ url: env.PUBLIC_BASE_URL }] : [],
      },
    });
    await app.register(swaggerUi, { routePrefix: '/internal/docs' });
  }

  const authenticate = async (request: FastifyRequest) => getSession(request, dataApi);
  const mutate = async (request: FastifyRequest) => {
    const session = await authenticate(request);
    await assertCsrf(request, session);
    return session;
  };
  const mutateSafe = async (request: FastifyRequest) => {
    const session = await mutate(request);
    if (session.riskScore >= 50) {
      throw new DataApiError('CAPTCHA_REQUIRED', 'Complete CAPTCHA to continue', 428);
    }
    return session;
  };
  const requireAdmin = async (request: FastifyRequest, csrf = false) => {
    const session = csrf ? await mutate(request) : await authenticate(request);
    if (session.telegramUserId !== OWNER_TELEGRAM_ID || session.role !== 'admin') {
      const ipSignalHash = await sha256(`${env.SESSION_SECRET}:${request.ip}`);
      await dataApi
        .execute('risk.record', {
          userId: session.userId,
          type: 'unauthorized_admin_access',
          scoreDelta: 15,
          metadata: { path: request.url, requestId: request.id, ipSignalHash },
        })
        .catch(() => undefined);
      throw new DataApiError('FORBIDDEN', 'Forbidden', 403);
    }
    return session;
  };
  const requireModerationAccess = async (request: FastifyRequest, csrf = false) => {
    const session = csrf ? await mutate(request) : await authenticate(request);
    if (!['admin', 'moderator'].includes(session.role)) {
      const ipSignalHash = await sha256(`${env.SESSION_SECRET}:${request.ip}`);
      await dataApi
        .execute('risk.record', {
          userId: session.userId,
          type: 'unauthorized_admin_access',
          scoreDelta: 15,
          metadata: { path: request.url, requestId: request.id, ipSignalHash },
        })
        .catch(() => undefined);
      throw new DataApiError('FORBIDDEN', 'Forbidden', 403);
    }
    return session;
  };
  const writeAdminAudit = async (
    request: FastifyRequest,
    adminUserId: string,
    action: string,
    reason: string,
    targetUserId?: string,
  ): Promise<void> => {
    try {
      await dataApi.execute('admin.audit', {
        adminUserId,
        action,
        reason,
        ...(targetUserId ? { targetUserId } : {}),
        ipSignalHash: await sha256(`${env.SESSION_SECRET}:${request.ip}`),
        userAgent: String(request.headers['user-agent'] ?? '').slice(0, 512),
        requestId: request.id,
      });
    } catch (error) {
      app.log.error(
        {
          event: 'admin_audit_context_write_failed',
          error: error instanceof Error ? error.message : 'unknown',
          requestId: request.id,
        },
        'the completed admin action is not rolled back by a secondary audit-context failure',
      );
    }
  };

  app.get('/health/live', () => ({ status: 'ok' }));
  app.get('/health/startup', async (_request, reply) => {
    const configured =
      env.NODE_ENV !== 'production' || Boolean(env.TELEGRAM_BOT_TOKEN && env.D1_WORKER_URL);
    return reply
      .code(configured ? 200 : 503)
      .send({ status: configured ? 'started' : 'misconfigured' });
  });
  app.get('/health/ready', async (_request, reply) => {
    const d1 = await dataApi.health();
    return reply
      .code(d1 ? 200 : 503)
      .send({ status: d1 ? 'ready' : 'unavailable', dependencies: { d1 } });
  });
  app.get('/version', () => ({
    name: env.BOT_NAME,
    version: '0.1.0',
    commitSha: env.COMMIT_SHA,
    environment: env.DEPLOYMENT_ENV,
  }));

  app.post('/telegram/webhook', { config: { rateLimit: false } }, async (request, reply) => {
    const secret = request.headers['x-telegram-bot-api-secret-token'];
    if (secret !== env.TELEGRAM_WEBHOOK_SECRET) {
      return reply.code(401).send({ ok: false });
    }
    const update = request.body as Parameters<typeof bot.handleUpdate>[0];
    const updateId = (update as { update_id?: unknown }).update_id;
    if (!Number.isInteger(updateId)) return reply.code(400).send({ ok: false });
    const claimToken = crypto.randomUUID();
    const claim = await dataApi.execute<{
      claimed: boolean;
      state: 'processing' | 'completed';
    }>('telegramUpdates.claim', { updateId: updateId as number, claimToken });
    if (!claim.claimed) {
      return claim.state === 'completed'
        ? reply.code(200).send({ ok: true, duplicate: true })
        : reply.code(503).send({ ok: false, retry: true });
    }
    try {
      try {
        await bot.handleUpdate(update);
      } catch (error) {
        const dataApiError = findDataApiError(error);
        if (dataApiError && dataApiError.status < 500) {
          const chatId = telegramUpdateChatId(update);
          if (chatId !== undefined) {
            const message =
              ru.bot.errors[dataApiError.code as keyof typeof ru.bot.errors] ??
              ru.bot.errors.default;
            await bot.api.sendMessage(chatId, message).catch((fallbackError: unknown) => {
              request.log.error(
                {
                  updateId,
                  handlerError: dataApiError.message,
                  fallbackError: fallbackError instanceof Error ? fallbackError.message : 'unknown',
                },
                'telegram_error_reply_failed',
              );
            });
          }
        } else {
          const telegramErrorCode = telegramApiErrorCode(error);
          if (telegramErrorCode !== 400 && telegramErrorCode !== 403) throw error;
          request.log.warn(
            { updateId, telegramErrorCode },
            'telegram_permanent_delivery_error_ignored',
          );
        }
      }
      const completion = await dataApi.execute<{ completed: boolean }>('telegramUpdates.complete', {
        updateId: updateId as number,
        claimToken,
      });
      if (!completion.completed) {
        throw new Error(`Telegram update ${String(updateId)} lost its processing lease`);
      }
    } catch (error) {
      await dataApi
        .execute('telegramUpdates.release', { updateId: updateId as number, claimToken })
        .catch(() => undefined);
      throw error;
    }
    return reply.code(200).send({ ok: true });
  });

  app.post(
    '/internal/telegram-webhook-status',
    { config: { rateLimit: { max: 10, timeWindow: '1 minute' } } },
    async (request, reply) => {
      const secret = request.headers['x-telegram-bot-api-secret-token'];
      if (secret !== env.TELEGRAM_WEBHOOK_SECRET) {
        return reply.code(401).send({ ok: false });
      }
      const [info, privateCommands, groupCommands, administratorCommands, defaultCommands] =
        await Promise.all([
          bot.api.getWebhookInfo(),
          bot.api.getMyCommands({ scope: { type: 'all_private_chats' } }),
          bot.api.getMyCommands({ scope: { type: 'all_group_chats' } }),
          bot.api.getMyCommands({ scope: { type: 'all_chat_administrators' } }),
          bot.api.getMyCommands({ scope: { type: 'default' } }),
        ]);
      return {
        ok: true,
        url: info.url,
        hasCustomCertificate: info.has_custom_certificate,
        pendingUpdateCount: info.pending_update_count,
        ipAddress: info.ip_address ?? null,
        lastErrorDate: info.last_error_date ?? null,
        lastErrorMessage: info.last_error_message ?? null,
        lastSynchronizationErrorDate: info.last_synchronization_error_date ?? null,
        maxConnections: info.max_connections ?? null,
        allowedUpdates: info.allowed_updates ?? [],
        commandScopes: {
          private: privateCommands.map(({ command }) => command),
          groups: groupCommands.map(({ command }) => command),
          administrators: administratorCommands.map(({ command }) => command),
          default: defaultCommands.map(({ command }) => command),
        },
      };
    },
  );

  app.post(
    '/api/auth/telegram',
    { config: { rateLimit: { max: 30, timeWindow: '1 minute' } } },
    async (request, reply) => {
      const body = authBodySchema.parse(request.body);
      const validated = await validateTelegramInitData(body.initData, env.TELEGRAM_BOT_TOKEN);
      const user = await dataApi.execute<{ userId: string; role: string }>('users.upsert', {
        telegramUser: validated.user,
      });
      const session = await createSession(dataApi, user.userId);
      reply.setCookie('rm_session', session.token, {
        path: '/',
        httpOnly: true,
        secure: env.NODE_ENV === 'production',
        sameSite: 'strict',
        expires: session.expiresAt,
      });
      return {
        user: { id: user.userId, telegramUserId: validated.user.id, role: user.role },
        csrfToken: session.csrfToken,
      };
    },
  );

  app.post(
    '/api/auth/menu',
    { config: { rateLimit: { max: 30, timeWindow: '1 minute' } } },
    async (request, reply) => {
      const body = menuAuthBodySchema.parse(request.body);
      let launch: Awaited<ReturnType<typeof verifyMenuLaunchToken>>;
      try {
        launch = await verifyMenuLaunchToken({
          token: body.token,
          route: body.route,
          secret: env.SESSION_SECRET,
        });
      } catch {
        throw new DataApiError('INVALID_MENU_LAUNCH', ru.miniApp.auth.invalidData, 401);
      }
      const user = await dataApi.execute<{
        id: string;
        telegram_user_id: number;
        role: string;
        status: string;
        is_banned: number;
      } | null>('users.get', { telegramUserId: launch.telegramUserId });
      if (
        !user ||
        user.telegram_user_id !== launch.telegramUserId ||
        user.status !== 'active' ||
        user.is_banned
      ) {
        throw new DataApiError('INVALID_MENU_LAUNCH', ru.miniApp.auth.invalidData, 401);
      }
      const session = await createSession(dataApi, user.id);
      reply.setCookie('rm_session', session.token, {
        path: '/',
        httpOnly: true,
        secure: env.NODE_ENV === 'production',
        sameSite: 'strict',
        expires: session.expiresAt,
      });
      return {
        user: {
          id: user.id,
          telegramUserId: user.telegram_user_id,
          role: user.role,
        },
        csrfToken: session.csrfToken,
      };
    },
  );

  app.post(
    '/api/auth/session',
    { config: { rateLimit: { max: 30, timeWindow: '1 minute' } } },
    async (request, reply) => {
      const renewed = await refreshSession(request, dataApi);
      const session = await getSession(request, dataApi);
      reply.setCookie('rm_session', renewed.token, {
        path: '/',
        httpOnly: true,
        secure: env.NODE_ENV === 'production',
        sameSite: 'strict',
        expires: renewed.expiresAt,
      });
      return {
        user: {
          id: session.userId,
          telegramUserId: session.telegramUserId,
          role: session.role,
          isAdmin: ['admin', 'moderator'].includes(session.role),
          isOwner: session.telegramUserId === OWNER_TELEGRAM_ID && session.role === 'admin',
        },
        csrfToken: renewed.csrfToken,
      };
    },
  );

  app.get('/api/me', async (request) => {
    const session = await authenticate(request);
    return {
      userId: session.userId,
      telegramUserId: session.telegramUserId,
      role: session.role,
      isAdmin: ['admin', 'moderator'].includes(session.role),
      isOwner: session.telegramUserId === OWNER_TELEGRAM_ID && session.role === 'admin',
      riskScore: session.riskScore,
    };
  });
  app.get('/api/notifications', async (request) => {
    const session = await authenticate(request);
    return dataApi.execute('notifications.list', { userId: session.userId, limit: 50 });
  });
  app.put('/api/notifications/:notificationId/read', async (request) => {
    const session = await mutateSafe(request);
    const { notificationId } = z
      .object({ notificationId: z.string().uuid() })
      .parse(request.params);
    return dataApi.execute('notifications.read', {
      userId: session.userId,
      notificationId,
    });
  });
  app.delete('/api/notifications/:notificationId', async (request) => {
    const session = await mutateSafe(request);
    const { notificationId } = z
      .object({ notificationId: z.string().uuid() })
      .parse(request.params);
    return dataApi.execute('notifications.dismiss', { userId: session.userId, notificationId });
  });
  app.delete('/api/notifications', async (request) => {
    const session = await mutateSafe(request);
    return dataApi.execute('notifications.dismissAll', { userId: session.userId });
  });
  app.get('/api/mentions/resolve', async (request) => {
    const session = await authenticate(request);
    const { usernames } = z
      .object({ usernames: z.string().max(700).default('') })
      .parse(request.query);
    const aliases = [
      ...new Set(
        usernames
          .split(',')
          .map((value) => value.trim().toLowerCase())
          .filter((value) => publicProfileUsernameSchema.safeParse(value).success),
      ),
    ].slice(0, 20);
    return dataApi.execute('mentions.resolve', {
      requesterUserId: session.userId,
      usernames: aliases,
    });
  });

  app.get('/api/profile', async (request) => {
    const session = await authenticate(request);
    return dataApi.execute('profiles.getOwn', { userId: session.userId });
  });
  app.get('/api/public-profile', async (request) => {
    const session = await authenticate(request);
    return dataApi.execute('publicProfiles.getOwn', { userId: session.userId });
  });
  app.put('/api/public-profile', async (request) => {
    const session = await mutateSafe(request);
    const body = z
      .object({
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
        accentColor: z.number().int().min(0).max(15).nullable().optional(),
        headerEmoji: z.string().trim().min(1).max(8).nullable().optional(),
      })
      .parse(request.body);
    return dataApi.execute('publicProfiles.update', { userId: session.userId, ...body });
  });
  app.put('/api/public-profile/privacy', async (request) => {
    const session = await mutateSafe(request);
    const body = z
      .object({
        visibilityMode: z.enum(['public', 'following_only']),
        showFollowers: z.boolean(),
        showFollowing: z.boolean(),
        showQuestionnaires: z.boolean(),
        showPosts: z.boolean(),
        showLastSeen: z.boolean(),
        directMessagePolicy: z.enum(['everyone', 'following_and_staff']),
      })
      .parse(request.body);
    return dataApi.execute('publicProfiles.updatePrivacy', { userId: session.userId, ...body });
  });
  app.get('/api/public-profile/usernames', async (request) => {
    const session = await authenticate(request);
    return dataApi.execute('profileUsernames.listOwn', { userId: session.userId });
  });
  app.post('/api/public-profile/usernames', async (request) => {
    const session = await mutateSafe(request);
    const { username } = z.object({ username: profileUsernameSchema }).parse(request.body);
    return dataApi.execute('profileUsernames.claim', { userId: session.userId, username });
  });
  app.put('/api/public-profile/usernames', async (request) => {
    const session = await mutateSafe(request);
    const { username } = z.object({ username: profileUsernameSchema }).parse(request.body);
    return dataApi.execute('profileUsernames.replaceOwn', { userId: session.userId, username });
  });
  app.delete('/api/public-profile/usernames/:username', async (request) => {
    const session = await mutateSafe(request);
    const { username } = z.object({ username: profileUsernameSchema }).parse(request.params);
    return dataApi.execute('profileUsernames.release', { userId: session.userId, username });
  });
  app.get('/api/profiles/by-username/:username', async (request) => {
    const session = await authenticate(request);
    const { username } = z.object({ username: profileUsernameSchema }).parse(request.params);
    return dataApi.execute('publicProfiles.getByUsername', {
      requesterUserId: session.userId,
      username,
    });
  });
  app.get('/api/users/:userId/profile', async (request) => {
    const session = await authenticate(request);
    const { userId } = z.object({ userId: z.string().uuid() }).parse(request.params);
    return dataApi.execute('publicProfiles.get', {
      requesterUserId: session.userId,
      profileUserId: userId,
    });
  });
  app.post('/api/users/:userId/follow', async (request) => {
    const session = await mutateSafe(request);
    const { userId } = z.object({ userId: z.string().uuid() }).parse(request.params);
    const result = await dataApi.execute<{ following: true; created: boolean }>(
      'publicProfiles.follow',
      {
        userId: session.userId,
        profileUserId: userId,
      },
    );
    if (result.created) {
      await queueTelegramActivityNotification({
        targetUserId: userId,
        category: 'follow',
        message: ru.bot.newFollowerNotification,
        openPath: `/profiles/${encodeURIComponent(session.userId)}`,
        sourceKey: `follow:${request.id}`,
      });
    }
    return result;
  });
  app.delete('/api/users/:userId/follow', async (request) => {
    const session = await mutateSafe(request);
    const { userId } = z.object({ userId: z.string().uuid() }).parse(request.params);
    return dataApi.execute('publicProfiles.unfollow', {
      userId: session.userId,
      profileUserId: userId,
    });
  });
  app.get('/api/users/:userId/followers', async (request) => {
    const session = await authenticate(request);
    const { userId } = z.object({ userId: z.string().uuid() }).parse(request.params);
    return dataApi.execute('publicProfiles.followers', {
      requesterUserId: session.userId,
      profileUserId: userId,
      limit: 50,
    });
  });
  app.get('/api/users/:userId/following', async (request) => {
    const session = await authenticate(request);
    const { userId } = z.object({ userId: z.string().uuid() }).parse(request.params);
    return dataApi.execute('publicProfiles.following', {
      requesterUserId: session.userId,
      profileUserId: userId,
      limit: 50,
    });
  });
  app.put('/api/users/:userId/profile/rating', async (request) => {
    const session = await mutateSafe(request);
    const { userId } = z.object({ userId: z.string().uuid() }).parse(request.params);
    const { value } = z
      .object({ value: z.union([z.literal(-1), z.literal(1)]) })
      .parse(request.body);
    const result = await dataApi.execute<{ saved: true; removed: boolean }>('publicProfiles.rate', {
      userId: session.userId,
      profileUserId: userId,
      value,
    });
    if (value === 1 && !result.removed) {
      await queueTelegramActivityNotification({
        targetUserId: userId,
        category: 'like',
        message: ru.bot.profileLikeNotification,
        openPath: '/profile',
        sourceKey: `profile-like:${request.id}`,
      });
    }
    return result;
  });
  app.get('/api/users/:userId/questionnaires', async (request) => {
    const session = await authenticate(request);
    const { userId } = z.object({ userId: z.string().uuid() }).parse(request.params);
    const { limit } = z
      .object({ limit: z.coerce.number().int().min(1).max(5).default(5) })
      .parse(request.query);
    return dataApi.execute('questionnaires.listPublic', {
      requesterUserId: session.userId,
      profileUserId: userId,
      limit,
    });
  });
  app.get('/api/users/:userId/posts', async (request) => {
    const session = await authenticate(request);
    const { userId } = z.object({ userId: z.string().uuid() }).parse(request.params);
    const { limit } = z
      .object({ limit: z.coerce.number().int().min(1).max(50).default(30) })
      .parse(request.query);
    return dataApi.execute('posts.author.list', {
      userId: session.userId,
      authorUserId: userId,
      limit,
    });
  });
  app.get('/api/questionnaires', async (request) => {
    const session = await authenticate(request);
    return dataApi.execute('questionnaires.listOwn', { userId: session.userId });
  });
  app.get('/api/questionnaires/:questionnaireId', async (request) => {
    const session = await authenticate(request);
    const { questionnaireId } = z
      .object({ questionnaireId: z.string().uuid() })
      .parse(request.params);
    return dataApi.execute('questionnaires.getOwn', {
      userId: session.userId,
      questionnaireId,
    });
  });
  app.get('/api/questionnaires/:questionnaireId/preview', async (request) => {
    const session = await authenticate(request);
    const { questionnaireId } = z
      .object({ questionnaireId: z.string().uuid() })
      .parse(request.params);
    return dataApi.execute('questionnaires.previewOwn', {
      userId: session.userId,
      questionnaireId,
    });
  });
  app.post('/api/questionnaires/:questionnaireId/view', async (request) => {
    const session = await mutateSafe(request);
    const { questionnaireId } = z
      .object({ questionnaireId: z.string().uuid() })
      .parse(request.params);
    return dataApi.execute('questionnaires.recordView', {
      userId: session.userId,
      questionnaireId,
    });
  });
  app.post('/api/questionnaires', async (request) => {
    const session = await mutateSafe(request);
    const body = z
      .object({ title: z.string().trim().min(2).max(80), profile: profileSchema })
      .parse(request.body);
    const created = await dataApi.execute<{ id: string }>('questionnaires.create', {
      userId: session.userId,
      ...body,
    });
    await notifyMentions({
      actorUserId: session.userId,
      text: JSON.stringify(body.profile),
      context: 'questionnaire',
      entityId: created.id,
      openPath: `/profiles/${session.userId}`,
      sourceKey: `questionnaire:${created.id}:${await sha256(JSON.stringify(body.profile))}`,
    });
    await notifyFollowers({
      actorUserId: session.userId,
      entityType: 'questionnaire',
      entityId: created.id,
      openPath: `/search?questionnaire=${encodeURIComponent(created.id)}`,
      message: ru.bot.followerQuestionnaireNotification,
    });
    return created;
  });
  app.post('/api/questionnaires/clone', async (request) => {
    const session = await mutateSafe(request);
    const { title } = z.object({ title: z.string().trim().min(2).max(80) }).parse(request.body);
    return dataApi.execute('questionnaires.clonePrimary', { userId: session.userId, title });
  });
  app.put('/api/questionnaires/:questionnaireId', async (request) => {
    const session = await mutateSafe(request);
    const { questionnaireId } = z
      .object({ questionnaireId: z.string().uuid() })
      .parse(request.params);
    const body = z
      .object({ title: z.string().trim().min(2).max(80), profile: profileSchema })
      .parse(request.body);
    const updated = await dataApi.execute('questionnaires.update', {
      userId: session.userId,
      questionnaireId,
      ...body,
    });
    await notifyMentions({
      actorUserId: session.userId,
      text: JSON.stringify(body.profile),
      context: 'questionnaire',
      entityId: questionnaireId,
      openPath: `/profiles/${session.userId}`,
      sourceKey: `questionnaire:${questionnaireId}:${await sha256(JSON.stringify(body.profile))}`,
    });
    return updated;
  });
  app.delete('/api/questionnaires/:questionnaireId', async (request) => {
    const session = await mutateSafe(request);
    const { questionnaireId } = z
      .object({ questionnaireId: z.string().uuid() })
      .parse(request.params);
    return dataApi.execute('questionnaires.delete', {
      userId: session.userId,
      questionnaireId,
    });
  });
  app.put('/api/questionnaires/:questionnaireId/state', async (request) => {
    const session = await mutateSafe(request);
    const { questionnaireId } = z
      .object({ questionnaireId: z.string().uuid() })
      .parse(request.params);
    const { active } = z.object({ active: z.boolean() }).parse(request.body);
    const result = await dataApi.execute('questionnaires.setActive', {
      userId: session.userId,
      questionnaireId,
      active,
    });
    if (active) {
      await notifyFollowers({
        actorUserId: session.userId,
        entityType: 'questionnaire',
        entityId: questionnaireId,
        openPath: `/search?questionnaire=${encodeURIComponent(questionnaireId)}`,
        message: ru.bot.followerQuestionnaireNotification,
      });
    }
    return result;
  });
  app.put('/api/questionnaires/:questionnaireId/primary', async (request) => {
    const session = await mutateSafe(request);
    const { questionnaireId } = z
      .object({ questionnaireId: z.string().uuid() })
      .parse(request.params);
    return dataApi.execute('questionnaires.setPrimary', {
      userId: session.userId,
      questionnaireId,
    });
  });
  app.get('/api/questionnaires/:questionnaireId/media', async (request) => {
    const session = await authenticate(request);
    const { questionnaireId } = z
      .object({ questionnaireId: z.string().uuid() })
      .parse(request.params);
    return dataApi.execute('questionnaires.media.list', {
      userId: session.userId,
      questionnaireId,
    });
  });
  app.delete('/api/questionnaires/:questionnaireId/media/:mediaId', async (request) => {
    const session = await mutateSafe(request);
    const { questionnaireId, mediaId } = z
      .object({ questionnaireId: z.string().uuid(), mediaId: z.string().uuid() })
      .parse(request.params);
    return dataApi.execute('questionnaires.media.delete', {
      userId: session.userId,
      questionnaireId,
      mediaId,
    });
  });
  app.put('/api/questionnaires/:questionnaireId/media/order', async (request) => {
    const session = await mutateSafe(request);
    const { questionnaireId } = z
      .object({ questionnaireId: z.string().uuid() })
      .parse(request.params);
    const { mediaIds } = z
      .object({ mediaIds: z.array(z.string().uuid()).min(1).max(8) })
      .parse(request.body);
    return dataApi.execute('questionnaires.media.reorder', {
      userId: session.userId,
      questionnaireId,
      mediaIds,
    });
  });
  app.get('/api/profile/preview', async (request) => {
    const session = await authenticate(request);
    return dataApi.execute('profiles.previewOwn', { userId: session.userId });
  });
  app.put('/api/profile', async (request) => {
    const session = await mutateSafe(request);
    const profile = profileSchema.parse(request.body);
    const premium = await dataApi.execute<{ premium: boolean }>('premium.status', {
      userId: session.userId,
    });
    const policy = await validateUserContentLinks(
      [
        profile.displayName,
        profile.shortHeadline,
        profile.about,
        profile.settings,
        profile.plots,
        profile.boundaries,
        ...profile.preferredRole,
        ...profile.fandoms,
        ...profile.genres,
        ...profile.tags,
        ...profile.lookingFor,
      ].join('\n'),
      {
        premium: premium.premium,
        dataApi,
        getChat: async (chatId) => bot.api.getChat(chatId),
      },
    );
    if (!policy.allowed) {
      throw new DataApiError(
        policy.reason === 'premium_required' ? 'PREMIUM_REQUIRED' : 'LINK_POLICY_VIOLATION',
        policy.reason,
        403,
      );
    }
    const saved = await dataApi.execute<{ profileId: string }>('profiles.upsert', {
      userId: session.userId,
      profile,
    });
    await notifyMentions({
      actorUserId: session.userId,
      text: JSON.stringify(profile),
      context: 'questionnaire',
      entityId: saved.profileId,
      openPath: `/profiles/${session.userId}`,
      sourceKey: `questionnaire:${saved.profileId}:${await sha256(JSON.stringify(profile))}`,
    });
    return saved;
  });
  app.get('/api/questionnaires/quick-start', async (request) => {
    const session = await authenticate(request);
    return dataApi.execute('users.quickStartContext', { userId: session.userId });
  });
  app.post('/api/questionnaires/quick-start', async (request) => {
    const session = await mutateSafe(request);
    const body = z
      .object({
        lookingFor: z.array(z.string().trim().min(2).max(64)).min(1).max(5),
        formats: z.array(z.string().trim().min(2).max(64)).min(1).max(6),
        hook: z.string().trim().min(10).max(120),
        timezone: z
          .string()
          .regex(/^UTC(?:[+-](?:0?\d|1[0-4])(?::(?:15|30|45))?)?$/)
          .optional(),
      })
      .parse(request.body);
    const context = await dataApi.execute<{
      ageGroup: string;
      displayName: string;
      hasQuestionnaire: boolean;
    }>('users.quickStartContext', { userId: session.userId });
    const ageGroup = ageGroupSchema.safeParse(context.ageGroup);
    if (!ageGroup.success) {
      throw new DataApiError('AGE_CONFIRMATION_REQUIRED', ru.api.ageConfirmationRequired, 409);
    }
    const profile = buildQuickStartProfile({
      displayName: context.displayName,
      ageGroup: ageGroup.data,
      lookingFor: body.lookingFor,
      formats: body.formats,
      hook: body.hook,
      ...(body.timezone ? { timezone: body.timezone } : {}),
    });
    const saved = await dataApi.execute<{ profileId: string }>('profiles.upsert', {
      userId: session.userId,
      profile,
    });
    await dataApi.execute('users.setSearchEnabled', { userId: session.userId, enabled: true });
    return { ...saved, created: !context.hasQuestionnaire };
  });
  app.put('/api/profile/state', async (request) => {
    const session = await mutateSafe(request);
    const { active } = z.object({ active: z.boolean() }).parse(request.body);
    return dataApi.execute('profiles.setActive', { userId: session.userId, active });
  });
  app.get('/api/profile/media', async (request) => {
    const session = await authenticate(request);
    return dataApi.execute('profiles.media.list', { userId: session.userId });
  });
  app.delete('/api/profile/media/:mediaId', async (request) => {
    const session = await mutateSafe(request);
    const { mediaId } = z.object({ mediaId: z.string().uuid() }).parse(request.params);
    return dataApi.execute('profiles.media.delete', { userId: session.userId, mediaId });
  });
  app.put('/api/profile/media/order', async (request) => {
    const session = await mutateSafe(request);
    const { mediaIds } = z
      .object({ mediaIds: z.array(z.string().uuid()).min(1).max(13) })
      .parse(request.body);
    return dataApi.execute('profiles.media.reorder', {
      userId: session.userId,
      mediaIds,
    });
  });
  app.put('/api/profile/audio/order', async (request) => {
    const session = await mutateSafe(request);
    const { mediaIds } = z
      .object({ mediaIds: z.array(z.string().uuid()).min(1).max(5) })
      .parse(request.body);
    return dataApi.execute('profiles.audio.reorder', { userId: session.userId, mediaIds });
  });
  app.put('/api/profile/avatar', async (request) => {
    const session = await mutateSafe(request);
    const { mediaId } = z.object({ mediaId: z.string().uuid().nullable() }).parse(request.body);
    return dataApi.execute('profiles.avatar.set', {
      userId: session.userId,
      mediaId,
    });
  });
  app.get('/api/profile-media/:mediaId', async (request, reply) => {
    const session = await authenticate(request);
    const { mediaId } = z.object({ mediaId: z.string().uuid() }).parse(request.params);
    const media = await dataApi.execute<{
      telegram_file_id: string;
      media_type: 'photo' | 'animation' | 'video' | 'audio' | 'voice' | 'document';
      file_size_bytes: number | null;
    }>('profiles.media.resolve', {
      requesterUserId: session.userId,
      mediaId,
    });
    if ((media.file_size_bytes ?? 0) > 20 * 1024 * 1024) {
      throw new DataApiError(
        'MEDIA_TOO_LARGE_FOR_TELEGRAM_DOWNLOAD',
        ru.api.mediaExceedsTelegramDownloadLimit,
        413,
      );
    }
    const file = await bot.api.getFile(media.telegram_file_id);
    if (!file.file_path) throw new DataApiError('MEDIA_UNAVAILABLE', ru.api.mediaUnavailable, 404);
    const telegramResponse = await fetch(
      `https://api.telegram.org/file/bot${env.TELEGRAM_BOT_TOKEN}/${file.file_path}`,
      telegramFileRequestInit(request),
    );
    if (!telegramResponse.ok)
      throw new DataApiError('MEDIA_UNAVAILABLE', ru.api.mediaUnavailable, 502);
    const contentType =
      telegramResponse.headers.get('content-type') ??
      (
        {
          photo: 'image/jpeg',
          animation: 'image/gif',
          video: 'video/mp4',
          audio: 'audio/mpeg',
          voice: 'audio/ogg',
          document: 'application/octet-stream',
        } satisfies Record<typeof media.media_type, string>
      )[media.media_type];
    reply.header('Content-Type', contentType);
    reply.header('Cache-Control', 'private, max-age=300');
    applySeekableMediaHeaders(reply, telegramResponse);
    return reply.send(telegramResponse.body);
  });
  app.get('/api/profile-media/:mediaId/thumbnail', async (request, reply) => {
    const session = await authenticate(request);
    const { mediaId } = z.object({ mediaId: z.string().uuid() }).parse(request.params);
    const media = await dataApi.execute<{ telegram_file_id: string }>(
      'profiles.media.resolveThumbnail',
      {
        requesterUserId: session.userId,
        mediaId,
      },
    );
    const file = await bot.api.getFile(media.telegram_file_id);
    if (!file.file_path) {
      throw new DataApiError('MEDIA_UNAVAILABLE', ru.api.mediaUnavailable, 404);
    }
    const telegramResponse = await fetch(
      `https://api.telegram.org/file/bot${env.TELEGRAM_BOT_TOKEN}/${file.file_path}`,
      { signal: AbortSignal.timeout(20_000) },
    );
    if (!telegramResponse.ok) {
      throw new DataApiError('MEDIA_UNAVAILABLE', ru.api.mediaUnavailable, 502);
    }
    reply.header('Content-Type', telegramResponse.headers.get('content-type') ?? 'image/jpeg');
    reply.header('Cache-Control', 'private, max-age=300');
    return reply.send(Buffer.from(await telegramResponse.arrayBuffer()));
  });
  app.get('/api/search', async (request) => {
    const session = await authenticate(request);
    const query = z
      .object({
        limit: z.coerce.number().int().min(1).max(100).default(20),
        q: z.string().trim().max(80).default(''),
        cursor: z
          .string()
          .regex(/^\d{1,5}$/)
          .optional(),
      })
      .parse(request.query);
    return dataApi.execute('search.list', {
      userId: session.userId,
      limit: query.limit,
      query: query.q,
      ...(query.cursor ? { cursor: query.cursor } : {}),
    });
  });
  app.get('/api/search/global', async (request) => {
    const session = await authenticate(request);
    const query = z
      .object({
        scope: z.enum(['all', 'profiles', 'questionnaires', 'posts']).default('all'),
        q: z.string().trim().max(80).default(''),
        limit: z.coerce.number().int().min(1).max(50).default(20),
      })
      .parse(request.query);
    const [profiles, questionnaires, posts] = await Promise.all([
      query.scope === 'all' || query.scope === 'profiles'
        ? dataApi.execute('publicProfiles.search', {
            requesterUserId: session.userId,
            query: query.q,
            limit: query.limit,
          })
        : Promise.resolve([]),
      query.scope === 'all' || query.scope === 'questionnaires'
        ? dataApi.execute('search.list', {
            userId: session.userId,
            query: query.q,
            limit: query.limit,
          })
        : Promise.resolve([]),
      query.scope === 'all' || query.scope === 'posts'
        ? dataApi.execute('posts.search', {
            userId: session.userId,
            query: query.q,
            limit: query.limit,
          })
        : Promise.resolve([]),
    ]);
    return { profiles, questionnaires, posts };
  });
  app.get('/api/search/profiles', async (request) => {
    const session = await authenticate(request);
    const { q, limit } = z
      .object({
        q: z.string().trim().max(80).default(''),
        limit: z.coerce.number().int().min(1).max(50).default(20),
      })
      .parse(request.query);
    return dataApi.execute('publicProfiles.search', {
      requesterUserId: session.userId,
      query: q,
      limit,
    });
  });
  app.get('/api/search/availability', async (request) => {
    const session = await authenticate(request);
    return dataApi.execute('search.availability', { userId: session.userId });
  });
  app.get('/api/search/preferences', async (request) => {
    const session = await authenticate(request);
    return dataApi.execute('search.preferences.get', { userId: session.userId });
  });
  app.get('/api/taxonomy/suggestions', async (request) => {
    const session = await authenticate(request);
    const query = z
      .object({
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
        q: z.string().trim().max(60).default(''),
        limit: z.coerce.number().int().min(1).max(30).default(12),
      })
      .parse(request.query);
    return dataApi.execute('taxonomy.suggestions', {
      userId: session.userId,
      kind: query.kind,
      query: query.q,
      limit: query.limit,
    });
  });
  app.post('/api/taxonomy/selections', async (request) => {
    const session = await mutateSafe(request);
    const body = z
      .object({
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
      })
      .parse(request.body);
    return dataApi.execute('taxonomy.selections.record', {
      userId: session.userId,
      kind: body.kind,
      value: body.value,
    });
  });
  app.put('/api/search/preferences', async (request) => {
    const session = await mutateSafe(request);
    const body = z
      .object({
        ageGroups: z.array(z.enum(['under_16', '16_17', '18_20', '21_25', '26_plus'])).max(5),
        languages: z.array(z.string().min(1).max(40)).max(10),
        genres: z.array(z.string().min(1).max(80)).max(20),
        fandoms: z.array(z.string().min(1).max(120)).max(20),
        writingStyles: z.array(z.string().min(1).max(40)).max(10),
        activityLevels: z.array(z.string().min(1).max(40)).max(10),
        onlyOnline: z.boolean(),
        onlyWithPhoto: z.boolean(),
        timezones: z.array(z.string().min(1).max(64)).max(12).default([]),
      })
      .parse(request.body);
    return dataApi.execute('search.preferences.update', { userId: session.userId, ...body });
  });
  app.get('/api/search/filter-sets', async (request) => {
    const session = await authenticate(request);
    return dataApi.execute('search.filterSets.list', { userId: session.userId });
  });
  app.post('/api/search/filter-sets', async (request) => {
    const session = await mutateSafe(request);
    const body = z
      .object({
        name: z.string().trim().min(1).max(40),
        filters: z.object({
          ageGroups: z.array(z.enum(['under_16', '16_17', '18_20', '21_25', '26_plus'])).max(5),
          languages: z.array(z.string().min(1).max(40)).max(10),
          genres: z.array(z.string().min(1).max(80)).max(20),
          fandoms: z.array(z.string().min(1).max(120)).max(20),
          writingStyles: z.array(z.string().min(1).max(40)).max(10),
          activityLevels: z.array(z.string().min(1).max(40)).max(10),
          onlyOnline: z.boolean(),
          onlyWithPhoto: z.boolean(),
          timezones: z.array(z.string().min(1).max(64)).max(12).default([]),
        }),
      })
      .parse(request.body);
    return dataApi.execute('search.filterSets.save', { userId: session.userId, ...body });
  });
  app.post('/api/search/filter-sets/:filterSetId/activate', async (request) => {
    const session = await mutateSafe(request);
    const { filterSetId } = z.object({ filterSetId: z.string().uuid() }).parse(request.params);
    return dataApi.execute('search.filterSets.activate', { userId: session.userId, filterSetId });
  });
  app.delete('/api/search/filter-sets/:filterSetId', async (request) => {
    const session = await mutateSafe(request);
    const { filterSetId } = z.object({ filterSetId: z.string().uuid() }).parse(request.params);
    return dataApi.execute('search.filterSets.delete', { userId: session.userId, filterSetId });
  });
  app.post('/api/users/ready-to-chat', async (request) => {
    const session = await mutateSafe(request);
    const body = z.object({ minutes: z.number().int().min(0).max(720) }).parse(request.body);
    return dataApi.execute('users.setReadyToChat', {
      userId: session.userId,
      minutes: body.minutes,
    });
  });
  app.post('/api/conversations/:conversationId/end', async (request) => {
    const session = await mutateSafe(request);
    const { conversationId } = z
      .object({ conversationId: z.string().uuid() })
      .parse(request.params);
    // The courteous note is sent by the client through the ordinary message
    // endpoint first, so it reaches the other side over the tested relay path.
    return dataApi.execute('conversations.endGently', {
      userId: session.userId,
      conversationId,
    });
  });
  app.post('/api/search/state', async (request) => {
    const session = await mutateSafe(request);
    const body = z.object({ enabled: z.boolean() }).parse(request.body);
    return dataApi.execute('users.setSearchEnabled', {
      userId: session.userId,
      enabled: body.enabled,
    });
  });
  app.get('/api/conversations/:conversationId/icebreaker', async (request) => {
    const session = await authenticate(request);
    const { conversationId } = z
      .object({ conversationId: z.string().uuid() })
      .parse(request.params);
    return dataApi.execute('conversations.icebreaker', {
      userId: session.userId,
      conversationId,
    });
  });
  app.post('/api/swipes', async (request) => {
    const session = await mutateSafe(request);
    const body = swipeBodySchema.parse(request.body);
    const result = await dataApi.execute<{
      created: boolean;
      matched: boolean;
      notificationQueued: boolean;
    }>('swipes.create', {
      userId: session.userId,
      targetUserId: body.targetUserId,
      action: body.action,
      source: 'miniapp',
      idempotencyKey: request.id,
      ...(body.questionnaireId ? { questionnaireId: body.questionnaireId } : {}),
    });
    if (result.notificationQueued) {
      await dispatchTelegramNotificationBatch(bot, dataApi, env, (error) => {
        app.log.error(
          {
            event: 'telegram_notification_dispatch_failed',
            error: error instanceof Error ? error.message : 'unknown',
          },
          'the durable like notification remains pending for scheduled retry',
        );
      });
    }
    return result;
  });
  app.post('/api/swipes/rewind', async (request) => {
    const session = await mutateSafe(request);
    return dataApi.execute('swipes.rewind', { userId: session.userId });
  });
  app.get('/api/swipes/incoming', async (request) => {
    const session = await authenticate(request);
    return dataApi.execute('swipes.incoming', { userId: session.userId, limit: 50 });
  });
  app.get('/api/premium/status', async (request) => {
    const session = await authenticate(request);
    return dataApi.execute('premium.status', { userId: session.userId });
  });
  app.post('/api/promotions/apply', async (request) => {
    const session = await mutateSafe(request);
    const { code } = z.object({ code: z.string().trim().min(3).max(40) }).parse(request.body);
    const result = await dataApi.execute<{
      type: 'discount' | 'premium_days';
      premiumDays?: number;
      discountStars?: number;
      discountRubles?: number;
      eligibleProductIds?: string[];
    }>('promotions.apply', { userId: session.userId, code });
    if (result.type === 'premium_days') {
      await queueTelegramActivityNotification({
        targetUserId: session.userId,
        category: 'premium',
        message: ru.bot.premiumGranted(result.premiumDays ?? 0),
        openPath: '/premium',
        sourceKey: `premium-promo:${session.userId}:${code}:${result.premiumDays ?? 0}`,
      });
    }
    return result;
  });
  app.post('/api/premium/boost', async (request) => {
    const session = await mutateSafe(request);
    return dataApi.execute('premium.boost', { userId: session.userId });
  });
  app.get('/api/premium/stats', async (request) => {
    const session = await authenticate(request);
    return dataApi.execute('premium.stats', { userId: session.userId });
  });
  app.get('/api/premium/profile-variants', async (request) => {
    const session = await authenticate(request);
    return dataApi.execute('premium.profileVariants.list', { userId: session.userId });
  });
  app.post('/api/premium/profile-variants', async (request) => {
    const session = await mutateSafe(request);
    const body = z
      .object({
        name: z.string().trim().min(1).max(40),
        shortHeadline: z.string().trim().min(3).max(120),
        about: z.string().trim().min(20).max(2_000),
        plots: z.string().max(2_000),
      })
      .parse(request.body);
    return dataApi.execute('premium.profileVariants.save', { userId: session.userId, ...body });
  });
  app.post('/api/premium/profile-variants/:variantId/activate', async (request) => {
    const session = await mutateSafe(request);
    const { variantId } = z.object({ variantId: z.string().uuid() }).parse(request.params);
    return dataApi.execute('premium.profileVariants.activate', {
      userId: session.userId,
      variantId,
    });
  });
  app.delete('/api/premium/profile-variants/:variantId', async (request) => {
    const session = await mutateSafe(request);
    const { variantId } = z.object({ variantId: z.string().uuid() }).parse(request.params);
    return dataApi.execute('premium.profileVariants.delete', {
      userId: session.userId,
      variantId,
    });
  });
  app.get('/api/conversations', async (request) => {
    const session = await authenticate(request);
    const { archived } = z
      .object({ archived: z.enum(['0', '1']).default('0') })
      .parse(request.query);
    const conversations = await dataApi.execute<
      Array<
        Record<string, unknown> & {
          last_encrypted_content: string | null;
          last_message_type: string | null;
        }
      >
    >('conversations.list', {
      userId: session.userId,
      limit: 50,
      archived: archived === '1',
    });
    return Promise.all(
      conversations.map(
        async ({
          last_encrypted_content: encrypted,
          draft_encrypted_content: encryptedDraft,
          ...conversation
        }) => ({
          ...conversation,
          last_message_text: encrypted
            ? await decryptChatContent(encrypted, env.SESSION_SECRET).catch(() => null)
            : null,
          draft_text:
            typeof encryptedDraft === 'string'
              ? await decryptChatContent(encryptedDraft, env.SESSION_SECRET).catch(() => null)
              : null,
        }),
      ),
    );
  });
  app.get('/api/conversations/:conversationId/draft', async (request) => {
    const session = await authenticate(request);
    const { conversationId } = z
      .object({ conversationId: z.string().uuid() })
      .parse(request.params);
    const draft = await dataApi.execute<{ encrypted_content: string; updated_at: string } | null>(
      'conversations.draft.get',
      { userId: session.userId, conversationId },
    );
    return draft
      ? {
          text: await decryptChatContent(draft.encrypted_content, env.SESSION_SECRET).catch(
            () => '',
          ),
          updatedAt: draft.updated_at,
        }
      : { text: '', updatedAt: null };
  });
  app.put('/api/conversations/:conversationId/draft', async (request) => {
    const session = await mutateSafe(request);
    const { conversationId } = z
      .object({ conversationId: z.string().uuid() })
      .parse(request.params);
    const { text } = z.object({ text: z.string().max(4_000) }).parse(request.body);
    if (!text.trim()) {
      return dataApi.execute('conversations.draft.delete', {
        userId: session.userId,
        conversationId,
      });
    }
    return dataApi.execute('conversations.draft.save', {
      userId: session.userId,
      conversationId,
      encryptedContent: await encryptChatContent(text, env.SESSION_SECRET),
    });
  });
  app.delete('/api/conversations/:conversationId/draft', async (request) => {
    const session = await mutateSafe(request);
    const { conversationId } = z
      .object({ conversationId: z.string().uuid() })
      .parse(request.params);
    return dataApi.execute('conversations.draft.delete', {
      userId: session.userId,
      conversationId,
    });
  });
  app.put('/api/conversations/:conversationId/archive', async (request) => {
    const session = await mutateSafe(request);
    const { conversationId } = z
      .object({ conversationId: z.string().uuid() })
      .parse(request.params);
    const { archived } = z.object({ archived: z.boolean() }).parse(request.body);
    return dataApi.execute('conversations.archive', {
      userId: session.userId,
      conversationId,
      archived,
    });
  });
  app.put('/api/conversations/:conversationId/pin', async (request) => {
    const session = await mutateSafe(request);
    const { conversationId } = z
      .object({ conversationId: z.string().uuid() })
      .parse(request.params);
    const { pinned } = z.object({ pinned: z.boolean() }).parse(request.body);
    return dataApi.execute('conversations.pin', {
      userId: session.userId,
      conversationId,
      pinned,
    });
  });
  app.put('/api/conversations/pins/order', async (request) => {
    const session = await mutateSafe(request);
    const { conversationIds } = z
      .object({ conversationIds: z.array(z.string().uuid()).max(100) })
      .parse(request.body);
    return dataApi.execute('conversations.pins.reorder', {
      userId: session.userId,
      conversationIds,
    });
  });
  app.get('/api/conversations/:conversationId/presence', async (request) => {
    const session = await authenticate(request);
    const { conversationId } = z
      .object({ conversationId: z.string().uuid() })
      .parse(request.params);
    return dataApi.execute('conversations.presence.get', {
      userId: session.userId,
      conversationId,
    });
  });
  app.put('/api/conversations/:conversationId/presence', async (request) => {
    const session = await mutateSafe(request);
    const { conversationId } = z
      .object({ conversationId: z.string().uuid() })
      .parse(request.params);
    const { activity } = z
      .object({ activity: z.enum(['typing', 'recording_voice', 'sending_media', 'idle']) })
      .parse(request.body);
    return dataApi.execute('conversations.presence.set', {
      userId: session.userId,
      conversationId,
      activity,
    });
  });
  app.get('/api/conversations/:conversationId/messages', async (request) => {
    const session = await authenticate(request);
    const { conversationId } = z
      .object({ conversationId: z.string().uuid() })
      .parse(request.params);
    // The chat list peeks with ?peek=1 so looking at a conversation does not
    // clear its unread state.
    const { peek } = z.object({ peek: z.enum(['0', '1']).optional() }).parse(request.query ?? {});
    const messages = await dataApi.execute<
      Array<
        Record<string, unknown> & {
          encrypted_content: string | null;
          reply_encrypted_content: string | null;
        }
      >
    >('conversations.messages.list', {
      userId: session.userId,
      conversationId,
      limit: 100,
      markRead: peek !== '1',
    });
    return Promise.all(
      messages.map(
        async ({
          encrypted_content: encryptedContent,
          reply_encrypted_content: reply,
          ...message
        }) => ({
          ...message,
          text_content: encryptedContent
            ? await decryptChatContent(encryptedContent, env.SESSION_SECRET).catch(
                () => ru.api.requestFailed,
              )
            : null,
          reply_text_content: reply
            ? await decryptChatContent(reply, env.SESSION_SECRET).catch(() => null)
            : null,
        }),
      ),
    );
  });
  app.get('/api/conversations/:conversationId/messages/:messageId', async (request) => {
    const session = await authenticate(request);
    const { conversationId, messageId } = z
      .object({ conversationId: z.string().uuid(), messageId: z.string().uuid() })
      .parse(request.params);
    const message = await dataApi.execute<
      Record<string, unknown> & {
        encrypted_content: string | null;
        reply_encrypted_content: string | null;
      }
    >('conversations.messages.get', { userId: session.userId, conversationId, messageId });
    const { encrypted_content: encrypted, reply_encrypted_content: reply, ...rest } = message;
    return {
      ...rest,
      text_content: encrypted
        ? await decryptChatContent(encrypted, env.SESSION_SECRET).catch(() => ru.api.requestFailed)
        : null,
      reply_text_content: reply
        ? await decryptChatContent(reply, env.SESSION_SECRET).catch(() => null)
        : null,
    };
  });
  app.get('/api/conversations/:conversationId/pins', async (request) => {
    const session = await authenticate(request);
    const { conversationId } = z
      .object({ conversationId: z.string().uuid() })
      .parse(request.params);
    const pins = await dataApi.execute<
      Array<Record<string, unknown> & { encrypted_content: string | null }>
    >('conversations.messages.pins.list', { userId: session.userId, conversationId });
    return Promise.all(
      pins.map(async ({ encrypted_content: encrypted, ...pin }) => ({
        ...pin,
        text_content: encrypted
          ? await decryptChatContent(encrypted, env.SESSION_SECRET).catch(() => null)
          : null,
      })),
    );
  });
  app.put('/api/conversations/:conversationId/messages/:messageId/pin', async (request) => {
    const session = await mutateSafe(request);
    const { conversationId, messageId } = z
      .object({ conversationId: z.string().uuid(), messageId: z.string().uuid() })
      .parse(request.params);
    const { pinned, sharedWithParticipant } = z
      .object({ pinned: z.boolean(), sharedWithParticipant: z.boolean().default(false) })
      .parse(request.body);
    return dataApi.execute('conversations.messages.pin', {
      userId: session.userId,
      conversationId,
      messageId,
      pinned,
      sharedWithParticipant,
    });
  });
  app.delete('/api/conversations/:conversationId/messages', async (request) => {
    const session = await mutateSafe(request);
    const { conversationId } = z
      .object({ conversationId: z.string().uuid() })
      .parse(request.params);
    const { messageIds, forEveryone } = z
      .object({
        messageIds: z.array(z.string().uuid()).min(1).max(100),
        forEveryone: z.boolean().default(false),
      })
      .parse(request.body);
    return dataApi.execute('conversations.messages.deleteSelected', {
      userId: session.userId,
      conversationId,
      messageIds,
      forEveryone,
    });
  });
  app.post('/api/conversations/:conversationId/messages/forward', async (request) => {
    const session = await mutateSafe(request);
    const { conversationId } = z
      .object({ conversationId: z.string().uuid() })
      .parse(request.params);
    const { messageIds, conversationIds } = z
      .object({
        messageIds: z.array(z.string().uuid()).min(1).max(100),
        conversationIds: z
          .array(z.string().uuid())
          .min(1)
          .max(20)
          .refine((ids) => new Set(ids).size === ids.length),
      })
      .parse(request.body);
    const result = await dataApi.execute<{ forwarded: number; conversationIds: string[] }>(
      'conversations.messages.forward',
      {
        userId: session.userId,
        sourceConversationId: conversationId,
        messageIds,
        destinationConversationIds: conversationIds,
      },
    );
    for (const destinationConversationId of result.conversationIds) {
      const relay = await dataApi.execute<{
        recipient_user_id: string;
        destination_chat_id: number;
        recipient_muted: number;
        notify_message: number;
      }>('conversations.resolveMiniAppRelay', {
        userId: session.userId,
        conversationId: destinationConversationId,
      });
      const notificationSourceKey = `chat-forward:${destinationConversationId}:${crypto.randomUUID()}`;
      await dataApi.execute('notifications.activity.create', {
        actorUserId: session.userId,
        targetUserId: relay.recipient_user_id,
        kind: 'message',
        context: 'chat',
        entityId: destinationConversationId,
        openPath: `/chats?conversation=${encodeURIComponent(destinationConversationId)}`,
        sourceKey: notificationSourceKey,
        message: ru.bot.newMessageNotification,
      });
      await queueChatTelegramNotification({
        targetUserId: relay.recipient_user_id,
        conversationId: destinationConversationId,
        sourceKey: notificationSourceKey,
      });
    }
    return result;
  });
  app.put('/api/conversations/:conversationId/messages/:messageId/reaction', async (request) => {
    const session = await mutateSafe(request);
    const { conversationId, messageId } = z
      .object({
        conversationId: z.string().uuid(),
        messageId: z.string().uuid(),
      })
      .parse(request.params);
    const { reaction } = z
      .object({
        reaction: z.string().trim().min(1).max(16),
      })
      .parse(request.body);
    const result = await dataApi.execute<{
      reaction: string | null;
      targetUserId: string;
    }>('conversations.messages.react', {
      userId: session.userId,
      conversationId,
      messageId,
      reaction,
    });
    if (result.reaction && result.targetUserId !== session.userId) {
      await queueTelegramActivityNotification({
        targetUserId: result.targetUserId,
        category: 'reaction',
        message: ru.bot.newReactionNotification,
        openPath: `/chats?conversation=${encodeURIComponent(conversationId)}`,
        sourceKey: `message-reaction:${request.id}`,
      });
    }
    return result;
  });
  app.put('/api/conversations/:conversationId/messages/:messageId/text', async (request) => {
    const session = await mutateSafe(request);
    const { conversationId, messageId } = z
      .object({ conversationId: z.string().uuid(), messageId: z.string().uuid() })
      .parse(request.params);
    const { text } = z.object({ text: z.string().trim().min(1).max(4_000) }).parse(request.body);
    return dataApi.execute('conversations.messages.updateOwnText', {
      userId: session.userId,
      conversationId,
      messageId,
      encryptedContent: await encryptChatContent(text, env.SESSION_SECRET),
    });
  });
  app.put(
    '/api/conversations/:conversationId/media-groups/:mediaGroupId/order',
    async (request) => {
      const session = await mutateSafe(request);
      const { conversationId, mediaGroupId } = z
        .object({ conversationId: z.string().uuid(), mediaGroupId: z.string().uuid() })
        .parse(request.params);
      const { messageIds } = z
        .object({ messageIds: z.array(z.string().uuid()).min(2).max(20) })
        .parse(request.body);
      return dataApi.execute('conversations.messages.reorderOwnMedia', {
        userId: session.userId,
        conversationId,
        mediaGroupId,
        messageIds,
      });
    },
  );
  app.put('/api/conversations/:conversationId/messages/:messageId/media', async (request) => {
    const session = await mutateSafe(request);
    const { conversationId, messageId } = z
      .object({ conversationId: z.string().uuid(), messageId: z.string().uuid() })
      .parse(request.params);
    const body = chatMediaBodySchema
      .omit({
        mediaGroupId: true,
        playlistTitle: true,
        caption: true,
        captionPosition: true,
        notifyRecipient: true,
        replyToMessageId: true,
      })
      .parse(request.body);
    const bytes = Buffer.from(body.dataBase64, 'base64');
    const maxBytes = body.kind === 'photo' ? 8 * 1024 * 1024 : 20 * 1024 * 1024;
    if (!bytes.length || bytes.length > maxBytes) {
      throw new DataApiError('CHAT_MEDIA_TOO_LARGE', ru.api.chatMediaTooLarge, 413);
    }
    const relay = await dataApi.execute<{ destination_chat_id: number; recipient_muted: number }>(
      'conversations.resolveMiniAppRelay',
      { userId: session.userId, conversationId },
    );
    const file = new InputFile(bytes, body.fileName);
    const common = { protect_content: true, disable_notification: Boolean(relay.recipient_muted) };
    const delivered =
      body.kind === 'photo'
        ? await bot.api.sendPhoto(relay.destination_chat_id, file, common)
        : body.kind === 'animation'
          ? await bot.api.sendAnimation(relay.destination_chat_id, file, common)
          : body.kind === 'video'
            ? body.mimeType === 'video/mp4'
              ? await bot.api.sendVideo(relay.destination_chat_id, file, common)
              : await bot.api.sendDocument(relay.destination_chat_id, file, common)
            : body.kind === 'audio'
              ? await bot.api.sendAudio(relay.destination_chat_id, file, common)
              : await bot.api.sendVoice(relay.destination_chat_id, file, common);
    const telegramFileId = telegramMediaFileId(delivered, body.kind);
    if (!telegramFileId)
      throw new DataApiError('CHAT_MEDIA_UNAVAILABLE', ru.api.requestFailed, 502);
    const deliveredRecord = recordValue(delivered);
    const deliveredAudio = recordValue(deliveredRecord?.audio);
    const metadata =
      body.kind === 'audio'
        ? telegramAudioMetadata({
            ...(typeof deliveredAudio?.title === 'string' ? { title: deliveredAudio.title } : {}),
            ...(typeof deliveredAudio?.performer === 'string'
              ? { performer: deliveredAudio.performer }
              : {}),
            file_name: body.fileName,
          })
        : {};
    await dataApi.execute('conversations.messages.replaceOwnMedia', {
      userId: session.userId,
      conversationId,
      messageId,
      messageType: body.kind,
      telegramFileId,
      mimeType: body.mimeType,
      fileName: body.fileName,
      ...metadata,
      ...(typeof deliveredAudio?.duration === 'number'
        ? { durationSeconds: deliveredAudio.duration }
        : {}),
    });
    await bot.api.deleteMessage(relay.destination_chat_id, delivered.message_id).catch(() => false);
    return { replaced: true };
  });
  app.get(
    '/api/conversations/:conversationId/messages/:messageId/media',
    async (request, reply) => {
      const session = await authenticate(request);
      const { conversationId, messageId } = z
        .object({ conversationId: z.string().uuid(), messageId: z.string().uuid() })
        .parse(request.params);
      const media = await dataApi.execute<{
        telegram_file_id: string;
        mime_type: string | null;
        file_name: string | null;
      }>('conversations.messages.media', {
        userId: session.userId,
        conversationId,
        messageId,
      });
      const file = await bot.api.getFile(media.telegram_file_id);
      if (!file.file_path) {
        throw new DataApiError('CHAT_MEDIA_NOT_FOUND', ru.api.unsupportedChatMedia, 404);
      }
      const telegramResponse = await fetch(
        `https://api.telegram.org/file/bot${env.TELEGRAM_BOT_TOKEN}/${file.file_path}`,
        telegramFileRequestInit(request),
      );
      if (!telegramResponse.ok) {
        throw new DataApiError('CHAT_MEDIA_UNAVAILABLE', ru.api.requestFailed, 502);
      }
      const fileName = (media.file_name ?? `message-${messageId}`)
        .replace(/[\r\n"\\/]/g, '_')
        .slice(0, 180);
      applySeekableMediaHeaders(reply, telegramResponse);
      const upstreamType = telegramResponse.headers.get('content-type');
      const contentType =
        media.mime_type && media.mime_type !== 'application/octet-stream'
          ? media.mime_type
          : (upstreamType ?? 'application/octet-stream');
      return reply
        .header('Content-Type', contentType)
        .header('Content-Disposition', `inline; filename="${fileName}"`)
        .header('Cache-Control', 'private, max-age=300')
        .send(telegramResponse.body);
    },
  );
  app.get(
    '/api/conversations/:conversationId/messages/:messageId/thumbnail',
    async (request, reply) => {
      const session = await authenticate(request);
      const { conversationId, messageId } = z
        .object({ conversationId: z.string().uuid(), messageId: z.string().uuid() })
        .parse(request.params);
      const thumbnail = await dataApi.execute<{ telegram_file_id: string }>(
        'conversations.messages.thumbnail',
        { userId: session.userId, conversationId, messageId },
      );
      const file = await bot.api.getFile(thumbnail.telegram_file_id);
      if (!file.file_path) {
        throw new DataApiError('CHAT_MEDIA_NOT_FOUND', ru.api.unsupportedChatMedia, 404);
      }
      const response = await fetch(
        `https://api.telegram.org/file/bot${env.TELEGRAM_BOT_TOKEN}/${file.file_path}`,
        { signal: AbortSignal.timeout(15_000) },
      );
      if (!response.ok) {
        throw new DataApiError('CHAT_MEDIA_UNAVAILABLE', ru.api.requestFailed, 502);
      }
      return reply
        .header('Content-Type', response.headers.get('content-type') ?? 'image/jpeg')
        .header('Cache-Control', 'private, max-age=300')
        .send(response.body);
    },
  );
  app.get(
    '/api/conversations/:conversationId/messages/:messageId/telegram-avatar',
    async (request, reply) => {
      const session = await authenticate(request);
      const { conversationId, messageId } = z
        .object({ conversationId: z.string().uuid(), messageId: z.string().uuid() })
        .parse(request.params);
      const stored = await dataApi.execute<{ encrypted_content: string }>(
        'conversations.messages.encryptedContent',
        { userId: session.userId, conversationId, messageId },
      );
      const decrypted = await decryptChatContent(stored.encrypted_content, env.SESSION_SECRET);
      const profile = telegramProfileShareSchema.parse(JSON.parse(decrypted) as unknown);
      if (!profile.avatarFileId) {
        throw new DataApiError('TELEGRAM_AVATAR_NOT_FOUND', ru.api.requestFailed, 404);
      }
      const file = await bot.api.getFile(profile.avatarFileId);
      if (!file.file_path) {
        throw new DataApiError('TELEGRAM_AVATAR_NOT_FOUND', ru.api.requestFailed, 404);
      }
      const response = await fetch(
        `https://api.telegram.org/file/bot${env.TELEGRAM_BOT_TOKEN}/${file.file_path}`,
        { signal: AbortSignal.timeout(15_000) },
      );
      if (!response.ok) {
        throw new DataApiError('TELEGRAM_AVATAR_UNAVAILABLE', ru.api.requestFailed, 502);
      }
      return reply
        .header('Content-Type', response.headers.get('content-type') ?? 'image/jpeg')
        .header('Cache-Control', 'private, max-age=300')
        .send(response.body);
    },
  );
  app.post('/api/conversations/direct', async (request) => {
    const session = await mutateSafe(request);
    const { targetUserId } = z.object({ targetUserId: z.string().uuid() }).parse(request.body);
    return dataApi.execute('conversations.startDirect', {
      userId: session.userId,
      targetUserId,
    });
  });
  app.delete('/api/conversations/:conversationId', async (request) => {
    const session = await mutateSafe(request);
    const { conversationId } = z
      .object({ conversationId: z.string().uuid() })
      .parse(request.params);
    return dataApi.execute('conversations.deleteOwn', {
      userId: session.userId,
      conversationId,
    });
  });
  app.post(
    '/api/conversations/:conversationId/messages',
    { config: { rateLimit: { max: 20, timeWindow: '1 minute' } } },
    async (request) => {
      const session = await mutateSafe(request);
      const { conversationId } = z
        .object({ conversationId: z.string().uuid() })
        .parse(request.params);
      const { text, replyToMessageId } = z
        .object({
          text: z.string().trim().min(1).max(4_000),
          replyToMessageId: z.string().uuid().optional(),
        })
        .parse(request.body);
      const premium = await dataApi.execute<{ premium: boolean }>('premium.status', {
        userId: session.userId,
      });
      const policy = await validateUserContentLinks(text, {
        premium: premium.premium,
        dataApi,
        getChat: async (chatId) => bot.api.getChat(chatId),
      });
      if (!policy.allowed) {
        throw new DataApiError(
          policy.reason === 'premium_required' ? 'PREMIUM_REQUIRED' : 'LINK_POLICY_VIOLATION',
          ru.api.linkPolicyViolation,
          403,
        );
      }
      const relay = await dataApi.execute<{
        recipient_user_id: string;
        destination_chat_id: number;
        recipient_muted: number;
        notify_message: number;
      }>('conversations.resolveMiniAppRelay', {
        userId: session.userId,
        conversationId,
      });
      const delivered = await bot.api.sendMessage(relay.destination_chat_id, text, {
        protect_content: true,
        disable_notification: Boolean(relay.recipient_muted),
        entities: [],
      });
      const recorded = await dataApi.execute<{ messageId: string }>(
        'conversations.recordMiniAppMessage',
        {
          userId: session.userId,
          conversationId,
          destinationMessageId: delivered.message_id,
          messageType: 'text',
          encryptedContent: await encryptChatContent(text, env.SESSION_SECRET),
          ...(replyToMessageId ? { replyToMessageId } : {}),
        },
      );
      await bot.api
        .deleteMessage(relay.destination_chat_id, delivered.message_id)
        .catch(() => false);
      try {
        await dataApi.execute('notifications.activity.create', {
          actorUserId: session.userId,
          targetUserId: relay.recipient_user_id,
          kind: 'message',
          context: 'chat',
          entityId: conversationId,
          openPath: `/chats?conversation=${encodeURIComponent(conversationId)}`,
          sourceKey: `chat:${conversationId}:${delivered.message_id}`,
          message: ru.bot.newMessageNotification,
        });
        await queueChatTelegramNotification({
          targetUserId: relay.recipient_user_id,
          conversationId,
          sourceKey: `chat:${conversationId}:${delivered.message_id}`,
        });
        await notifyMentions({
          actorUserId: session.userId,
          text,
          context: 'chat',
          entityId: conversationId,
          openPath: `/chats?conversation=${encodeURIComponent(conversationId)}`,
          sourceKey: `chat:${conversationId}:${delivered.message_id}`,
        });
      } catch (error) {
        request.log.error(
          {
            event: 'chat_post_commit_notification_failed',
            requestId: request.id,
            error: error instanceof Error ? error.message : 'unknown',
          },
          'chat message was recorded but its notification failed',
        );
      }
      return { sent: true, messageId: recorded.messageId };
    },
  );
  app.post(
    '/api/conversations/:conversationId/media',
    {
      bodyLimit: 32 * 1024 * 1024,
      config: { rateLimit: { max: 6, timeWindow: '1 minute' } },
    },
    async (request) => {
      const session = await mutateSafe(request);
      const { conversationId } = z
        .object({ conversationId: z.string().uuid() })
        .parse(request.params);
      const body = chatMediaBodySchema.parse(request.body);
      if (body.kind === 'animation' && body.caption) {
        throw new DataApiError('GIF_CAPTION_UNSUPPORTED', ru.api.unsupportedChatMedia, 400);
      }
      const premium = await dataApi.execute<{ premium: boolean }>('premium.status', {
        userId: session.userId,
      });
      if (body.kind !== 'photo' && !premium.premium) {
        throw new DataApiError('PREMIUM_REQUIRED', ru.api.premiumRequired, 403);
      }
      if (body.caption) {
        const policy = await validateUserContentLinks(body.caption, {
          premium: premium.premium,
          dataApi,
          getChat: async (chatId) => bot.api.getChat(chatId),
        });
        if (!policy.allowed) {
          throw new DataApiError(
            policy.reason === 'premium_required' ? 'PREMIUM_REQUIRED' : 'LINK_POLICY_VIOLATION',
            ru.api.linkPolicyViolation,
            403,
          );
        }
      }
      const allowedMimeTypes: Record<typeof body.kind, readonly string[]> = {
        photo: ['image/jpeg', 'image/png', 'image/webp'],
        animation: ['image/gif'],
        video: ['video/mp4', 'video/webm', 'video/quicktime'],
        audio: ['audio/mpeg', 'audio/mp4', 'audio/ogg', 'audio/webm'],
        voice: ['audio/mpeg', 'audio/mp4', 'audio/ogg', 'audio/webm'],
      };
      if (!allowedMimeTypes[body.kind].includes(body.mimeType.toLowerCase())) {
        throw new DataApiError('UNSUPPORTED_CHAT_MEDIA', ru.api.unsupportedChatMedia, 400);
      }
      const bytes = Uint8Array.from(atob(body.dataBase64), (character) => character.charCodeAt(0));
      const maxBytes = body.kind === 'photo' ? 8 * 1024 * 1024 : 20 * 1024 * 1024;
      if (!bytes.byteLength || bytes.byteLength > maxBytes) {
        throw new DataApiError('CHAT_MEDIA_TOO_LARGE', ru.api.chatMediaTooLarge, 413);
      }
      const relay = await dataApi.execute<{
        recipient_user_id: string;
        destination_chat_id: number;
        recipient_muted: number;
        notify_message: number;
      }>('conversations.resolveMiniAppRelay', {
        userId: session.userId,
        conversationId,
      });
      const file = new InputFile(bytes, body.fileName);
      const common = {
        protect_content: true,
        disable_notification: Boolean(relay.recipient_muted),
      };
      const delivered =
        body.kind === 'photo'
          ? await bot.api.sendPhoto(relay.destination_chat_id, file, common)
          : body.kind === 'animation'
            ? await bot.api.sendAnimation(relay.destination_chat_id, file, common)
            : body.kind === 'video'
              ? body.mimeType === 'video/mp4'
                ? await bot.api.sendVideo(relay.destination_chat_id, file, common)
                : await bot.api.sendDocument(relay.destination_chat_id, file, common)
              : body.kind === 'audio'
                ? body.mimeType === 'audio/webm'
                  ? await bot.api.sendDocument(relay.destination_chat_id, file, common)
                  : await bot.api.sendAudio(relay.destination_chat_id, file, common)
                : body.kind === 'voice'
                  ? body.mimeType === 'audio/webm'
                    ? await bot.api.sendDocument(relay.destination_chat_id, file, common)
                    : await bot.api.sendVoice(relay.destination_chat_id, file, common)
                  : await bot.api.sendVoice(relay.destination_chat_id, file, common);
      const telegramFileId = telegramMediaFileId(delivered, body.kind);
      if (!telegramFileId) {
        throw new DataApiError('CHAT_MEDIA_UNAVAILABLE', ru.api.requestFailed, 502);
      }
      const deliveredRecord = recordValue(delivered);
      const deliveredAudio = recordValue(deliveredRecord?.audio);
      const audioMetadata =
        body.kind === 'audio'
          ? telegramAudioMetadata({
              ...(typeof deliveredAudio?.title === 'string' ? { title: deliveredAudio.title } : {}),
              ...(typeof deliveredAudio?.performer === 'string'
                ? { performer: deliveredAudio.performer }
                : {}),
              file_name: body.fileName,
              ...(typeof recordValue(deliveredAudio?.thumbnail)?.file_id === 'string'
                ? {
                    thumbnail: {
                      file_id: String(recordValue(deliveredAudio?.thumbnail)?.file_id),
                    },
                  }
                : {}),
            })
          : {};
      const recorded = await dataApi.execute<{ messageId: string }>(
        'conversations.recordMiniAppMessage',
        {
          userId: session.userId,
          conversationId,
          destinationMessageId: delivered.message_id,
          messageType: body.kind,
          telegramFileId,
          mimeType: body.mimeType,
          fileName: body.fileName,
          ...audioMetadata,
          ...(typeof deliveredAudio?.duration === 'number'
            ? { durationSeconds: deliveredAudio.duration }
            : {}),
          ...(body.mediaGroupId ? { mediaGroupId: body.mediaGroupId } : {}),
          ...(body.playlistTitle !== undefined ? { playlistTitle: body.playlistTitle } : {}),
          ...(body.replyToMessageId ? { replyToMessageId: body.replyToMessageId } : {}),
          ...(body.caption
            ? {
                encryptedContent: await encryptChatContent(body.caption, env.SESSION_SECRET),
                captionPosition: body.captionPosition,
              }
            : {}),
        },
      );
      await bot.api
        .deleteMessage(relay.destination_chat_id, delivered.message_id)
        .catch(() => false);
      try {
        await dataApi.execute('notifications.activity.create', {
          actorUserId: session.userId,
          targetUserId: relay.recipient_user_id,
          kind: 'message',
          context: 'chat',
          entityId: conversationId,
          openPath: `/chats?conversation=${encodeURIComponent(conversationId)}`,
          sourceKey: `chat:${conversationId}:media:${body.mediaGroupId ?? recorded.messageId}`,
          message: ru.bot.newMessageNotification,
        });
        if (body.notifyRecipient) {
          await queueChatTelegramNotification({
            targetUserId: relay.recipient_user_id,
            conversationId,
            sourceKey: `chat:${conversationId}:media:${body.mediaGroupId ?? recorded.messageId}`,
          });
        }
        if (body.caption) {
          await notifyMentions({
            actorUserId: session.userId,
            text: body.caption,
            context: 'chat',
            entityId: conversationId,
            openPath: `/chats?conversation=${encodeURIComponent(conversationId)}`,
            sourceKey: `chat-caption:${recorded.messageId}`,
          });
        }
      } catch (error) {
        request.log.error(
          {
            event: 'chat_post_commit_notification_failed',
            requestId: request.id,
            error: error instanceof Error ? error.message : 'unknown',
          },
          'chat media was recorded but its notification failed',
        );
      }
      return { sent: true, messageType: body.kind, messageId: recorded.messageId };
    },
  );
  app.post('/api/conversations/:conversationId/profile-share', async (request) => {
    const session = await mutateSafe(request);
    const { conversationId } = z
      .object({ conversationId: z.string().uuid() })
      .parse(request.params);
    const { replyToMessageId } = z
      .object({ replyToMessageId: z.string().uuid().optional() })
      .parse(request.body ?? {});
    const relay = await dataApi.execute<{
      recipient_user_id: string;
      destination_chat_id: number;
      recipient_muted: number;
      notify_message: number;
    }>('conversations.resolveMiniAppRelay', {
      userId: session.userId,
      conversationId,
    });
    const telegramUser = await dataApi.execute<{
      telegram_user_id: number;
      telegram_username: string | null;
      telegram_first_name: string;
    }>('users.get', { telegramUserId: session.telegramUserId });
    const telegramProfileUrl = telegramUser.telegram_username
      ? `https://t.me/${telegramUser.telegram_username}`
      : `tg://user?id=${telegramUser.telegram_user_id}`;
    const telegramPhotos = await bot.api
      .getUserProfilePhotos(telegramUser.telegram_user_id, { limit: 1 })
      .catch(() => null);
    const avatarFileId = telegramPhotos?.photos[0]?.at(-1)?.file_id ?? null;
    const profileText = ru.bot.sharedTelegramProfile({
      firstName: telegramUser.telegram_first_name,
      username: telegramUser.telegram_username,
      url: telegramProfileUrl,
    });
    const delivered = await bot.api.sendMessage(relay.destination_chat_id, profileText, {
      protect_content: true,
      disable_notification: Boolean(relay.recipient_muted),
      reply_markup: new InlineKeyboard().url(
        ru.miniApp.community.openTelegramProfile,
        telegramProfileUrl,
      ),
      ...(telegramProfileUrl.startsWith('https://')
        ? { link_preview_options: { is_disabled: false } }
        : {}),
    });
    const profileShare = JSON.stringify({
      kind: 'telegram_profile',
      displayName: telegramUser.telegram_first_name,
      username: telegramUser.telegram_username,
      url: telegramProfileUrl,
      avatarFileId,
    });
    const recorded = await dataApi.execute<{ messageId: string }>(
      'conversations.recordMiniAppMessage',
      {
        userId: session.userId,
        conversationId,
        destinationMessageId: delivered.message_id,
        messageType: 'profile',
        encryptedContent: await encryptChatContent(profileShare, env.SESSION_SECRET),
        ...(replyToMessageId ? { replyToMessageId } : {}),
      },
    );
    await bot.api.deleteMessage(relay.destination_chat_id, delivered.message_id).catch(() => false);
    await queueChatTelegramNotification({
      targetUserId: relay.recipient_user_id,
      conversationId,
      sourceKey: `chat-profile:${conversationId}:${recorded.messageId}`,
    });
    return { sent: true, messageId: recorded.messageId };
  });
  app.post('/api/conversations/:conversationId/scenario-share', async (request) => {
    const session = await mutateSafe(request);
    const { conversationId } = z
      .object({ conversationId: z.string().uuid() })
      .parse(request.params);
    const { variantId, replyToMessageId } = z
      .object({ variantId: z.string().uuid(), replyToMessageId: z.string().uuid().optional() })
      .parse(request.body);
    const variant = await dataApi.execute<{
      name: string;
      short_headline: string;
      about: string;
      plots: string;
    }>('premium.profileVariants.getShareable', {
      userId: session.userId,
      variantId,
    });
    const relay = await dataApi.execute<{
      recipient_user_id: string;
      destination_chat_id: number;
      recipient_muted: number;
      notify_message: number;
    }>('conversations.resolveMiniAppRelay', {
      userId: session.userId,
      conversationId,
    });
    const scenarioText = ru.bot.sharedScenario(variant);
    const delivered = await bot.api.sendMessage(relay.destination_chat_id, scenarioText, {
      protect_content: true,
      disable_notification: Boolean(relay.recipient_muted),
    });
    const recorded = await dataApi.execute<{ messageId: string }>(
      'conversations.recordMiniAppMessage',
      {
        userId: session.userId,
        conversationId,
        destinationMessageId: delivered.message_id,
        messageType: 'scenario',
        encryptedContent: await encryptChatContent(scenarioText, env.SESSION_SECRET),
        ...(replyToMessageId ? { replyToMessageId } : {}),
      },
    );
    await bot.api.deleteMessage(relay.destination_chat_id, delivered.message_id).catch(() => false);
    await queueChatTelegramNotification({
      targetUserId: relay.recipient_user_id,
      conversationId,
      sourceKey: `chat-scenario:${conversationId}:${recorded.messageId}`,
    });
    return { sent: true, messageId: recorded.messageId };
  });
  app.post('/api/shares/entity', async (request) => {
    const session = await mutateSafe(request);
    const body = z
      .object({
        entityType: z.enum(['post', 'questionnaire']),
        entityId: z.string().uuid(),
        conversationIds: z
          .array(z.string().uuid())
          .min(1)
          .max(20)
          .refine((ids) => new Set(ids).size === ids.length),
        caption: z.string().trim().min(1).max(1_000).optional(),
      })
      .parse(request.body);
    const entity = await dataApi.execute<{
      id: string;
      entity_type: 'post' | 'questionnaire';
      title: string;
      body: string;
      author_user_id: string;
      display_name?: string | null;
      avatar_media_id?: string | null;
      avatar_render_mode?: string | null;
      media?: string;
    }>('shares.entity.resolve', {
      userId: session.userId,
      entityType: body.entityType,
      entityId: body.entityId,
    });
    const openPath =
      entity.entity_type === 'post'
        ? `/posts/${encodeURIComponent(entity.id)}`
        : `/search?questionnaire=${encodeURIComponent(entity.id)}`;
    const shareText = ru.bot.sharedEntity({
      type: entity.entity_type,
      title: entity.title,
      body: entity.body,
    });
    let sharedMedia: unknown = [];
    if (entity.media) {
      try {
        sharedMedia = JSON.parse(entity.media) as unknown;
      } catch {
        sharedMedia = [];
      }
    }
    const storedShare = JSON.stringify({
      kind: 'shared_entity',
      entityType: entity.entity_type,
      entityId: entity.id,
      authorUserId: entity.author_user_id,
      authorName: entity.display_name ?? null,
      avatarMediaId: entity.avatar_media_id ?? null,
      avatarRenderMode: entity.avatar_render_mode ?? null,
      title: entity.title,
      body: entity.body,
      ...(body.caption ? { caption: body.caption } : {}),
      media: Array.isArray(sharedMedia) ? sharedMedia : [],
    });
    for (const conversationId of body.conversationIds) {
      const relay = await dataApi.execute<{
        recipient_user_id: string;
        destination_chat_id: number;
        recipient_muted: number;
        notify_message: number;
      }>('conversations.resolveMiniAppRelay', { userId: session.userId, conversationId });
      const delivered = await bot.api.sendMessage(relay.destination_chat_id, shareText, {
        protect_content: true,
        disable_notification: Boolean(relay.recipient_muted),
        reply_markup: new InlineKeyboard().webApp(
          ru.bot.openNotification,
          `${env.MINI_APP_URL}${openPath}`,
        ),
      });
      const recorded = await dataApi.execute<{ messageId: string }>(
        'conversations.recordMiniAppMessage',
        {
          userId: session.userId,
          conversationId,
          destinationMessageId: delivered.message_id,
          messageType: 'text',
          encryptedContent: await encryptChatContent(storedShare, env.SESSION_SECRET),
        },
      );
      await dataApi.execute('shares.record', {
        userId: session.userId,
        entityType: entity.entity_type,
        entityId: entity.id,
        conversationId,
      });
      await bot.api
        .deleteMessage(relay.destination_chat_id, delivered.message_id)
        .catch(() => false);
      await queueChatTelegramNotification({
        targetUserId: relay.recipient_user_id,
        conversationId,
        sourceKey: `chat-share:${conversationId}:${recorded.messageId}`,
      });
    }
    return { sent: body.conversationIds.length };
  });
  app.post('/api/shares/playlist', async (request) => {
    const session = await mutateSafe(request);
    const body = z
      .object({
        sourceType: z.enum(['post', 'chat']),
        sourceId: z.string().min(1).max(128),
        trackIds: z
          .array(z.string().uuid())
          .min(1)
          .max(20)
          .refine((ids) => new Set(ids).size === ids.length),
        conversationIds: z
          .array(z.string().uuid())
          .min(1)
          .max(20)
          .refine((ids) => new Set(ids).size === ids.length),
        title: z.string().trim().min(1).max(120).nullable().optional(),
      })
      .parse(request.body);
    const tracks = await dataApi.execute<
      Array<{
        id: string;
        telegram_file_id: string;
        media_type: 'audio' | 'voice';
        track_title: string | null;
        track_performer: string | null;
        thumbnail_telegram_file_id: string | null;
        playlist_title: string | null;
      }>
    >('shares.playlist.resolve', {
      userId: session.userId,
      sourceType: body.sourceType,
      sourceId: body.sourceId,
      trackIds: body.trackIds,
    });
    const playlistTitle =
      body.title === undefined ? (tracks[0]?.playlist_title ?? null) : body.title;
    for (const conversationId of body.conversationIds) {
      const relay = await dataApi.execute<{
        recipient_user_id: string;
        destination_chat_id: number;
        recipient_muted: number;
        notify_message: number;
      }>('conversations.resolveMiniAppRelay', { userId: session.userId, conversationId });
      const mediaGroupId = crypto.randomUUID();
      const heading = await bot.api.sendMessage(
        relay.destination_chat_id,
        ru.bot.sharedPlaylist(playlistTitle, tracks.length),
        { protect_content: true, disable_notification: Boolean(relay.recipient_muted) },
      );
      await bot.api.deleteMessage(relay.destination_chat_id, heading.message_id).catch(() => false);
      for (const track of tracks) {
        const delivered =
          track.media_type === 'voice'
            ? await bot.api.sendVoice(relay.destination_chat_id, track.telegram_file_id, {
                protect_content: true,
                disable_notification: Boolean(relay.recipient_muted),
              })
            : await bot.api.sendAudio(relay.destination_chat_id, track.telegram_file_id, {
                protect_content: true,
                disable_notification: Boolean(relay.recipient_muted),
              });
        await dataApi.execute('conversations.recordMiniAppMessage', {
          userId: session.userId,
          conversationId,
          destinationMessageId: delivered.message_id,
          messageType: track.media_type,
          telegramFileId: track.telegram_file_id,
          ...(track.track_title ? { trackTitle: track.track_title } : {}),
          ...(track.track_performer ? { trackPerformer: track.track_performer } : {}),
          ...(track.thumbnail_telegram_file_id
            ? { thumbnailTelegramFileId: track.thumbnail_telegram_file_id }
            : {}),
          mediaGroupId,
          ...(playlistTitle ? { playlistTitle } : {}),
        });
        await bot.api
          .deleteMessage(relay.destination_chat_id, delivered.message_id)
          .catch(() => false);
      }
      await dataApi.execute('shares.record', {
        userId: session.userId,
        entityType: 'playlist',
        entityId: `${body.sourceType}:${body.sourceId}`,
        conversationId,
      });
      await queueChatTelegramNotification({
        targetUserId: relay.recipient_user_id,
        conversationId,
        sourceKey: `chat-playlist:${conversationId}:${mediaGroupId}`,
      });
    }
    return { sent: body.conversationIds.length, tracks: tracks.length };
  });
  app.get('/api/matches', async (request) => {
    const session = await authenticate(request);
    return dataApi.execute('matches.list', { userId: session.userId, limit: 50 });
  });
  app.post('/api/conversations/:conversationId/control', async (request) => {
    const session = await mutate(request);
    const params = z.object({ conversationId: z.string().uuid() }).parse(request.params);
    const body = z
      .object({ action: z.enum(['mute', 'unmute', 'pause', 'resume', 'close']) })
      .parse(request.body);
    return dataApi.execute('conversations.control', {
      userId: session.userId,
      conversationId: params.conversationId,
      action: body.action,
    });
  });
  app.get('/api/posts', async (request) => {
    const session = await authenticate(request);
    const { limit, sort, followingOnly } = z
      .object({
        limit: z.coerce.number().int().min(1).max(50).default(20),
        sort: z.enum(['interesting', 'new']).default('interesting'),
        followingOnly: z
          .enum(['true', 'false'])
          .default('false')
          .transform((value) => value === 'true'),
      })
      .parse(request.query);
    return dataApi.execute('posts.feed.list', {
      userId: session.userId,
      limit,
      sort,
      followingOnly,
    });
  });
  app.get('/api/posts/own', async (request) => {
    const session = await authenticate(request);
    const { limit } = z
      .object({ limit: z.coerce.number().int().min(1).max(50).default(20) })
      .parse(request.query);
    return dataApi.execute('posts.own.list', { userId: session.userId, limit });
  });
  app.get('/api/posts/:postId', async (request) => {
    const session = await authenticate(request);
    const { postId } = z.object({ postId: z.string().uuid() }).parse(request.params);
    return dataApi.execute('posts.get', { userId: session.userId, postId });
  });
  app.post('/api/posts/:postId/repost', async (request) => {
    const session = await mutateSafe(request);
    const { postId } = z.object({ postId: z.string().uuid() }).parse(request.params);
    return dataApi.execute('posts.repost', { userId: session.userId, postId });
  });
  app.put('/api/posts/:postId', async (request) => {
    const session = await mutateSafe(request);
    const { postId } = z.object({ postId: z.string().uuid() }).parse(request.params);
    const body = z
      .object({
        title: z.string().trim().max(120),
        bodyMarkdown: z.string().trim().min(1).max(8_000),
        tags: z.array(z.string().trim().min(1).max(60)).max(20).default([]),
        fandoms: z.array(z.string().trim().min(1).max(100)).max(20).default([]),
        hashtags: z.array(z.string().trim().min(1).max(60)).max(20).default([]),
        playlistTitle: z.string().trim().min(1).max(120).nullable().optional(),
      })
      .parse(request.body);
    return dataApi.execute('posts.updateOwn', {
      userId: session.userId,
      postId,
      ...body,
    });
  });
  app.delete('/api/posts/:postId', async (request) => {
    const session = await mutateSafe(request);
    const { postId } = z.object({ postId: z.string().uuid() }).parse(request.params);
    return dataApi.execute('posts.delete', { userId: session.userId, postId });
  });
  app.delete('/api/posts/:postId/media', async (request) => {
    const session = await mutateSafe(request);
    const { postId } = z.object({ postId: z.string().uuid() }).parse(request.params);
    return dataApi.execute('posts.media.removeOwn', { userId: session.userId, postId });
  });
  app.delete('/api/posts/:postId/media/:mediaId', async (request) => {
    const session = await mutateSafe(request);
    const { postId, mediaId } = z
      .object({ postId: z.string().uuid(), mediaId: z.string().uuid() })
      .parse(request.params);
    return dataApi.execute('posts.media.removeOwn', {
      userId: session.userId,
      postId,
      mediaId,
    });
  });
  app.get('/api/posts/:postId/comments', async (request) => {
    const session = await authenticate(request);
    const { postId } = z.object({ postId: z.string().uuid() }).parse(request.params);
    const { sort } = z
      .object({ sort: z.enum(['interesting', 'new']).default('interesting') })
      .parse(request.query);
    return dataApi.execute('posts.comments.list', {
      userId: session.userId,
      postId,
      sort,
      limit: 100,
    });
  });
  app.get('/api/posts/:postId/media', async (request, reply) => {
    const session = await authenticate(request);
    const { postId } = z.object({ postId: z.string().uuid() }).parse(request.params);
    const media = await dataApi.execute<{ telegram_file_id: string; content_type: string }>(
      'posts.media.resolve',
      { userId: session.userId, postId },
    );
    const file = await bot.api.getFile(media.telegram_file_id);
    if (!file.file_path) throw new DataApiError('MEDIA_UNAVAILABLE', ru.api.mediaUnavailable, 404);
    const response = await fetch(
      `https://api.telegram.org/file/bot${env.TELEGRAM_BOT_TOKEN}/${file.file_path}`,
      telegramFileRequestInit(request),
    );
    if (!response.ok) throw new DataApiError('MEDIA_UNAVAILABLE', ru.api.mediaUnavailable, 502);
    reply.header(
      'Content-Type',
      response.headers.get('content-type') ?? 'application/octet-stream',
    );
    reply.header('Cache-Control', 'private, max-age=300');
    applySeekableMediaHeaders(reply, response);
    return reply.send(response.body);
  });
  app.get('/api/posts/:postId/thumbnail', async (request, reply) => {
    const session = await authenticate(request);
    const { postId } = z.object({ postId: z.string().uuid() }).parse(request.params);
    const media = await dataApi.execute<{ thumbnail_telegram_file_id: string | null }>(
      'posts.media.resolve',
      { userId: session.userId, postId },
    );
    if (!media.thumbnail_telegram_file_id)
      throw new DataApiError('MEDIA_UNAVAILABLE', ru.api.mediaUnavailable, 404);
    const file = await bot.api.getFile(media.thumbnail_telegram_file_id);
    if (!file.file_path) throw new DataApiError('MEDIA_UNAVAILABLE', ru.api.mediaUnavailable, 404);
    const response = await fetch(
      `https://api.telegram.org/file/bot${env.TELEGRAM_BOT_TOKEN}/${file.file_path}`,
      telegramFileRequestInit(request),
    );
    if (!response.ok) throw new DataApiError('MEDIA_UNAVAILABLE', ru.api.mediaUnavailable, 502);
    reply.header('Content-Type', response.headers.get('content-type') ?? 'image/jpeg');
    reply.header('Cache-Control', 'private, max-age=300');
    return reply.send(response.body);
  });
  app.get('/api/posts/:postId/media/:mediaId/thumbnail', async (request, reply) => {
    const session = await authenticate(request);
    const { postId, mediaId } = z
      .object({ postId: z.string().uuid(), mediaId: z.string().uuid() })
      .parse(request.params);
    const media = await dataApi.execute<{ thumbnail_telegram_file_id: string | null }>(
      'posts.media.resolveItem',
      { userId: session.userId, postId, mediaId },
    );
    if (!media.thumbnail_telegram_file_id)
      throw new DataApiError('MEDIA_UNAVAILABLE', ru.api.mediaUnavailable, 404);
    const file = await bot.api.getFile(media.thumbnail_telegram_file_id);
    if (!file.file_path) throw new DataApiError('MEDIA_UNAVAILABLE', ru.api.mediaUnavailable, 404);
    const response = await fetch(
      `https://api.telegram.org/file/bot${env.TELEGRAM_BOT_TOKEN}/${file.file_path}`,
      telegramFileRequestInit(request),
    );
    if (!response.ok) throw new DataApiError('MEDIA_UNAVAILABLE', ru.api.mediaUnavailable, 502);
    reply.header('Content-Type', response.headers.get('content-type') ?? 'image/jpeg');
    reply.header('Cache-Control', 'private, max-age=300');
    return reply.send(response.body);
  });
  app.get('/api/posts/:postId/media/:mediaId', async (request, reply) => {
    const session = await authenticate(request);
    const { postId, mediaId } = z
      .object({ postId: z.string().uuid(), mediaId: z.string().uuid() })
      .parse(request.params);
    const media = await dataApi.execute<{ telegram_file_id: string; content_type: string }>(
      'posts.media.resolveItem',
      { userId: session.userId, postId, mediaId },
    );
    const file = await bot.api.getFile(media.telegram_file_id);
    if (!file.file_path) throw new DataApiError('MEDIA_UNAVAILABLE', ru.api.mediaUnavailable, 404);
    const response = await fetch(
      `https://api.telegram.org/file/bot${env.TELEGRAM_BOT_TOKEN}/${file.file_path}`,
      telegramFileRequestInit(request),
    );
    if (!response.ok) throw new DataApiError('MEDIA_UNAVAILABLE', ru.api.mediaUnavailable, 502);
    reply.header(
      'Content-Type',
      response.headers.get('content-type') ?? 'application/octet-stream',
    );
    reply.header('Cache-Control', 'private, max-age=300');
    applySeekableMediaHeaders(reply, response);
    return reply.send(response.body);
  });
  app.post('/api/posts/:postId/comments', async (request) => {
    const session = await mutateSafe(request);
    const { postId } = z.object({ postId: z.string().uuid() }).parse(request.params);
    const { body, parentCommentId } = z
      .object({
        body: z.string().trim().min(1).max(1_000),
        parentCommentId: z.string().uuid().optional(),
      })
      .parse(request.body);
    const created = await dataApi.execute<{
      id: string;
      created: true;
      authorUserId: string;
      replyTargetUserId: string | null;
    }>('posts.comments.create', {
      userId: session.userId,
      postId,
      body,
      ...(parentCommentId ? { parentCommentId } : {}),
    });
    const activity = await dataApi.execute<{
      target_user_id: string;
      telegram_user_id: number | null;
      open_path: string;
    } | null>('notifications.activity.create', {
      actorUserId: session.userId,
      targetUserId: created.authorUserId,
      kind: 'comment',
      context: 'comment',
      entityId: postId,
      openPath: `/posts/${encodeURIComponent(postId)}`,
      sourceKey: `comment:${created.id}:author`,
      message: ru.bot.commentNotification,
    });
    if (activity) {
      await queueTelegramActivityNotification({
        targetUserId: activity.target_user_id,
        category: 'comment',
        message: ru.bot.commentNotification,
        openPath: activity.open_path,
        sourceKey: `comment:${created.id}:author:telegram`,
      });
    }
    if (created.replyTargetUserId && created.replyTargetUserId !== created.authorUserId) {
      const replyActivity = await dataApi.execute<{
        target_user_id: string;
        telegram_user_id: number | null;
        open_path: string;
      } | null>('notifications.activity.create', {
        actorUserId: session.userId,
        targetUserId: created.replyTargetUserId,
        kind: 'comment',
        context: 'comment',
        entityId: postId,
        openPath: `/posts/${encodeURIComponent(postId)}`,
        sourceKey: `comment:${created.id}:reply`,
        message: ru.bot.commentNotification,
      });
      if (replyActivity) {
        await queueTelegramActivityNotification({
          targetUserId: replyActivity.target_user_id,
          category: 'comment',
          message: ru.bot.commentNotification,
          openPath: replyActivity.open_path,
          sourceKey: `comment:${created.id}:reply:telegram`,
        });
      }
    }
    await notifyMentions({
      actorUserId: session.userId,
      text: body,
      context: 'comment',
      entityId: postId,
      openPath: `/posts/${encodeURIComponent(postId)}`,
      sourceKey: `comment:${created.id}`,
    });
    return created;
  });
  app.put('/api/comments/:commentId', async (request) => {
    const session = await mutateSafe(request);
    const { commentId } = z.object({ commentId: z.string().uuid() }).parse(request.params);
    const { body } = z.object({ body: z.string().trim().min(1).max(1_000) }).parse(request.body);
    const updated = await dataApi.execute<{ updated: true; postId: string }>(
      'posts.comments.updateOwn',
      {
        userId: session.userId,
        commentId,
        body,
      },
    );
    await notifyMentions({
      actorUserId: session.userId,
      text: body,
      context: 'comment',
      entityId: commentId,
      openPath: `/posts/${encodeURIComponent(updated.postId)}`,
      sourceKey: `comment-edit:${commentId}:${await sha256(body)}`,
    });
    return updated;
  });
  app.delete('/api/comments/:commentId', async (request) => {
    const session = await mutateSafe(request);
    const { commentId } = z.object({ commentId: z.string().uuid() }).parse(request.params);
    return dataApi.execute('posts.comments.deleteOwn', {
      userId: session.userId,
      commentId,
    });
  });
  app.put('/api/comments/:commentId/rating', async (request) => {
    const session = await mutateSafe(request);
    const { commentId } = z.object({ commentId: z.string().uuid() }).parse(request.params);
    const { value } = z
      .object({ value: z.union([z.literal(-1), z.literal(1)]) })
      .parse(request.body);
    const result = await dataApi.execute<{
      saved: true;
      value: -1 | 1 | null;
      authorUserId: string;
      postId: string;
    }>('posts.comments.rate', {
      userId: session.userId,
      commentId,
      value,
    });
    if (result.value === 1) {
      await queueTelegramActivityNotification({
        targetUserId: result.authorUserId,
        category: 'comment',
        message: ru.bot.commentLikeNotification,
        openPath: `/posts/${encodeURIComponent(result.postId)}`,
        sourceKey: `comment-like:${request.id}`,
      });
    }
    return result;
  });
  app.put('/api/posts/:postId/rating', async (request) => {
    const session = await mutateSafe(request);
    const { postId } = z.object({ postId: z.string().uuid() }).parse(request.params);
    const { value } = z
      .object({ value: z.union([z.literal(-1), z.literal(1)]) })
      .parse(request.body);
    const result = await dataApi.execute<{
      saved: true;
      value: -1 | 1 | null;
      authorUserId: string;
    }>('posts.rate', { userId: session.userId, postId, value });
    if (result.value === 1) {
      await queueTelegramActivityNotification({
        targetUserId: result.authorUserId,
        category: 'like',
        message: ru.bot.postLikeNotification,
        openPath: `/posts/${encodeURIComponent(postId)}`,
        sourceKey: `post-like:${request.id}`,
      });
    }
    return result;
  });
  app.post('/api/posts/:postId/view', async (request) => {
    const session = await mutateSafe(request);
    const { postId } = z.object({ postId: z.string().uuid() }).parse(request.params);
    return dataApi.execute('posts.recordView', { userId: session.userId, postId });
  });
  app.get('/api/posts/:postId/engagement', async (request) => {
    const session = await authenticate(request);
    const { postId } = z.object({ postId: z.string().uuid() }).parse(request.params);
    const { kind } = z.object({ kind: z.enum(['ratings', 'shares']) }).parse(request.query);
    return dataApi.execute('posts.engagement.list', { userId: session.userId, postId, kind });
  });
  app.post('/api/posts/:postId/hide', async (request) => {
    const session = await mutateSafe(request);
    const { postId } = z.object({ postId: z.string().uuid() }).parse(request.params);
    return dataApi.execute('posts.hide', { userId: session.userId, postId });
  });
  app.get('/api/settings', async (request) => {
    const session = await authenticate(request);
    return dataApi.execute('settings.get', { userId: session.userId });
  });
  app.put('/api/settings', async (request) => {
    const session = await mutate(request);
    const settings = settingsBodySchema.parse(request.body);
    return dataApi.execute('settings.update', { userId: session.userId, ...settings });
  });
  app.get('/api/blocks', async (request) => {
    const session = await authenticate(request);
    return dataApi.execute('blocks.list', { blockerUserId: session.userId });
  });
  app.post('/api/blocks', async (request) => {
    const session = await mutateSafe(request);
    const body = blockBodySchema.parse(request.body);
    return dataApi.execute('blocks.create', {
      blockerUserId: session.userId,
      blockedUserId: body.blockedUserId,
      reason: body.reason,
    });
  });
  app.delete('/api/blocks/:blockedUserId', async (request) => {
    const session = await mutateSafe(request);
    const { blockedUserId } = z.object({ blockedUserId: z.string().uuid() }).parse(request.params);
    return dataApi.execute('blocks.remove', {
      blockerUserId: session.userId,
      blockedUserId,
    });
  });
  app.post('/api/reports', async (request) => {
    const session = await mutateSafe(request);
    const body = reportBodySchema.parse(request.body);
    const created = await dataApi.execute<{
      reportId: string;
      staffUserIds?: string[];
      staffTelegramUserIds: number[];
    }>('reports.create', {
      reporterUserId: session.userId,
      reportedUserId: body.reportedUserId,
      ...(body.conversationId ? { conversationId: body.conversationId } : {}),
      ...(body.postId ? { postId: body.postId } : {}),
      ...(body.questionnaireId ? { questionnaireId: body.questionnaireId } : {}),
      ...(body.commentId ? { commentId: body.commentId } : {}),
      ...(body.profileUserId ? { profileUserId: body.profileUserId } : {}),
      category: body.category,
      description: body.description,
      evidenceSnapshot: [],
    });
    if (created.staffUserIds?.length) {
      await Promise.allSettled(
        created.staffUserIds.map((targetUserId) =>
          queueTelegramActivityNotification({
            targetUserId,
            category: 'moderation',
            message: ru.bot.reportReceived,
            openPath: `/admin?section=reports&report=${encodeURIComponent(created.reportId)}`,
            sourceKey: `report:${created.reportId}:staff:${targetUserId}`,
          }),
        ),
      );
    } else {
      await Promise.allSettled(
        (created.staffTelegramUserIds ?? []).map((telegramUserId) =>
          bot.api.sendMessage(telegramUserId, ru.bot.reportReceived, {
            protect_content: true,
            reply_markup: new InlineKeyboard().webApp(
              ru.bot.openNotification,
              `${env.MINI_APP_URL}/admin?section=reports&report=${encodeURIComponent(created.reportId)}`,
            ),
          }),
        ),
      );
    }
    return created;
  });
  app.get('/api/products', async (request) => {
    const session = await authenticate(request);
    return dataApi.execute('products.listForUser', {
      userId: session.userId,
      activeOnly: true,
    });
  });
  app.post('/api/payments/invoice', async (request) => {
    const session = await mutateSafe(request);
    const body = z.object({ productId: z.string().uuid() }).parse(request.body);
    const products = await dataApi.execute<
      Array<{
        id: string;
        name: string;
        description: string;
        stars_amount: number;
        billing_type: string;
      }>
    >('products.list', { activeOnly: true });
    const product = products.find((item) => item.id === body.productId);
    if (!product) throw new DataApiError('PRODUCT_NOT_FOUND', 'Product not found', 404);
    const order = await dataApi.execute<{ invoicePayload: string; amount: number }>(
      'payments.create',
      {
        userId: session.userId,
        productId: body.productId,
        idempotencyKey: request.id,
      },
    );
    return stars.createPayment({
      userId: session.userId,
      telegramUserId: session.telegramUserId,
      productId: product.id,
      title: product.name,
      description: product.description,
      amount: order.amount,
      currency: 'XTR',
      invoicePayload: order.invoicePayload,
      ...(product.billing_type === 'subscription' ? { subscriptionPeriod: 2_592_000 } : {}),
    });
  });
  app.post('/api/conversations/:conversationId/premium-gift/invoice', async (request) => {
    const session = await mutateSafe(request);
    const { conversationId } = z
      .object({ conversationId: z.string().uuid() })
      .parse(request.params);
    const body = z.object({ productId: z.string().uuid() }).parse(request.body);
    const products = await dataApi.execute<
      Array<{
        id: string;
        name: string;
        description: string;
        stars_amount: number;
        billing_type: string;
      }>
    >('products.list', { activeOnly: true });
    const product = products.find(
      (item) => item.id === body.productId && item.billing_type === 'one_time',
    );
    if (!product) throw new DataApiError('GIFT_PRODUCT_NOT_FOUND', ru.api.giftProductNotFound, 404);
    const order = await dataApi.execute<{ invoicePayload: string; amount: number }>(
      'payments.createGift',
      {
        userId: session.userId,
        conversationId,
        productId: product.id,
        idempotencyKey: request.id,
      },
    );
    return stars.createPayment({
      userId: session.userId,
      telegramUserId: session.telegramUserId,
      productId: product.id,
      title: ru.bot.premiumGiftInvoiceTitle(product.name),
      description: ru.bot.premiumGiftInvoiceDescription(product.description),
      amount: order.amount,
      currency: 'XTR',
      invoicePayload: order.invoicePayload,
    });
  });
  app.get('/api/referrals', async (request) => {
    const session = await authenticate(request);
    return dataApi.execute('referrals.summary', {
      userId: session.userId,
      botUsername: env.BOT_USERNAME,
    });
  });
  app.post('/api/captcha/turnstile', async (request, reply) => {
    const session = await mutate(request);
    const body = captchaBodySchema.parse(request.body);
    const passed = await verifyTurnstile(env.TURNSTILE_SECRET_KEY, body.token, request.ip);
    if (!passed) return reply.code(422).send({ passed: false });
    await dataApi.execute('risk.record', {
      userId: session.userId,
      type: 'turnstile_passed',
      scoreDelta: -50,
      metadata: { action: body.action },
    });
    request.log.info({ userId: session.userId, action: body.action }, 'turnstile completed');
    return { passed: true };
  });
  app.delete('/api/account', async (request, reply) => {
    const session = await mutate(request);
    deleteBodySchema.parse(request.body);
    await dataApi.execute('users.delete', { userId: session.userId });
    reply.clearCookie('rm_session', { path: '/' });
    return { deleted: true };
  });
  app.get('/api/admin/dashboard', async (request) => {
    const session = await requireAdmin(request);
    return dataApi.execute('admin.dashboard', { adminUserId: session.userId });
  });
  app.get('/api/admin/moderators', async (request) => {
    const session = await requireAdmin(request);
    return dataApi.execute('moderators.list', {
      ownerTelegramUserId: session.telegramUserId,
    });
  });
  app.post('/api/admin/moderators', async (request) => {
    const session = await requireAdmin(request, true);
    const { telegramUserId } = z
      .object({ telegramUserId: z.number().int().positive() })
      .parse(request.body);
    return dataApi.execute('moderators.assign', {
      ownerTelegramUserId: session.telegramUserId,
      targetTelegramUserId: telegramUserId,
    });
  });
  app.delete('/api/admin/moderators/:telegramUserId', async (request) => {
    const session = await requireAdmin(request, true);
    const { telegramUserId } = z
      .object({ telegramUserId: z.coerce.number().int().positive() })
      .parse(request.params);
    return dataApi.execute('moderators.remove', {
      ownerTelegramUserId: session.telegramUserId,
      targetTelegramUserId: telegramUserId,
    });
  });
  app.get('/api/admin/users', async (request) => {
    const session = await requireModerationAccess(request);
    const query = z
      .object({
        q: z.string().max(128).default(''),
        limit: z.coerce.number().int().min(1).max(100).default(50),
      })
      .parse(request.query);
    return dataApi.execute('admin.users.list', {
      adminUserId: session.userId,
      query: query.q,
      limit: query.limit,
    });
  });
  app.get('/api/admin/profiles', async (request) => {
    const session = await requireModerationAccess(request);
    const query = z
      .object({
        q: z.string().max(128).default(''),
        status: z
          .enum(['draft', 'pending', 'approved', 'rejected', 'paused', 'archived', 'all'])
          .default('pending'),
        limit: z.coerce.number().int().min(1).max(100).default(50),
      })
      .parse(request.query);
    return dataApi.execute('admin.profiles.list', {
      adminUserId: session.userId,
      status: query.status,
      query: query.q,
      limit: query.limit,
    });
  });
  app.get('/api/admin/public-profiles', async (request) => {
    const session = await requireModerationAccess(request);
    const query = z
      .object({
        q: z.string().max(128).default(''),
        status: z.enum(['active', 'blocked', 'all']).default('all'),
        limit: z.coerce.number().int().min(1).max(100).default(50),
      })
      .parse(request.query);
    return dataApi.execute('admin.publicProfiles.list', {
      adminUserId: session.userId,
      status: query.status,
      query: query.q,
      limit: query.limit,
    });
  });
  app.get('/api/admin/questionnaires', async (request) => {
    const session = await requireModerationAccess(request);
    const query = z
      .object({
        q: z.string().max(128).default(''),
        status: z
          .enum(['draft', 'pending', 'approved', 'rejected', 'paused', 'archived', 'all'])
          .default('all'),
        limit: z.coerce.number().int().min(1).max(100).default(50),
      })
      .parse(request.query);
    return dataApi.execute('admin.questionnaires.list', {
      adminUserId: session.userId,
      status: query.status,
      query: query.q,
      limit: query.limit,
    });
  });
  app.get('/api/admin/posts', async (request) => {
    const session = await requireModerationAccess(request);
    const query = z
      .object({
        q: z.string().max(128).default(''),
        status: z.enum(['active', 'deleted', 'blocked', 'all']).default('active'),
        limit: z.coerce.number().int().min(1).max(100).default(50),
      })
      .parse(request.query);
    return dataApi.execute('admin.posts.list', {
      adminUserId: session.userId,
      query: query.q,
      status: query.status,
      limit: query.limit,
    });
  });
  app.get('/api/admin/media', async (request) => {
    const session = await requireModerationAccess(request);
    const query = z
      .object({
        status: z.enum(['pending', 'approved', 'rejected', 'all']).default('pending'),
        limit: z.coerce.number().int().min(1).max(100).default(50),
      })
      .parse(request.query);
    return dataApi.execute('admin.media.list', {
      adminUserId: session.userId,
      status: query.status,
      limit: query.limit,
    });
  });
  app.get('/api/admin/reports', async (request) => {
    const session = await requireModerationAccess(request);
    const query = z
      .object({
        status: z.enum(['open', 'reviewing', 'resolved', 'dismissed', 'all']).default('open'),
        limit: z.coerce.number().int().min(1).max(100).default(50),
      })
      .parse(request.query);
    return dataApi.execute('admin.reports.list', {
      adminUserId: session.userId,
      status: query.status,
      limit: query.limit,
    });
  });
  app.get('/api/admin/payments', async (request) => {
    const session = await requireAdmin(request);
    const query = z
      .object({
        status: z
          .enum(['pending', 'precheckout_approved', 'paid', 'refunded', 'failed', 'expired', 'all'])
          .default('all'),
        limit: z.coerce.number().int().min(1).max(100).default(50),
      })
      .parse(request.query);
    return dataApi.execute('admin.payments.list', {
      adminUserId: session.userId,
      ...query,
    });
  });
  app.get('/api/admin/products', async (request) => {
    await requireAdmin(request);
    return dataApi.execute('products.list', { activeOnly: false });
  });
  app.get('/api/admin/promotions', async (request) => {
    const session = await requireAdmin(request);
    return dataApi.execute('admin.promotions.list', {
      adminUserId: session.userId,
      limit: 100,
    });
  });
  app.post('/api/admin/promotions', async (request) => {
    const session = await requireAdmin(request, true);
    const body = z
      .object({
        code: z.string().trim().min(3).max(40),
        type: z.enum(['discount', 'premium_days']),
        discountStars: z.number().int().min(0).max(10_000).default(0),
        discountRubles: z.number().int().min(0).max(1_000_000).default(0),
        premiumDays: z.number().int().min(0).max(3_650).default(0),
        eligibleProductIds: z.array(z.string().uuid()).max(100).default([]),
        expiresAt: z.string().datetime().optional(),
        maxActivations: z.number().int().min(1).max(1_000_000).optional(),
      })
      .parse(request.body);
    return dataApi.execute('admin.promotions.create', {
      adminUserId: session.userId,
      ...body,
    });
  });
  app.put('/api/admin/promotions/:promotionId', async (request) => {
    const session = await requireAdmin(request, true);
    const { promotionId } = z.object({ promotionId: z.string().uuid() }).parse(request.params);
    const body = z
      .object({
        code: z.string().trim().min(3).max(40),
        type: z.enum(['discount', 'premium_days']),
        discountStars: z.number().int().min(0).max(10_000),
        discountRubles: z.number().int().min(0).max(1_000_000),
        premiumDays: z.number().int().min(0).max(3_650),
        eligibleProductIds: z.array(z.string().uuid()).max(100),
        expiresAt: z.string().datetime().nullable(),
        maxActivations: z.number().int().min(1).max(1_000_000).nullable(),
        isActive: z.boolean(),
      })
      .parse(request.body);
    return dataApi.execute('admin.promotions.update', {
      adminUserId: session.userId,
      promotionId,
      ...body,
    });
  });
  app.delete('/api/admin/promotions/:promotionId', async (request) => {
    const session = await requireAdmin(request, true);
    const { promotionId } = z.object({ promotionId: z.string().uuid() }).parse(request.params);
    return dataApi.execute('admin.promotions.delete', {
      adminUserId: session.userId,
      promotionId,
    });
  });
  app.get('/api/admin/posting-requirements', async (request) => {
    const session = await requireAdmin(request);
    return dataApi.execute('admin.postingRequirements.list', {
      adminUserId: session.userId,
      limit: 100,
    });
  });
  app.post('/api/admin/posting-requirements', async (request) => {
    const session = await requireAdmin(request, true);
    const body = z
      .object({
        type: z.enum(['channel', 'supergroup', 'bot']),
        title: z.string().trim().min(3).max(120),
        targetChatId: z.string().max(64).optional(),
        username: z.string().max(32).optional(),
        actionUrl: z.union([z.string().url().max(500), z.literal('')]).optional(),
        createInvite: z.boolean().default(false),
        expiresAt: z.string().datetime().optional(),
        maxConversions: z.number().int().min(1).max(1_000_000).optional(),
      })
      .parse(request.body);
    let actionUrl = body.actionUrl;
    let integrationSecret: string | undefined;
    let botVerificationSecretHash: string | undefined;
    if (body.type === 'bot') {
      if (!actionUrl) {
        if (!body.username)
          throw new DataApiError('BOT_USERNAME_REQUIRED', 'Username required', 400);
        actionUrl = `https://t.me/${body.username.replace(/^@/, '')}`;
      }
      integrationSecret = Array.from(crypto.getRandomValues(new Uint8Array(32)), (byte) =>
        byte.toString(16).padStart(2, '0'),
      ).join('');
      botVerificationSecretHash = await sha256(integrationSecret);
    } else {
      if (!body.targetChatId) {
        throw new DataApiError('TARGET_CHAT_REQUIRED', 'Target chat ID required', 400);
      }
      const target = await bot.api.getChat(body.targetChatId);
      if (
        (body.type === 'channel' && target.type !== 'channel') ||
        (body.type === 'supergroup' && target.type !== 'supergroup')
      ) {
        throw new DataApiError('TARGET_CHAT_TYPE_MISMATCH', 'Target chat type mismatch', 400);
      }
      const botMember = await bot.api.getChatMember(body.targetChatId, bot.botInfo.id);
      if (!['administrator', 'creator'].includes(botMember.status)) {
        throw new DataApiError(
          'BOT_ADMIN_REQUIRED',
          'The RoleMate bot must be an administrator in the target',
          409,
        );
      }
    }
    if (body.type !== 'bot' && body.createInvite) {
      if (!body.targetChatId) {
        throw new DataApiError('TARGET_CHAT_REQUIRED', 'Target chat ID required', 400);
      }
      const invite = await bot.api.createChatInviteLink(body.targetChatId, {
        name: `RoleMate: ${body.title}`.slice(0, 32),
        ...(body.expiresAt
          ? { expire_date: Math.floor(new Date(body.expiresAt).getTime() / 1_000) }
          : {}),
        ...(body.maxConversions ? { member_limit: Math.min(body.maxConversions, 99_999) } : {}),
      });
      actionUrl = invite.invite_link;
    }
    if (!actionUrl) throw new DataApiError('ACTION_URL_REQUIRED', 'Action URL required', 400);
    const result = await dataApi.execute<{ id: string }>('admin.postingRequirements.create', {
      adminUserId: session.userId,
      type: body.type,
      title: body.title,
      ...(body.targetChatId ? { targetChatId: body.targetChatId } : {}),
      ...(body.username ? { username: body.username.replace(/^@/, '') } : {}),
      actionUrl,
      ...(botVerificationSecretHash ? { botVerificationSecretHash } : {}),
      ...(body.expiresAt ? { expiresAt: body.expiresAt } : {}),
      ...(body.maxConversions ? { maxConversions: body.maxConversions } : {}),
    });
    return {
      ...result,
      ...(integrationSecret
        ? {
            integrationSecret,
            callbackUrl: `${env.PUBLIC_BASE_URL}/api/integrations/required-bots/${result.id}/verify`,
          }
        : {}),
    };
  });
  app.put('/api/admin/posting-requirements/:requirementId', async (request) => {
    const session = await requireAdmin(request, true);
    const { requirementId } = z.object({ requirementId: z.string().uuid() }).parse(request.params);
    const { isActive } = z.object({ isActive: z.boolean() }).parse(request.body);
    return dataApi.execute('admin.postingRequirements.update', {
      adminUserId: session.userId,
      requirementId,
      isActive,
    });
  });
  app.post('/api/integrations/required-bots/:requirementId/verify', async (request) => {
    const { requirementId } = z.object({ requirementId: z.string().uuid() }).parse(request.params);
    const body = z
      .object({
        telegramUserId: z.number().int().positive(),
        secret: z.string().min(32).max(256),
      })
      .parse(request.body);
    return dataApi.execute('posting.requirements.botVerify', {
      telegramUserId: body.telegramUserId,
      requirementId,
      secretHash: await sha256(body.secret),
    });
  });
  app.get('/api/admin/referrals', async (request) => {
    const session = await requireAdmin(request);
    const query = z
      .object({
        status: z.enum(['pending', 'qualified', 'rejected', 'all']).default('all'),
        limit: z.coerce.number().int().min(1).max(100).default(50),
      })
      .parse(request.query);
    return dataApi.execute('admin.referrals.list', {
      adminUserId: session.userId,
      ...query,
    });
  });
  app.post('/api/admin/referrals/:referralId/review', async (request) => {
    const session = await requireAdmin(request, true);
    const params = z.object({ referralId: z.string().uuid() }).parse(request.params);
    const body = z
      .object({
        action: z.enum(['confirm', 'reject', 'revoke']),
        reason: z.string().min(3).max(1_000),
      })
      .parse(request.body);
    return dataApi.execute('admin.referral.review', {
      adminUserId: session.userId,
      referralId: params.referralId,
      ...body,
    });
  });
  app.get('/api/admin/broadcasts', async (request) => {
    const session = await requireAdmin(request);
    const query = z
      .object({ limit: z.coerce.number().int().min(1).max(100).default(50) })
      .parse(request.query);
    return dataApi.execute('admin.broadcasts.list', {
      adminUserId: session.userId,
      limit: query.limit,
    });
  });
  app.post('/api/admin/broadcasts', async (request) => {
    const session = await requireAdmin(request, true);
    const body = z
      .object({
        title: z.string().min(3).max(120),
        message: z.string().min(3).max(4_000),
        segment: z.enum(['all', 'active', 'premium', 'nonpremium']),
        rateLimitPerSecond: z.number().int().min(1).max(30),
        buttonText: z.string().min(1).max(64).optional(),
        buttonUrl: z.string().url().max(512).optional(),
      })
      .parse(request.body);
    return dataApi.execute('admin.broadcasts.create', {
      adminUserId: session.userId,
      ...body,
    });
  });
  app.post('/api/admin/broadcasts/:broadcastId/dry-run', async (request) => {
    const session = await requireAdmin(request, true);
    const params = z.object({ broadcastId: z.string().uuid() }).parse(request.params);
    return dataApi.execute('admin.broadcasts.dryRun', {
      adminUserId: session.userId,
      broadcastId: params.broadcastId,
    });
  });
  app.post('/api/admin/broadcasts/:broadcastId/control', async (request) => {
    const session = await requireAdmin(request, true);
    const params = z.object({ broadcastId: z.string().uuid() }).parse(request.params);
    const body = z
      .object({
        action: z.enum(['queue', 'pause', 'cancel']),
        confirmationPhrase: z.string().max(128).default(''),
      })
      .parse(request.body);
    return dataApi.execute('admin.broadcasts.control', {
      adminUserId: session.userId,
      broadcastId: params.broadcastId,
      ...body,
    });
  });
  app.get('/api/admin/group-campaigns/settings', async (request) => {
    const session = await requireAdmin(request);
    return dataApi.execute('admin.groupCampaigns.settings.get', {
      adminUserId: session.userId,
    });
  });
  app.put('/api/admin/group-campaigns/settings', async (request) => {
    const session = await requireAdmin(request, true);
    const body = z
      .object({ intervalMinutes: z.number().int().min(1).max(1_440) })
      .parse(request.body);
    return dataApi.execute('admin.groupCampaigns.settings.update', {
      adminUserId: session.userId,
      intervalMinutes: body.intervalMinutes,
    });
  });
  app.get('/api/admin/system', async (request) => {
    const session = await requireAdmin(request);
    const system = await dataApi.execute<Record<string, unknown>>('admin.system.status', {
      adminUserId: session.userId,
    });
    return {
      ...system,
      api: 'ok',
      version: '0.1.0',
      commitSha: env.COMMIT_SHA,
      environment: env.DEPLOYMENT_ENV,
      uptimeSeconds: Math.floor(process.uptime()),
      runtime: {
        provider: env.DEPLOYMENT_ENV === 'production' ? 'cloudflare-workers' : 'node',
        service: process.env.CLOUDFLARE_WORKER_NAME ?? null,
      },
    };
  });
  app.post('/api/admin/users/:userId/moderate', async (request) => {
    const session = await requireModerationAccess(request, true);
    const params = z.object({ userId: z.string().uuid() }).parse(request.params);
    const body = z
      .object({
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
      })
      .parse(request.body);
    const result = await dataApi.execute<{
      updated: true;
      notifyTelegramUserId: number | null;
    }>('admin.user.moderate', {
      adminUserId: session.userId,
      targetUserId: params.userId,
      ...body,
    });
    if (body.action === 'warn' && result.notifyTelegramUserId) {
      await queueTelegramActivityNotification({
        targetUserId: params.userId,
        category: 'moderation',
        message: ru.bot.moderationWarning(body.reason),
        openPath: '/rules',
        sourceKey: `moderation-warning:${request.id}:${params.userId}`,
      });
    }
    return result;
  });
  app.post('/api/admin/profiles/:profileId/moderate', async (request) => {
    const session = await requireModerationAccess(request, true);
    const params = z.object({ profileId: z.string().uuid() }).parse(request.params);
    const body = z
      .object({
        status: z.enum(['approved', 'rejected', 'paused', 'archived']),
        reason: z.string().min(3).max(1_000),
      })
      .parse(request.body);
    const result = await dataApi.execute('admin.profile.moderate', {
      adminUserId: session.userId,
      profileId: params.profileId,
      ...body,
    });
    return result;
  });
  app.post('/api/admin/public-profiles/:profileUserId/moderate', async (request) => {
    const session = await requireModerationAccess(request, true);
    const { profileUserId } = z.object({ profileUserId: z.string().uuid() }).parse(request.params);
    const body = z
      .object({
        status: z.enum(['active', 'blocked', 'limited', 'shadow_banned']),
        reason: z.string().min(3).max(1_000),
      })
      .parse(request.body);
    return dataApi.execute('admin.publicProfile.moderate', {
      adminUserId: session.userId,
      profileUserId,
      ...body,
    });
  });
  app.put('/api/admin/users/:userId/usernames', async (request) => {
    const session = await requireAdmin(request, true);
    const { userId } = z.object({ userId: z.string().uuid() }).parse(request.params);
    const { usernames } = z
      .object({ usernames: z.array(publicProfileUsernameSchema).max(5) })
      .parse(request.body);
    return dataApi.execute('admin.profileUsernames.replace', {
      adminUserId: session.userId,
      targetUserId: userId,
      usernames,
    });
  });
  app.post('/api/admin/questionnaires/:questionnaireId/moderate', async (request) => {
    const session = await requireModerationAccess(request, true);
    const { questionnaireId } = z
      .object({ questionnaireId: z.string().uuid() })
      .parse(request.params);
    const body = z
      .object({
        status: z.enum(['approved', 'rejected', 'paused', 'archived']),
        reason: z.string().min(3).max(1_000),
      })
      .parse(request.body);
    return dataApi.execute('admin.questionnaire.moderate', {
      adminUserId: session.userId,
      questionnaireId,
      ...body,
    });
  });
  app.post('/api/admin/posts/:postId/moderate', async (request) => {
    const session = await requireModerationAccess(request, true);
    const { postId } = z.object({ postId: z.string().uuid() }).parse(request.params);
    const body = z
      .object({
        status: z.enum(['active', 'blocked']),
        reason: z.string().min(3).max(1_000),
      })
      .parse(request.body);
    return dataApi.execute('admin.post.moderate', {
      adminUserId: session.userId,
      postId,
      ...body,
    });
  });
  app.delete('/api/admin/comments/:commentId', async (request) => {
    const session = await requireModerationAccess(request, true);
    const { commentId } = z.object({ commentId: z.string().uuid() }).parse(request.params);
    const { reason } = z
      .object({ reason: z.string().trim().min(3).max(1_000) })
      .parse(request.body);
    const result = await dataApi.execute('admin.comment.delete', {
      adminUserId: session.userId,
      commentId,
      reason,
    });
    return result;
  });
  app.post('/api/admin/media/:mediaId/moderate', async (request) => {
    const session = await requireModerationAccess(request, true);
    const { mediaId } = z.object({ mediaId: z.string().uuid() }).parse(request.params);
    const body = z
      .object({
        status: z.enum(['approved', 'rejected']),
        reason: z.string().max(1_000).default(''),
      })
      .parse(request.body);
    return dataApi.execute('admin.media.moderate', {
      adminUserId: session.userId,
      mediaId,
      ...body,
    });
  });
  app.post('/api/admin/reports/:reportId/resolve', async (request) => {
    const session = await requireModerationAccess(request, true);
    const params = z.object({ reportId: z.string().uuid() }).parse(request.params);
    const body = z
      .object({
        status: z.enum(['reviewing', 'resolved', 'dismissed']),
        resolution: z.string().min(3).max(1_000),
      })
      .parse(request.body);
    const result = await dataApi.execute('admin.report.resolve', {
      adminUserId: session.userId,
      reportId: params.reportId,
      ...body,
    });
    return result;
  });
  app.post('/api/admin/users/:userId/premium/grant', async (request) => {
    const session = await requireAdmin(request, true);
    const params = z.object({ userId: z.string().uuid() }).parse(request.params);
    const body = z
      .object({
        durationDays: z.number().int().min(1).max(365),
        reason: z.string().min(3).max(1_000),
        idempotencyKey: z.string().uuid(),
      })
      .parse(request.body);
    const result = await dataApi.execute<{
      granted: true;
      grantId: string;
      durationDays: number;
      notifyTelegramUserId: number;
    }>('admin.premium.grant', {
      adminUserId: session.userId,
      targetUserId: params.userId,
      durationDays: body.durationDays,
      reason: body.reason,
      idempotencyKey: body.idempotencyKey,
    });
    await queueTelegramActivityNotification({
      targetUserId: params.userId,
      category: 'premium',
      message: ru.bot.premiumGranted(result.durationDays),
      openPath: '/premium',
      sourceKey: `premium-admin:${result.grantId}:${params.userId}`,
    });
    return result;
  });
  app.post('/api/admin/users/:userId/premium/revoke', async (request) => {
    const session = await requireAdmin(request, true);
    const params = z.object({ userId: z.string().uuid() }).parse(request.params);
    const body = z.object({ reason: z.string().min(3).max(1_000) }).parse(request.body);
    const result = await dataApi.execute('admin.premium.revoke', {
      adminUserId: session.userId,
      targetUserId: params.userId,
      reason: body.reason,
    });
    return result;
  });
  app.put('/api/admin/products/:productId', async (request) => {
    const session = await requireAdmin(request, true);
    const params = z.object({ productId: z.string().uuid() }).parse(request.params);
    const body = z
      .object({ starsAmount: z.number().int().min(1).max(10_000), isActive: z.boolean() })
      .parse(request.body);
    const result = await dataApi.execute('admin.products.update', {
      adminUserId: session.userId,
      productId: params.productId,
      ...body,
    });
    return result;
  });
  app.get('/api/admin/flags', async (request) => {
    const session = await requireAdmin(request);
    return dataApi.execute('admin.flags.list', { adminUserId: session.userId });
  });
  app.put('/api/admin/flags/:key', async (request) => {
    const session = await requireAdmin(request, true);
    const params = z.object({ key: z.string().min(1).max(64) }).parse(request.params);
    const body = z
      .object({ enabled: z.boolean(), payload: z.record(z.unknown()).default({}) })
      .parse(request.body);
    const result = await dataApi.execute('admin.flags.update', {
      adminUserId: session.userId,
      key: params.key,
      ...body,
    });
    return result;
  });
  app.get('/api/admin/config', async (request) => {
    const session = await requireAdmin(request);
    return dataApi.execute('admin.config.list', { adminUserId: session.userId });
  });
  app.put('/api/admin/config/:key', async (request) => {
    const session = await requireAdmin(request, true);
    const params = z
      .object({
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
      })
      .parse(request.params);
    const body = z.object({ value: z.string().max(4_000) }).parse(request.body);
    return dataApi.execute('admin.config.update', {
      adminUserId: session.userId,
      key: params.key,
      value: body.value,
    });
  });
  app.get('/api/admin/audit', async (request) => {
    const session = await requireAdmin(request);
    const query = z
      .object({ limit: z.coerce.number().int().min(1).max(100).default(50) })
      .parse(request.query);
    return dataApi.execute('admin.audit.list', {
      adminUserId: session.userId,
      limit: query.limit,
    });
  });
  app.post('/api/admin/payments/:orderId/refund', async (request) => {
    const session = await requireAdmin(request, true);
    const params = z.object({ orderId: z.string().uuid() }).parse(request.params);
    const order = await dataApi.execute<{
      telegram_user_id: number;
      telegram_payment_charge_id: string;
    }>('payments.getForRefund', { orderId: params.orderId });
    await stars.refundPayment({
      telegramUserId: order.telegram_user_id,
      paymentId: order.telegram_payment_charge_id,
      idempotencyKey: request.id,
    });
    await dataApi.execute('payments.markRefunded', {
      orderId: params.orderId,
      providerEventId: `admin:${request.id}`,
    });
    await writeAdminAudit(request, session.userId, 'payment.refund', params.orderId);
    return { refunded: true };
  });

  app.setErrorHandler((error, request, reply) => {
    const errorMessage = error instanceof Error ? error.message : 'UNKNOWN_ERROR';
    const invalidTelegramInitData =
      errorMessage.startsWith('Invalid initData') ||
      errorMessage === 'Expired initData' ||
      errorMessage === 'Missing initData user';
    const status =
      error instanceof DataApiError
        ? error.status
        : error instanceof z.ZodError
          ? 400
          : errorMessage === 'INVALID_JSON'
            ? 400
            : errorMessage === 'BODY_TOO_LARGE'
              ? 413
              : errorMessage === 'UNAUTHENTICATED'
                ? 401
                : invalidTelegramInitData
                  ? 401
                  : errorMessage === 'INVALID_CSRF'
                    ? 403
                    : 500;
    const code =
      error instanceof DataApiError
        ? error.code
        : error instanceof z.ZodError
          ? 'VALIDATION_ERROR'
          : errorMessage === 'INVALID_JSON' || errorMessage === 'BODY_TOO_LARGE'
            ? errorMessage
            : errorMessage === 'UNAUTHENTICATED' || errorMessage === 'INVALID_CSRF'
              ? errorMessage
              : invalidTelegramInitData
                ? 'INVALID_INIT_DATA'
                : 'INTERNAL_ERROR';
    if (status >= 500) {
      request.log.error(
        {
          errorName: error instanceof Error ? error.name : 'UnknownError',
          errorMessage,
          requestId: request.id,
        },
        'request failed',
      );
    }
    if (
      request.url.startsWith('/api/profile-media/') ||
      request.url.startsWith('/api/questionnaire-media/') ||
      request.url.startsWith('/api/post-media/')
    ) {
      reply.header('Cache-Control', 'private, no-store');
    }
    return reply.code(status).send({
      error: code,
      message:
        status >= 500
          ? ru.api.internalError
          : invalidTelegramInitData
            ? ru.miniApp.auth.invalidData
            : code === 'PREMIUM_REQUIRED' || code === 'PREMIUM_MEDIA_REQUIRED'
              ? ru.api.premiumRequired
              : code === 'LINK_POLICY_VIOLATION'
                ? ru.api.linkPolicyViolation
                : code === 'PROMO_INVALID'
                  ? ru.api.promoInvalid
                  : code === 'PROMO_ALREADY_USED'
                    ? ru.api.promoAlreadyUsed
                    : code === 'PROMO_EXHAUSTED'
                      ? ru.api.promoExhausted
                      : code === 'PROMO_PENDING_DISCOUNT'
                        ? ru.api.promoPendingDiscount
                        : code === 'PROMO_PRODUCTS_REQUIRED'
                          ? ru.api.promoProductsRequired
                          : code === 'PROMO_PRODUCT_INVALID'
                            ? ru.api.promoProductInvalid
                            : code === 'PROMO_EXPIRY_INVALID'
                              ? ru.api.promoExpiryInvalid
                              : code === 'PROMO_CODE_EXISTS'
                                ? ru.api.promoCodeExists
                                : errorMessage,
      requestId: request.id,
    });
  });

  if (serveMiniApp) {
    const currentDir = path.dirname(fileURLToPath(import.meta.url));
    const miniappRoot = path.resolve(currentDir, '../../miniapp/dist');
    await app.register(staticFiles, {
      root: miniappRoot,
      wildcard: false,
      decorateReply: false,
    });
    app.get('/*', async (_request, reply) => reply.sendFile('index.html', miniappRoot));
  }

  app.addHook('onClose', async () => {
    await bot.stop();
  });
  return app;
}
