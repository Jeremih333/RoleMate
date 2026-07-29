import path from 'node:path';
import { fileURLToPath } from 'node:url';
import Fastify, { type FastifyInstance, type FastifyRequest } from 'fastify';
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
  profileSchema,
  ru,
  sha256,
  validateTelegramInitData,
  verifyMenuLaunchToken,
} from '@rolemate/shared';
import { z } from 'zod';
import { createBot } from './bot.js';
import { DataApiError, DataApiClient } from './d1-client.js';
import type { AppEnv } from './env.js';
import { assertCsrf, createSession, getSession } from './session.js';
import { TelegramStarsProvider } from './payments/telegram-stars.js';
import { dispatchBroadcastBatch } from './broadcast.js';
import { validateUserContentLinks } from './content-policy.js';
import { InlineKeyboard, InputFile } from 'grammy';

const authBodySchema = z.object({ initData: z.string().min(1).max(8_192) });
const menuAuthBodySchema = z.object({
  token: z.string().min(80).max(1_024),
  route: menuLaunchRouteSchema,
});
const swipeBodySchema = z.object({
  targetUserId: z.string().uuid(),
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
  matchNotificationsEnabled: z.boolean(),
  messageNotificationsEnabled: z.boolean(),
  referralNotificationsEnabled: z.boolean(),
  premiumNotificationsEnabled: z.boolean(),
  privacyShieldEnabled: z.boolean(),
  showOnlineStatus: z.boolean(),
  showPremiumBadge: z.boolean(),
  hideDemographics: z.boolean().default(false),
  theme: z.enum(['telegram', 'light', 'dark']),
});
const chatMediaBodySchema = z.object({
  kind: z.enum(['photo', 'animation', 'video', 'audio', 'voice', 'video_note']),
  fileName: z.string().trim().min(1).max(180),
  mimeType: z.string().trim().min(3).max(120),
  dataBase64: z.string().min(1).max(22_500_000),
});

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
  ) =>
    dataApi.execute('admin.audit', {
      adminUserId,
      action,
      reason,
      ...(targetUserId ? { targetUserId } : {}),
      ipSignalHash: await sha256(`${env.SESSION_SECRET}:${request.ip}`),
      userAgent: String(request.headers['user-agent'] ?? '').slice(0, 512),
      requestId: request.id,
    });

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

  app.post(
    '/telegram/webhook',
    { config: { rateLimit: { max: 300, timeWindow: '1 minute' } } },
    async (request, reply) => {
      const secret = request.headers['x-telegram-bot-api-secret-token'];
      if (secret !== env.TELEGRAM_WEBHOOK_SECRET) {
        return reply.code(401).send({ ok: false });
      }
      const update = request.body as Parameters<typeof bot.handleUpdate>[0];
      const updateId = (update as { update_id?: unknown }).update_id;
      if (!Number.isInteger(updateId)) return reply.code(400).send({ ok: false });
      const claim = await dataApi.execute<{ claimed: boolean }>('telegramUpdates.claim', {
        updateId: updateId as number,
      });
      if (!claim.claimed) return reply.code(200).send({ ok: true, duplicate: true });
      try {
        await bot.handleUpdate(update);
      } catch (error) {
        await dataApi
          .execute('telegramUpdates.release', { updateId: updateId as number })
          .catch(() => undefined);
        throw error;
      }
      return reply.code(200).send({ ok: true });
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
        avatarMediaId: z.string().uuid().nullable(),
      })
      .parse(request.body);
    return dataApi.execute('publicProfiles.update', { userId: session.userId, ...body });
  });
  app.get('/api/users/:userId/profile', async (request) => {
    const session = await authenticate(request);
    const { userId } = z.object({ userId: z.string().uuid() }).parse(request.params);
    return dataApi.execute('publicProfiles.get', {
      requesterUserId: session.userId,
      profileUserId: userId,
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
  app.post('/api/questionnaires', async (request) => {
    const session = await mutateSafe(request);
    const body = z
      .object({ title: z.string().trim().min(2).max(80), profile: profileSchema })
      .parse(request.body);
    return dataApi.execute('questionnaires.create', { userId: session.userId, ...body });
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
    return dataApi.execute('questionnaires.update', {
      userId: session.userId,
      questionnaireId,
      ...body,
    });
  });
  app.put('/api/questionnaires/:questionnaireId/state', async (request) => {
    const session = await mutateSafe(request);
    const { questionnaireId } = z
      .object({ questionnaireId: z.string().uuid() })
      .parse(request.params);
    const { active } = z.object({ active: z.boolean() }).parse(request.body);
    return dataApi.execute('questionnaires.setActive', {
      userId: session.userId,
      questionnaireId,
      active,
    });
  });
  app.put('/api/questionnaires/:questionnaireId/rating', async (request) => {
    const session = await mutateSafe(request);
    const { questionnaireId } = z
      .object({ questionnaireId: z.string().uuid() })
      .parse(request.params);
    const { value } = z
      .object({ value: z.union([z.literal(-1), z.literal(1)]) })
      .parse(request.body);
    return dataApi.execute('questionnaires.rate', {
      userId: session.userId,
      questionnaireId,
      value,
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
    return dataApi.execute('profiles.upsert', { userId: session.userId, profile });
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
      .object({ mediaIds: z.array(z.string().uuid()).min(1).max(8) })
      .parse(request.body);
    return dataApi.execute('profiles.media.reorder', {
      userId: session.userId,
      mediaIds,
    });
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
    }>('profiles.media.resolve', {
      requesterUserId: session.userId,
      mediaId,
    });
    const file = await bot.api.getFile(media.telegram_file_id);
    if (!file.file_path) throw new DataApiError('MEDIA_UNAVAILABLE', ru.api.mediaUnavailable, 404);
    const telegramResponse = await fetch(
      `https://api.telegram.org/file/bot${env.TELEGRAM_BOT_TOKEN}/${file.file_path}`,
      { signal: AbortSignal.timeout(20_000) },
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
    return reply.send(Buffer.from(await telegramResponse.arrayBuffer()));
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
        limit: z.coerce.number().int().min(1).max(50).default(20),
        q: z.string().trim().max(80).default(''),
      })
      .parse(request.query);
    return dataApi.execute('search.list', {
      userId: session.userId,
      limit: query.limit,
      query: query.q,
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
  app.post('/api/search/state', async (request) => {
    const session = await mutateSafe(request);
    const body = z.object({ enabled: z.boolean() }).parse(request.body);
    return dataApi.execute('users.setSearchEnabled', {
      userId: session.userId,
      enabled: body.enabled,
    });
  });
  app.post('/api/swipes', async (request) => {
    const session = await mutateSafe(request);
    const body = swipeBodySchema.parse(request.body);
    return dataApi.execute('swipes.create', {
      userId: session.userId,
      targetUserId: body.targetUserId,
      action: body.action,
      source: 'miniapp',
      idempotencyKey: request.id,
    });
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
      await bot.api.sendMessage(
        session.telegramUserId,
        ru.bot.premiumGranted(result.premiumDays ?? 0),
      );
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
    return dataApi.execute('conversations.list', { userId: session.userId, limit: 50 });
  });
  app.post('/api/conversations/direct', async (request) => {
    const session = await mutateSafe(request);
    const { targetUserId } = z.object({ targetUserId: z.string().uuid() }).parse(request.body);
    return dataApi.execute('conversations.startDirect', {
      userId: session.userId,
      targetUserId,
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
      const { text } = z.object({ text: z.string().trim().min(1).max(4_000) }).parse(request.body);
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
        destination_chat_id: number;
        recipient_muted: number;
        notify_message: number;
      }>('conversations.resolveMiniAppRelay', {
        userId: session.userId,
        conversationId,
      });
      if (relay.notify_message) {
        await bot.api.sendMessage(relay.destination_chat_id, ru.bot.newMessageNotification, {
          protect_content: true,
          reply_markup: new InlineKeyboard().webApp(
            ru.bot.menu.chats,
            `${env.MINI_APP_URL}/chats?conversation=${encodeURIComponent(conversationId)}`,
          ),
        });
      }
      const delivered = await bot.api.sendMessage(relay.destination_chat_id, text, {
        protect_content: true,
        disable_notification: Boolean(relay.recipient_muted),
      });
      await dataApi.execute('conversations.recordMiniAppMessage', {
        userId: session.userId,
        conversationId,
        destinationMessageId: delivered.message_id,
        messageType: 'text',
      });
      return { sent: true };
    },
  );
  app.post(
    '/api/conversations/:conversationId/media',
    {
      bodyLimit: 24 * 1024 * 1024,
      config: { rateLimit: { max: 6, timeWindow: '1 minute' } },
    },
    async (request) => {
      const session = await mutateSafe(request);
      const { conversationId } = z
        .object({ conversationId: z.string().uuid() })
        .parse(request.params);
      const body = chatMediaBodySchema.parse(request.body);
      const premium = await dataApi.execute<{ premium: boolean }>('premium.status', {
        userId: session.userId,
      });
      if (body.kind !== 'photo' && !premium.premium) {
        throw new DataApiError('PREMIUM_REQUIRED', ru.api.premiumRequired, 403);
      }
      const allowedMimeTypes: Record<typeof body.kind, readonly string[]> = {
        photo: ['image/jpeg', 'image/png', 'image/webp'],
        animation: ['image/gif'],
        video: ['video/mp4', 'video/webm', 'video/quicktime'],
        audio: ['audio/mpeg', 'audio/mp4', 'audio/ogg', 'audio/webm'],
        voice: ['audio/mpeg', 'audio/mp4', 'audio/ogg', 'audio/webm'],
        video_note: ['video/mp4'],
      };
      if (!allowedMimeTypes[body.kind].includes(body.mimeType.toLowerCase())) {
        throw new DataApiError('UNSUPPORTED_CHAT_MEDIA', ru.api.unsupportedChatMedia, 400);
      }
      const bytes = Uint8Array.from(atob(body.dataBase64), (character) => character.charCodeAt(0));
      const maxBytes = body.kind === 'photo' ? 8 * 1024 * 1024 : 16 * 1024 * 1024;
      if (!bytes.byteLength || bytes.byteLength > maxBytes) {
        throw new DataApiError('CHAT_MEDIA_TOO_LARGE', ru.api.chatMediaTooLarge, 413);
      }
      const relay = await dataApi.execute<{
        destination_chat_id: number;
        recipient_muted: number;
        notify_message: number;
      }>('conversations.resolveMiniAppRelay', {
        userId: session.userId,
        conversationId,
      });
      if (relay.notify_message) {
        await bot.api.sendMessage(relay.destination_chat_id, ru.bot.newMessageNotification, {
          protect_content: true,
          reply_markup: new InlineKeyboard().webApp(
            ru.bot.menu.chats,
            `${env.MINI_APP_URL}/chats?conversation=${encodeURIComponent(conversationId)}`,
          ),
        });
      }
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
              ? body.mimeType === 'video/webm'
                ? await bot.api.sendDocument(relay.destination_chat_id, file, common)
                : await bot.api.sendVideo(relay.destination_chat_id, file, common)
              : body.kind === 'audio'
                ? body.mimeType === 'audio/webm'
                  ? await bot.api.sendDocument(relay.destination_chat_id, file, common)
                  : await bot.api.sendAudio(relay.destination_chat_id, file, common)
                : body.kind === 'voice'
                  ? body.mimeType === 'audio/webm'
                    ? await bot.api.sendDocument(relay.destination_chat_id, file, common)
                    : await bot.api.sendVoice(relay.destination_chat_id, file, common)
                  : await bot.api.sendVideoNote(relay.destination_chat_id, file, common);
      await dataApi.execute('conversations.recordMiniAppMessage', {
        userId: session.userId,
        conversationId,
        destinationMessageId: delivered.message_id,
        messageType: body.kind,
      });
      return { sent: true, messageType: body.kind };
    },
  );
  app.post('/api/conversations/:conversationId/profile-share', async (request) => {
    const session = await mutateSafe(request);
    const { conversationId } = z
      .object({ conversationId: z.string().uuid() })
      .parse(request.params);
    const relay = await dataApi.execute<{
      destination_chat_id: number;
      recipient_muted: number;
      notify_message: number;
    }>('conversations.resolveMiniAppRelay', {
      userId: session.userId,
      conversationId,
    });
    if (relay.notify_message) {
      await bot.api.sendMessage(relay.destination_chat_id, ru.bot.newMessageNotification, {
        protect_content: true,
        reply_markup: new InlineKeyboard().webApp(
          ru.bot.menu.chats,
          `${env.MINI_APP_URL}/chats?conversation=${encodeURIComponent(conversationId)}`,
        ),
      });
    }
    const profile = await dataApi.execute<{
      display_name: string;
      short_headline: string;
      about: string;
      fandoms: string;
      genres: string;
      tags: string;
    }>('profiles.getOwn', { userId: session.userId });
    const delivered = await bot.api.sendMessage(
      relay.destination_chat_id,
      ru.bot.sharedProfile(profile),
      {
        protect_content: true,
        disable_notification: Boolean(relay.recipient_muted),
      },
    );
    await dataApi.execute('conversations.recordMiniAppMessage', {
      userId: session.userId,
      conversationId,
      destinationMessageId: delivered.message_id,
      messageType: 'profile',
    });
    return { sent: true };
  });
  app.get('/api/conversations/:conversationId/calls/poll', async (request) => {
    const session = await authenticate(request);
    const { conversationId } = z
      .object({ conversationId: z.string().uuid() })
      .parse(request.params);
    const { afterSequence } = z
      .object({ afterSequence: z.coerce.number().int().nonnegative().default(0) })
      .parse(request.query);
    return dataApi.execute('calls.poll', {
      userId: session.userId,
      conversationId,
      afterSequence,
    });
  });
  app.get('/api/conversations/:conversationId/calls/turn-credentials', async (request) => {
    const session = await authenticate(request);
    const { conversationId } = z
      .object({ conversationId: z.string().uuid() })
      .parse(request.params);
    await dataApi.execute('conversations.resolveMiniAppRelay', {
      userId: session.userId,
      conversationId,
    });
    const premium = await dataApi.execute<{ premium: boolean }>('premium.status', {
      userId: session.userId,
    });
    if (!premium.premium) {
      throw new DataApiError('PREMIUM_REQUIRED', ru.api.premiumRequired, 403);
    }
    if (!env.TURN_KEY_ID || !env.TURN_KEY_SECRET) {
      throw new DataApiError('CALLS_NOT_CONFIGURED', ru.api.callsNotConfigured, 503);
    }
    const response = await fetch(
      `https://rtc.live.cloudflare.com/v1/turn/keys/${encodeURIComponent(env.TURN_KEY_ID)}/credentials/generate`,
      {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${env.TURN_KEY_SECRET}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ ttl: 3_600 }),
        signal: AbortSignal.timeout(8_000),
      },
    );
    if (!response.ok) {
      throw new DataApiError('TURN_CREDENTIALS_FAILED', ru.api.callsUnavailable, 502);
    }
    const parsed = z
      .object({
        iceServers: z.object({
          urls: z.array(z.string().min(1)),
          username: z.string().min(1),
          credential: z.string().min(1),
        }),
      })
      .parse(await response.json());
    return {
      iceServers: [
        {
          urls: parsed.iceServers.urls.filter((url) => !url.includes(':53')),
          username: parsed.iceServers.username,
          credential: parsed.iceServers.credential,
        },
      ],
      iceTransportPolicy: 'relay' as const,
    };
  });
  app.post('/api/conversations/:conversationId/calls', async (request) => {
    const session = await mutateSafe(request);
    const { conversationId } = z
      .object({ conversationId: z.string().uuid() })
      .parse(request.params);
    const { kind } = z.object({ kind: z.enum(['audio', 'video']) }).parse(request.body);
    const call = await dataApi.execute<{ id: string }>('calls.start', {
      userId: session.userId,
      conversationId,
      kind,
    });
    const relay = await dataApi.execute<{ destination_chat_id: number }>(
      'conversations.resolveMiniAppRelay',
      { userId: session.userId, conversationId },
    );
    await bot.api.sendMessage(relay.destination_chat_id, ru.bot.incomingAnonymousCall(kind), {
      protect_content: true,
      reply_markup: new InlineKeyboard().webApp(
        ru.bot.buttons.openCall,
        `${env.MINI_APP_URL}/chats?conversation=${encodeURIComponent(conversationId)}`,
      ),
    });
    return call;
  });
  app.post('/api/calls/:callId/respond', async (request) => {
    const session = await mutateSafe(request);
    const { callId } = z.object({ callId: z.string().uuid() }).parse(request.params);
    const { accept } = z.object({ accept: z.boolean() }).parse(request.body);
    return dataApi.execute('calls.respond', { userId: session.userId, callId, accept });
  });
  app.post('/api/calls/:callId/signal', async (request) => {
    const session = await mutateSafe(request);
    const { callId } = z.object({ callId: z.string().uuid() }).parse(request.params);
    const body = z
      .object({
        type: z.enum(['offer', 'answer', 'ice']),
        payload: z.string().min(2).max(64_000),
      })
      .parse(request.body);
    return dataApi.execute('calls.signal', { userId: session.userId, callId, ...body });
  });
  app.post('/api/calls/:callId/end', async (request) => {
    const session = await mutateSafe(request);
    const { callId } = z.object({ callId: z.string().uuid() }).parse(request.params);
    return dataApi.execute('calls.end', { userId: session.userId, callId });
  });
  app.get('/api/matches', async (request) => {
    const session = await authenticate(request);
    return dataApi.execute('matches.list', { userId: session.userId, limit: 50 });
  });
  app.post('/api/conversations/:conversationId/contact-reveal', async (request) => {
    const session = await mutateSafe(request);
    const params = z.object({ conversationId: z.string().uuid() }).parse(request.params);
    return dataApi.execute('conversations.requestContact', {
      userId: session.userId,
      conversationId: params.conversationId,
    });
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
  app.post('/api/conversations/:conversationId/rating', async (request) => {
    const session = await mutateSafe(request);
    const { conversationId } = z
      .object({ conversationId: z.string().uuid() })
      .parse(request.params);
    const { value } = z
      .object({ value: z.union([z.literal(-1), z.literal(1)]) })
      .parse(request.body);
    return dataApi.execute('ratings.create', {
      userId: session.userId,
      conversationId,
      value,
    });
  });
  app.get('/api/posts', async (request) => {
    const session = await authenticate(request);
    const { limit } = z
      .object({ limit: z.coerce.number().int().min(1).max(50).default(20) })
      .parse(request.query);
    return dataApi.execute('posts.feed.list', { userId: session.userId, limit });
  });
  app.get('/api/posts/:postId/comments', async (request) => {
    const session = await authenticate(request);
    const { postId } = z.object({ postId: z.string().uuid() }).parse(request.params);
    return dataApi.execute('posts.comments.list', {
      userId: session.userId,
      postId,
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
      { signal: AbortSignal.timeout(20_000) },
    );
    if (!response.ok) throw new DataApiError('MEDIA_UNAVAILABLE', ru.api.mediaUnavailable, 502);
    reply.header(
      'Content-Type',
      response.headers.get('content-type') ?? 'application/octet-stream',
    );
    reply.header('Cache-Control', 'private, max-age=300');
    return reply.send(Buffer.from(await response.arrayBuffer()));
  });
  app.post('/api/posts/:postId/comments', async (request) => {
    const session = await mutateSafe(request);
    const { postId } = z.object({ postId: z.string().uuid() }).parse(request.params);
    const { body } = z.object({ body: z.string().trim().min(1).max(1_000) }).parse(request.body);
    return dataApi.execute('posts.comments.create', {
      userId: session.userId,
      postId,
      body,
    });
  });
  app.put('/api/posts/:postId/rating', async (request) => {
    const session = await mutateSafe(request);
    const { postId } = z.object({ postId: z.string().uuid() }).parse(request.params);
    const { value } = z
      .object({ value: z.union([z.literal(-1), z.literal(1)]) })
      .parse(request.body);
    return dataApi.execute('posts.rate', { userId: session.userId, postId, value });
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
  app.post('/api/blocks', async (request) => {
    const session = await mutateSafe(request);
    const body = blockBodySchema.parse(request.body);
    return dataApi.execute('blocks.create', {
      blockerUserId: session.userId,
      blockedUserId: body.blockedUserId,
      reason: body.reason,
    });
  });
  app.post('/api/reports', async (request) => {
    const session = await mutateSafe(request);
    const body = reportBodySchema.parse(request.body);
    return dataApi.execute('reports.create', {
      reporterUserId: session.userId,
      reportedUserId: body.reportedUserId,
      ...(body.conversationId ? { conversationId: body.conversationId } : {}),
      category: body.category,
      description: body.description,
      evidenceSnapshot: [],
    });
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
    await writeAdminAudit(
      request,
      session.userId,
      `user.${body.action}`,
      body.reason,
      params.userId,
    );
    if (body.action === 'warn' && result.notifyTelegramUserId) {
      await bot.api.sendMessage(
        result.notifyTelegramUserId,
        ru.bot.moderationWarning(body.reason),
        env.MINI_APP_URL
          ? {
              reply_markup: new InlineKeyboard().webApp(
                ru.bot.buttons.rules,
                `${env.MINI_APP_URL}/rules`,
              ),
            }
          : undefined,
      );
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
    await writeAdminAudit(request, session.userId, `profile.${body.status}`, body.reason);
    return result;
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
    await writeAdminAudit(request, session.userId, `report.${body.status}`, body.resolution);
    return result;
  });
  app.post('/api/admin/users/:userId/premium/grant', async (request) => {
    const session = await requireAdmin(request, true);
    const params = z.object({ userId: z.string().uuid() }).parse(request.params);
    const body = z
      .object({
        durationDays: z.number().int().min(1).max(365),
        reason: z.string().min(3).max(1_000),
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
      idempotencyKey: request.id,
    });
    await writeAdminAudit(request, session.userId, 'premium.grant', body.reason, params.userId);
    await bot.api.sendMessage(
      result.notifyTelegramUserId,
      ru.bot.premiumGranted(result.durationDays),
      env.MINI_APP_URL
        ? {
            reply_markup: new InlineKeyboard().webApp(
              ru.bot.menu.premium,
              `${env.MINI_APP_URL}/premium`,
            ),
          }
        : undefined,
    );
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
    await writeAdminAudit(request, session.userId, 'premium.revoke', body.reason, params.userId);
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
    await writeAdminAudit(request, session.userId, 'product.update', 'admin_update');
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
    await writeAdminAudit(request, session.userId, 'feature_flag.update', params.key);
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
