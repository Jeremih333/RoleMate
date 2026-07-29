import { createBot } from './bot.js';
import { dispatchBroadcastBatch } from './broadcast.js';
import { DataApiClient } from './d1-client.js';
import { readEnv, type AppEnv } from './env.js';
import { buildServer } from './server.js';

interface WorkerEnv {
  ASSETS: ServiceFetcher;
  DATA_API: ServiceFetcher;
  BOT_NAME: string;
  BOT_SHORT_DESCRIPTION: string;
  BOT_USERNAME: string;
  MINI_APP_URL: string;
  PUBLIC_BASE_URL: string;
  OWNER_TELEGRAM_ID: string;
  SUPPORT_URL: string;
  PROMO_CHAT_URL: string;
  TELEGRAM_BOT_TOKEN: string;
  TELEGRAM_BOT_INFO: string;
  TELEGRAM_CUSTOM_EMOJI_IDS?: string;
  TELEGRAM_WEBHOOK_SECRET: string;
  WELCOME_IMAGE_URL: string;
  D1_WORKER_URL: string;
  INTERNAL_SERVICE_ID: string;
  INTERNAL_API_SECRET: string;
  SESSION_SECRET: string;
  ALLOWED_ORIGINS: string;
  TURNSTILE_SITE_KEY?: string;
  TURNSTILE_SECRET_KEY?: string;
  TURN_KEY_ID?: string;
  TURN_KEY_SECRET?: string;
  COMMIT_SHA?: string;
  DEPLOYMENT_ENV: string;
}

interface ServiceFetcher {
  fetch(input: RequestInfo | URL, init?: RequestInit): Promise<Response>;
}

interface WorkerExecutionContext {
  waitUntil(promise: Promise<unknown>): void;
}

interface WorkerScheduledController {
  readonly scheduledTime: number;
  readonly cron: string;
  noRetry(): void;
}

interface EdgeApplication {
  edgeFetch(request: Request): Promise<Response | undefined>;
}

let serverPromise: Promise<EdgeApplication> | undefined;

function appEnv(env: WorkerEnv): AppEnv {
  return readEnv({
    NODE_ENV: 'production',
    HOST: '0.0.0.0',
    PORT: '8787',
    LOG_LEVEL: 'info',
    BOT_NAME: env.BOT_NAME,
    BOT_SHORT_DESCRIPTION: env.BOT_SHORT_DESCRIPTION,
    BOT_USERNAME: env.BOT_USERNAME,
    MINI_APP_URL: env.MINI_APP_URL,
    PUBLIC_BASE_URL: env.PUBLIC_BASE_URL,
    OWNER_TELEGRAM_ID: env.OWNER_TELEGRAM_ID,
    SUPPORT_URL: env.SUPPORT_URL,
    PROMO_CHAT_URL: env.PROMO_CHAT_URL,
    TELEGRAM_BOT_TOKEN: env.TELEGRAM_BOT_TOKEN,
    TELEGRAM_BOT_INFO: env.TELEGRAM_BOT_INFO,
    TELEGRAM_CUSTOM_EMOJI_IDS: env.TELEGRAM_CUSTOM_EMOJI_IDS ?? '{}',
    TELEGRAM_WEBHOOK_SECRET: env.TELEGRAM_WEBHOOK_SECRET,
    WELCOME_IMAGE_URL: env.WELCOME_IMAGE_URL,
    D1_WORKER_URL: env.D1_WORKER_URL,
    INTERNAL_SERVICE_ID: env.INTERNAL_SERVICE_ID,
    INTERNAL_API_SECRET: env.INTERNAL_API_SECRET,
    SESSION_SECRET: env.SESSION_SECRET,
    ALLOWED_ORIGINS: env.ALLOWED_ORIGINS,
    TURNSTILE_SITE_KEY: env.TURNSTILE_SITE_KEY ?? '',
    TURNSTILE_SECRET_KEY: env.TURNSTILE_SECRET_KEY ?? '',
    TURN_KEY_ID: env.TURN_KEY_ID ?? '',
    TURN_KEY_SECRET: env.TURN_KEY_SECRET ?? '',
    YOOKASSA_ENABLED: 'false',
    YOOKASSA_DIGITAL_PREMIUM_ENABLED: 'false',
    COMMIT_SHA: env.COMMIT_SHA ?? 'cloudflare-worker',
    DEPLOYMENT_ENV: env.DEPLOYMENT_ENV,
  });
}

function bindingFetch(binding: ServiceFetcher): typeof fetch {
  return (input: RequestInfo | URL, init?: RequestInit) => binding.fetch(input, init);
}

async function getServer(env: WorkerEnv): Promise<EdgeApplication> {
  serverPromise ??= (async () => {
    const dataApiFetch = bindingFetch(env.DATA_API);
    const app = await buildServer(appEnv(env), {
      serveMiniApp: false,
      startBroadcastDispatcher: false,
      dataApiFetch,
      telegramFetch: fetch,
      logger: false,
      apiDocs: false,
      syncBotCommands: false,
    });
    await app.ready();
    return app as unknown as EdgeApplication;
  })();
  return serverPromise;
}

async function dispatchScheduledTasks(env: WorkerEnv): Promise<void> {
  const runtime = appEnv(env);
  const dataApi = new DataApiClient({
    baseUrl: runtime.D1_WORKER_URL,
    serviceId: runtime.INTERNAL_SERVICE_ID,
    secret: runtime.INTERNAL_API_SECRET,
    fetchImpl: bindingFetch(env.DATA_API),
  });
  await dataApi.execute('payments.expirePending', {}).catch((error) => {
    console.error({
      event: 'scheduled_payment_expiry_failed',
      error: error instanceof Error ? error.message : 'unknown',
    });
  });
  await dataApi.execute('calls.expire', {}).catch((error) => {
    console.error({
      event: 'call_signals_expiry_failed',
      error: error instanceof Error ? error.message : 'unknown',
    });
  });
  const bot = createBot(runtime, dataApi, fetch, false);
  await bot.init();
  await dispatchBroadcastBatch(bot, dataApi, (error) => {
    console.error({
      event: 'scheduled_broadcast_failed',
      error: error instanceof Error ? error.message : 'unknown',
    });
  });
}

export default {
  async fetch(request: Request, env: WorkerEnv): Promise<Response> {
    const app = await getServer(env);
    const response = await app.edgeFetch(request);
    if (response) return response;
    const pathname = new URL(request.url).pathname;
    if (
      pathname.startsWith('/api/') ||
      pathname.startsWith('/telegram/') ||
      pathname.startsWith('/health/') ||
      pathname.startsWith('/internal/')
    ) {
      return Response.json({ error: 'NOT_FOUND', message: 'Not found' }, { status: 404 });
    }
    return env.ASSETS.fetch(request);
  },

  scheduled(
    _controller: WorkerScheduledController,
    env: WorkerEnv,
    context: WorkerExecutionContext,
  ): void {
    context.waitUntil(dispatchScheduledTasks(env));
  },
};
