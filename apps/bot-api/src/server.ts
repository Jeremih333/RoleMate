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
  profileSchema,
  ru,
  sha256,
  validateTelegramInitData,
} from '@rolemate/shared';
import { z } from 'zod';
import { createBot } from './bot.js';
import { DataApiError, DataApiClient } from './d1-client.js';
import type { AppEnv } from './env.js';
import { assertCsrf, createSession, getSession } from './session.js';
import { TelegramStarsProvider } from './payments/telegram-stars.js';

const authBodySchema = z.object({ initData: z.string().min(1).max(8_192) });
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
  theme: z.enum(['telegram', 'light', 'dark']),
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

export async function buildServer(env: AppEnv): Promise<FastifyInstance> {
  const app = Fastify({
    logger: {
      level: env.LOG_LEVEL,
      redact: {
        paths: [
          'req.headers.authorization',
          'req.headers.cookie',
          'req.body.initData',
          'req.body.token',
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
  });
  const bot = createBot(env, dataApi);
  const stars = new TelegramStarsProvider(bot);
  let broadcastTimer: NodeJS.Timeout | undefined;
  let broadcastDispatching = false;

  await app.register(cookie, {
    secret: env.SESSION_SECRET,
    hook: 'onRequest',
  });

  app.addHook('onReady', () => {
    if (!env.TELEGRAM_BOT_TOKEN || !env.D1_WORKER_URL) return;
    broadcastTimer = setInterval(() => {
      if (broadcastDispatching) return;
      broadcastDispatching = true;
      void (async () => {
        try {
          const batch = await dataApi.execute<{
            broadcastId: string;
            jobId: string;
            message: string;
            deliveries: Array<{ deliveryId: string; telegramUserId: number }>;
          } | null>('broadcasts.claimBatch', { limit: 30 });
          if (!batch) return;
          const results = [];
          for (const delivery of batch.deliveries) {
            try {
              await bot.api.sendMessage(delivery.telegramUserId, batch.message, {
                protect_content: true,
              });
              results.push({ deliveryId: delivery.deliveryId, status: 'sent' as const });
            } catch (error) {
              const message = error instanceof Error ? error.message : 'Telegram delivery failed';
              results.push({
                deliveryId: delivery.deliveryId,
                status: 'failed' as const,
                errorCode: error instanceof Error ? error.name.slice(0, 64) : 'DELIVERY_FAILED',
                safeMessage: message.slice(0, 500),
              });
            }
          }
          await dataApi.execute('broadcasts.recordBatch', {
            broadcastId: batch.broadcastId,
            jobId: batch.jobId,
            results,
          });
        } catch (error) {
          app.log.error(
            { error: error instanceof Error ? error.message : 'unknown' },
            'broadcast dispatcher failed',
          );
        } finally {
          broadcastDispatching = false;
        }
      })();
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
  await app.register(swagger, {
    openapi: {
      info: { title: 'RoleMate API', version: '0.1.0' },
      servers: env.PUBLIC_BASE_URL ? [{ url: env.PUBLIC_BASE_URL }] : [],
    },
  });
  await app.register(swaggerUi, { routePrefix: '/internal/docs' });

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
    { config: { rateLimit: { max: 10, timeWindow: '1 minute' } } },
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

  app.get('/api/me', async (request) => {
    const session = await authenticate(request);
    return {
      userId: session.userId,
      telegramUserId: session.telegramUserId,
      role: session.role,
      isAdmin: session.telegramUserId === OWNER_TELEGRAM_ID && session.role === 'admin',
      riskScore: session.riskScore,
    };
  });

  app.get('/api/profile', async (request) => {
    const session = await authenticate(request);
    return dataApi.execute('profiles.getOwn', { userId: session.userId });
  });
  app.put('/api/profile', async (request) => {
    const session = await mutateSafe(request);
    const profile = profileSchema.parse(request.body);
    return dataApi.execute('profiles.upsert', { userId: session.userId, profile });
  });
  app.get('/api/search', async (request) => {
    const session = await authenticate(request);
    const query = z
      .object({ limit: z.coerce.number().int().min(1).max(50).default(20) })
      .parse(request.query);
    return dataApi.execute('search.list', { userId: session.userId, limit: query.limit });
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
  app.get('/api/conversations', async (request) => {
    const session = await authenticate(request);
    return dataApi.execute('conversations.list', { userId: session.userId, limit: 50 });
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
  app.get('/api/products', async () => dataApi.execute('products.list', { activeOnly: true }));
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
  app.delete('/api/account', async (request) => {
    const session = await mutate(request);
    deleteBodySchema.parse(request.body);
    await dataApi.execute('users.delete', { userId: session.userId });
    return { deleted: true };
  });
  app.get('/api/admin/dashboard', async (request) => {
    const session = await requireAdmin(request);
    return dataApi.execute('admin.dashboard', { adminUserId: session.userId });
  });
  app.get('/api/admin/users', async (request) => {
    const session = await requireAdmin(request);
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
    const session = await requireAdmin(request);
    const query = z
      .object({
        status: z
          .enum(['draft', 'pending', 'approved', 'rejected', 'paused', 'archived', 'all'])
          .default('pending'),
        limit: z.coerce.number().int().min(1).max(100).default(50),
      })
      .parse(request.query);
    return dataApi.execute('admin.profiles.list', {
      adminUserId: session.userId,
      status: query.status,
      limit: query.limit,
    });
  });
  app.get('/api/admin/reports', async (request) => {
    const session = await requireAdmin(request);
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
      northflank: {
        service: process.env.NORTHFLANK_SERVICE_NAME ?? null,
        project: process.env.NORTHFLANK_PROJECT_NAME ?? null,
      },
    };
  });
  app.post('/api/admin/users/:userId/moderate', async (request) => {
    const session = await requireAdmin(request, true);
    const params = z.object({ userId: z.string().uuid() }).parse(request.params);
    const body = z
      .object({
        action: z.enum(['warn', 'temporary_ban', 'permanent_ban', 'unban', 'disable_profile']),
        reason: z.string().min(3).max(1_000),
        bannedUntil: z.string().datetime().optional(),
      })
      .parse(request.body);
    const result = await dataApi.execute('admin.user.moderate', {
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
    return result;
  });
  app.post('/api/admin/profiles/:profileId/moderate', async (request) => {
    const session = await requireAdmin(request, true);
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
  app.post('/api/admin/reports/:reportId/resolve', async (request) => {
    const session = await requireAdmin(request, true);
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
    const result = await dataApi.execute('admin.premium.grant', {
      adminUserId: session.userId,
      targetUserId: params.userId,
      durationDays: body.durationDays,
      reason: body.reason,
      idempotencyKey: request.id,
    });
    await writeAdminAudit(request, session.userId, 'premium.grant', body.reason, params.userId);
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
    const status =
      error instanceof DataApiError
        ? error.status
        : error instanceof z.ZodError
          ? 400
          : errorMessage === 'UNAUTHENTICATED'
            ? 401
            : errorMessage === 'INVALID_CSRF'
              ? 403
              : 500;
    const code =
      error instanceof DataApiError
        ? error.code
        : error instanceof z.ZodError
          ? 'VALIDATION_ERROR'
          : errorMessage === 'UNAUTHENTICATED' || errorMessage === 'INVALID_CSRF'
            ? errorMessage
            : 'INTERNAL_ERROR';
    if (status >= 500) request.log.error({ err: error, requestId: request.id }, 'request failed');
    return reply.code(status).send({
      error: code,
      message: status >= 500 ? ru.api.internalError : errorMessage,
      requestId: request.id,
    });
  });

  const currentDir = path.dirname(fileURLToPath(import.meta.url));
  const miniappRoot = path.resolve(currentDir, '../../miniapp/dist');
  await app.register(staticFiles, {
    root: miniappRoot,
    wildcard: false,
    decorateReply: false,
  });
  app.get('/*', async (_request, reply) => reply.sendFile('index.html', miniappRoot));

  app.addHook('onClose', async () => {
    await bot.stop();
  });
  return app;
}
