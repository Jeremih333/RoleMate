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
import { OWNER_TELEGRAM_ID, profileSchema, validateTelegramInitData } from '@rolemate/shared';
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
const deleteBodySchema = z.object({ confirmation: z.literal('УДАЛИТЬ') });
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

  await app.register(cookie, {
    secret: env.SESSION_SECRET,
    hook: 'onRequest',
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
      message: 'Слишком много запросов. Попробуй немного позже.',
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
      await dataApi
        .execute('risk.record', {
          userId: session.userId,
          type: 'unauthorized_admin_access',
          scoreDelta: 15,
          metadata: { path: request.url, requestId: request.id },
        })
        .catch(() => undefined);
      throw new DataApiError('FORBIDDEN', 'Forbidden', 403);
    }
    return session;
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

  app.post(
    '/telegram/webhook',
    { config: { rateLimit: { max: 300, timeWindow: '1 minute' } } },
    async (request, reply) => {
      const secret = request.headers['x-telegram-bot-api-secret-token'];
      if (secret !== env.TELEGRAM_WEBHOOK_SECRET) {
        return reply.code(401).send({ ok: false });
      }
      const update = request.body as Parameters<typeof bot.handleUpdate>[0];
      await bot.handleUpdate(update);
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
    await dataApi.execute('admin.audit', {
      adminUserId: session.userId,
      action: 'payment.refund',
      reason: 'admin_request',
      newState: { orderId: params.orderId, status: 'refunded' },
      requestId: request.id,
    });
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
      message: status >= 500 ? 'Внутренняя ошибка сервиса' : errorMessage,
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
