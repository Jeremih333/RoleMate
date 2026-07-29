import { webcrypto } from 'node:crypto';
import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import {
  createMenuLaunchToken,
  parseMenuLaunchPath,
  ru,
  sha256,
  verifyMenuLaunchToken,
} from '@rolemate/shared';
import { DataApiClient } from '../src/d1-client.js';
import { readEnv } from '../src/env.js';
import { buildServer } from '../src/server.js';

beforeAll(() => {
  Object.defineProperty(globalThis, 'crypto', { value: webcrypto, configurable: true });
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('DataApiClient', () => {
  it('signs operation calls without exposing the secret', async () => {
    const fetchImpl = vi.fn<typeof fetch>().mockResolvedValue(
      new Response(JSON.stringify({ ok: true, data: { status: 'ok' }, requestId: 'request' }), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      }),
    );
    const client = new DataApiClient({
      baseUrl: 'https://data.example.test',
      serviceId: 'test-service',
      secret: 'a-secure-internal-test-secret',
      fetchImpl,
    });
    await expect(client.execute('products.list', { activeOnly: true })).resolves.toEqual({
      status: 'ok',
    });
    const request = fetchImpl.mock.calls[0]?.[1];
    expect(new Headers(request?.headers).get('X-Request-Signature')).toMatch(/^[a-f\d]{64}$/);
    expect(typeof request?.body === 'string' ? request.body : '').not.toContain(
      'a-secure-internal-test-secret',
    );
  });
});

function testEnv() {
  return readEnv({
    NODE_ENV: 'test',
    LOG_LEVEL: 'silent',
    TELEGRAM_BOT_TOKEN: ['123456', 'test-token'].join(':'),
    TELEGRAM_WEBHOOK_SECRET: 'test-webhook-secret-value',
    D1_WORKER_URL: 'https://data.example.test',
    INTERNAL_API_SECRET: 'test-internal-secret-value',
    SESSION_SECRET: 'test-session-secret-value-at-least-32-characters',
    ALLOWED_ORIGINS: 'https://miniapp.example.test',
    MINI_APP_URL: 'https://miniapp.example.test',
    PUBLIC_BASE_URL: 'https://miniapp.example.test',
    WELCOME_IMAGE_PATH: 'assets/generated/does-not-exist.jpg',
  });
}

function startUpdate(updateId: number) {
  return {
    update_id: updateId,
    message: {
      message_id: updateId,
      date: 1_753_000_000,
      chat: { id: 42, type: 'private' as const, first_name: 'Тест' },
      from: {
        id: 42,
        is_bot: false,
        first_name: 'Тест',
        language_code: 'ru',
      },
      text: '/start',
      entities: [{ type: 'bot_command' as const, offset: 0, length: 6 }],
    },
  };
}

function menuUpdate(updateId: number) {
  return {
    ...startUpdate(updateId),
    message: {
      ...startUpdate(updateId).message,
      text: '/menu',
      entities: [{ type: 'bot_command' as const, offset: 0, length: 5 }],
    },
  };
}

function searchUpdate(updateId: number) {
  return {
    ...startUpdate(updateId),
    message: {
      ...startUpdate(updateId).message,
      text: '/search',
      entities: [{ type: 'bot_command' as const, offset: 0, length: 7 }],
    },
  };
}

function successfulPaymentUpdate(updateId: number) {
  return {
    update_id: updateId,
    message: {
      message_id: updateId,
      date: 1_753_000_000,
      chat: { id: 42, type: 'private' as const, first_name: 'Тест' },
      from: { id: 42, is_bot: false, first_name: 'Тест', language_code: 'ru' },
      successful_payment: {
        currency: 'XTR',
        total_amount: 75,
        invoice_payload: `order-${updateId}`,
        telegram_payment_charge_id: `telegram-charge-${updateId}`,
        provider_payment_charge_id: '',
        is_recurring: false,
        is_first_recurring: false,
      },
    },
  };
}

interface FetchOptions {
  duplicate?: boolean;
  paymentResult?: {
    duplicate: boolean;
    gifted?: boolean;
    durationDays: number;
    giftRecipientTelegramUserId?: number;
  };
  adminSession?: { csrfHash: string };
}

function telegramAndDataFetch(options: FetchOptions = {}) {
  const requests: Array<{ url: string; body: Record<string, unknown> }> = [];
  const fetchMock = vi.fn<typeof fetch>((input, init) => {
    const url = typeof input === 'string' ? input : input instanceof URL ? input.href : input.url;
    const body =
      typeof init?.body === 'string'
        ? (JSON.parse(init.body) as Record<string, unknown>)
        : ({} as Record<string, unknown>);
    requests.push({ url, body });

    if (url === 'https://data.example.test/health/ready') {
      return Promise.resolve(new Response(JSON.stringify({ status: 'ready' }), { status: 200 }));
    }
    if (url === 'https://data.example.test/v1/execute') {
      const operation = body.operation;
      const data =
        operation === 'telegramUpdates.claim'
          ? { claimed: !options.duplicate }
          : operation === 'system.runtime'
            ? { maintenanceMode: false, maintenanceText: '' }
            : operation === 'users.upsert'
              ? { userId: '00000000-0000-4000-8000-000000000042', isNew: true, role: 'user' }
              : operation === 'users.get'
                ? {
                    id: '00000000-0000-4000-8000-000000000042',
                    telegram_user_id: 42,
                    role: 'user',
                    status: 'active',
                    is_banned: 0,
                    risk_score: 0,
                  }
                : operation === 'payments.getByPayload'
                  ? { id: '00000000-0000-4000-8000-000000000700' }
                  : operation === 'payments.completeStars'
                    ? options.paymentResult
                    : operation === 'sessions.get' && options.adminSession
                      ? {
                          user_id: '00000000-0000-4000-8000-000000000001',
                          telegram_user_id: 1_040_929_628,
                          role: 'admin',
                          risk_score: 0,
                          csrf_hash: options.adminSession.csrfHash,
                        }
                      : operation === 'admin.premium.grant' && options.adminSession
                        ? {
                            granted: true,
                            grantId: '00000000-0000-4000-8000-000000000701',
                            durationDays: 14,
                            notifyTelegramUserId: 777,
                          }
                        : operation === 'admin.audit'
                          ? { written: true }
                          : operation === 'premium.status'
                            ? { premium: false }
                            : operation === 'search.list'
                              ? [
                                  {
                                    user_id: '00000000-0000-4000-8000-000000000099',
                                    display_name: 'Ночной автор',
                                    short_headline: 'Ищу сюжет',
                                    compatibility: 88,
                                  },
                                ]
                              : operation === 'conversations.resolveMiniAppRelay'
                                ? {
                                    destination_chat_id: 777,
                                    recipient_muted: 0,
                                    notify_message: 0,
                                  }
                                : operation === 'conversations.recordMiniAppMessage'
                                  ? { recorded: true }
                                  : null;
      return Promise.resolve(
        new Response(JSON.stringify({ ok: true, data, requestId: 'request' }), {
          status: 200,
          headers: { 'Content-Type': 'application/json' },
        }),
      );
    }
    if (url.endsWith('/getMe')) {
      return Promise.resolve(
        new Response(
          JSON.stringify({
            ok: true,
            result: {
              id: 123456,
              is_bot: true,
              first_name: 'RoleMate',
              username: 'r0lemate_bot',
            },
          }),
          { status: 200, headers: { 'Content-Type': 'application/json' } },
        ),
      );
    }
    if (url.endsWith('/sendMessage')) {
      return Promise.resolve(
        new Response(
          JSON.stringify({
            ok: true,
            result: {
              message_id: 900,
              date: 1_753_000_000,
              chat: { id: 42, type: 'private', first_name: 'Тест' },
              text: body.text,
            },
          }),
          { status: 200, headers: { 'Content-Type': 'application/json' } },
        ),
      );
    }
    return Promise.resolve(
      new Response(JSON.stringify({ ok: true, result: true }), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      }),
    );
  });
  return { fetchMock, requests };
}

describe('Telegram webhook integration', () => {
  it('rejects a forged webhook before claiming the update', async () => {
    const { fetchMock, requests } = telegramAndDataFetch();
    vi.stubGlobal('fetch', fetchMock);
    const app = await buildServer(testEnv());

    const response = await app.inject({
      method: 'POST',
      url: '/telegram/webhook',
      headers: { 'x-telegram-bot-api-secret-token': 'forged-secret-value' },
      payload: startUpdate(101),
    });

    expect(response.statusCode).toBe(401);
    expect(requests.some((request) => request.body.operation === 'telegramUpdates.claim')).toBe(
      false,
    );
    await app.close();
  });

  it('acknowledges a duplicate update without running the handler twice', async () => {
    const { fetchMock, requests } = telegramAndDataFetch({ duplicate: true });
    vi.stubGlobal('fetch', fetchMock);
    const app = await buildServer(testEnv());

    const response = await app.inject({
      method: 'POST',
      url: '/telegram/webhook',
      headers: { 'x-telegram-bot-api-secret-token': 'test-webhook-secret-value' },
      payload: startUpdate(102),
    });

    expect(response.statusCode, response.body).toBe(200);
    expect(response.json()).toEqual({ ok: true, duplicate: true });
    expect(requests.filter((request) => request.url.endsWith('/sendMessage'))).toHaveLength(0);
    await app.close();
  });

  it('processes /start and sends the styled welcome with functional buttons', async () => {
    const { fetchMock, requests } = telegramAndDataFetch();
    vi.stubGlobal('fetch', fetchMock);
    const app = await buildServer(testEnv());

    const response = await app.inject({
      method: 'POST',
      url: '/telegram/webhook',
      headers: { 'x-telegram-bot-api-secret-token': 'test-webhook-secret-value' },
      payload: startUpdate(103),
    });

    expect(response.statusCode, response.body).toBe(200);
    const welcome = requests.find(
      (request) => request.url.endsWith('/sendMessage') && request.body.text === ru.welcome,
    );
    expect(welcome).toBeDefined();
    expect(welcome?.body.entities).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ type: 'bold', offset: 0 }),
        expect.objectContaining({ type: 'italic' }),
      ]),
    );
    expect(welcome?.body.reply_markup).toMatchObject({
      inline_keyboard: [
        [{ callback_data: 'onboarding:start' }],
        [{ callback_data: 'help' }, { callback_data: 'rules' }],
        [{ url: 'https://t.me/odinnadsat' }, { url: 'https://t.me/rolemate' }],
      ],
    });
    await app.close();
  });

  it('puts a route-bound signed fallback into every /menu MiniApp button', async () => {
    const { fetchMock, requests } = telegramAndDataFetch();
    vi.stubGlobal('fetch', fetchMock);
    const env = testEnv();
    const app = await buildServer(env);

    const response = await app.inject({
      method: 'POST',
      url: '/telegram/webhook',
      headers: { 'x-telegram-bot-api-secret-token': 'test-webhook-secret-value' },
      payload: menuUpdate(104),
    });

    expect(response.statusCode, response.body).toBe(200);
    const menu = requests.find(
      (request) => request.url.endsWith('/sendMessage') && request.body.text === ru.bot.mainMenu,
    );
    const rows = (
      menu?.body.reply_markup as { keyboard?: Array<Array<{ web_app?: { url: string } }>> }
    ).keyboard;
    const links = (rows ?? []).flatMap((row) =>
      row.flatMap((button) => (button.web_app ? [button.web_app.url] : [])),
    );
    expect(links).toHaveLength(9);
    expect(links.map((link) => parseMenuLaunchPath(new URL(link).pathname)?.route)).toEqual(
      expect.arrayContaining([
        '/search',
        '/profile',
        '/questionnaires',
        '/posts',
        '/matches',
        '/chats',
        '/premium',
        '/referrals',
        '/settings',
      ]),
    );
    for (const link of links) {
      const url = new URL(link);
      const launch = parseMenuLaunchPath(url.pathname);
      expect(link.length).toBeLessThan(256);
      expect(launch).toBeDefined();
      await expect(
        verifyMenuLaunchToken({
          token: launch!.token,
          route: launch!.route,
          secret: env.SESSION_SECRET,
        }),
      ).resolves.toMatchObject({ telegramUserId: 42, route: launch!.route });
    }
    await app.close();
  });

  it('offers a super-like to every user in bot search', async () => {
    const { fetchMock, requests } = telegramAndDataFetch();
    vi.stubGlobal('fetch', fetchMock);
    const app = await buildServer(testEnv());

    const response = await app.inject({
      method: 'POST',
      url: '/telegram/webhook',
      headers: { 'x-telegram-bot-api-secret-token': 'test-webhook-secret-value' },
      payload: searchUpdate(105),
    });

    expect(response.statusCode, response.body).toBe(200);
    const card = requests.find(
      (request) =>
        request.url.endsWith('/sendMessage') &&
        typeof request.body.text === 'string' &&
        request.body.text.includes('Ночной автор'),
    );
    const keyboard = card?.body.reply_markup as
      { inline_keyboard?: Array<Array<{ text?: string; callback_data?: string }>> } | undefined;
    expect(keyboard?.inline_keyboard?.flat()).toContainEqual({
      text: ru.bot.buttons.superLike,
      callback_data: 'swipe:super_like:00000000-0000-4000-8000-000000000099',
    });
    await app.close();
  });

  it('creates a session from a valid menu fallback and rejects route substitution', async () => {
    const { fetchMock } = telegramAndDataFetch();
    vi.stubGlobal('fetch', fetchMock);
    const env = testEnv();
    const app = await buildServer(env);
    const token = await createMenuLaunchToken({
      telegramUserId: 42,
      route: '/matches',
      secret: env.SESSION_SECRET,
    });

    const response = await app.inject({
      method: 'POST',
      url: '/api/auth/menu',
      payload: { token, route: '/matches' },
    });
    expect(response.statusCode, response.body).toBe(200);
    expect(response.headers['set-cookie']).toContain('rm_session=');
    const responseBody = response.json<{
      user: { telegramUserId: number; role: string };
      csrfToken: unknown;
    }>();
    expect(responseBody.user).toMatchObject({ telegramUserId: 42, role: 'user' });
    expect(typeof responseBody.csrfToken).toBe('string');

    const substituted = await app.inject({
      method: 'POST',
      url: '/api/auth/menu',
      payload: { token, route: '/profile' },
    });
    expect(substituted.statusCode).toBe(401);
    expect(substituted.json()).toMatchObject({ error: 'INVALID_MENU_LAUNCH' });
    await app.close();
  });

  it('notifies the buyer with the exact granted Premium duration after Stars payment', async () => {
    const { fetchMock, requests } = telegramAndDataFetch({
      paymentResult: { duplicate: false, durationDays: 30 },
    });
    vi.stubGlobal('fetch', fetchMock);
    const app = await buildServer(testEnv());

    const response = await app.inject({
      method: 'POST',
      url: '/telegram/webhook',
      headers: { 'x-telegram-bot-api-secret-token': 'test-webhook-secret-value' },
      payload: successfulPaymentUpdate(104),
    });

    expect(response.statusCode, response.body).toBe(200);
    expect(
      requests.find(
        (request) =>
          request.url.endsWith('/sendMessage') && request.body.text === ru.bot.premiumGranted(30),
      ),
    ).toBeDefined();
    await app.close();
  });

  it('notifies both payer and recipient after a Premium gift is really paid', async () => {
    const { fetchMock, requests } = telegramAndDataFetch({
      paymentResult: {
        duplicate: false,
        gifted: true,
        durationDays: 7,
        giftRecipientTelegramUserId: 777,
      },
    });
    vi.stubGlobal('fetch', fetchMock);
    const app = await buildServer(testEnv());

    const response = await app.inject({
      method: 'POST',
      url: '/telegram/webhook',
      headers: { 'x-telegram-bot-api-secret-token': 'test-webhook-secret-value' },
      payload: successfulPaymentUpdate(105),
    });

    expect(response.statusCode, response.body).toBe(200);
    expect(
      requests.find(
        (request) =>
          request.url.endsWith('/sendMessage') && request.body.text === ru.bot.premiumGiftPaid(7),
      ),
    ).toBeDefined();
    expect(
      requests.find(
        (request) =>
          request.url.endsWith('/sendMessage') &&
          request.body.chat_id === 777 &&
          request.body.text === ru.bot.premiumGranted(7),
      ),
    ).toBeDefined();
    await app.close();
  });
});

describe('Mini App authentication errors', () => {
  it('returns a safe retryable 401 for invalid Telegram initData', async () => {
    const { fetchMock } = telegramAndDataFetch();
    vi.stubGlobal('fetch', fetchMock);
    const app = await buildServer(testEnv());

    const response = await app.inject({
      method: 'POST',
      url: '/api/auth/telegram',
      payload: { initData: 'hash=invalid' },
    });

    expect(response.statusCode).toBe(401);
    expect(response.json()).toMatchObject({
      error: 'INVALID_INIT_DATA',
      message: ru.miniApp.auth.invalidData,
    });
    await app.close();
  });

  it('notifies a user when the owner grants Premium manually', async () => {
    const csrfToken = 'manual-grant-csrf-token';
    const { fetchMock, requests } = telegramAndDataFetch({
      adminSession: { csrfHash: await sha256(csrfToken) },
    });
    vi.stubGlobal('fetch', fetchMock);
    const app = await buildServer(testEnv());

    const response = await app.inject({
      method: 'POST',
      url: '/api/admin/users/00000000-0000-4000-8000-000000000777/premium/grant',
      headers: {
        cookie: 'rm_session=manual-grant-session-token',
        'x-csrf-token': csrfToken,
      },
      payload: { durationDays: 14, reason: 'Ручная выдача владельцем' },
    });

    expect(response.statusCode, response.body).toBe(200);
    expect(
      requests.find(
        (request) =>
          request.url.endsWith('/sendMessage') &&
          request.body.chat_id === 777 &&
          request.body.text === ru.bot.premiumGranted(14),
      ),
    ).toBeDefined();
    await app.close();
  });

  it('relays a direct MiniApp text message without persisting its contents in D1 calls', async () => {
    const csrfToken = 'direct-message-csrf-token';
    const { fetchMock, requests } = telegramAndDataFetch({
      adminSession: { csrfHash: await sha256(csrfToken) },
    });
    vi.stubGlobal('fetch', fetchMock);
    const app = await buildServer(testEnv());
    const text = 'Привет! Давай обсудим сюжет.';

    const response = await app.inject({
      method: 'POST',
      url: '/api/conversations/00000000-0000-4000-8000-000000000601/messages',
      headers: {
        cookie: 'rm_session=direct-message-session-token',
        'x-csrf-token': csrfToken,
      },
      payload: { text },
    });

    expect(response.statusCode, response.body).toBe(200);
    expect(
      requests.find(
        (request) =>
          request.url.endsWith('/sendMessage') &&
          request.body.chat_id === 777 &&
          request.body.text === text,
      ),
    ).toBeDefined();
    expect(
      requests
        .filter((request) => request.url === 'https://data.example.test/v1/execute')
        .some((request) => JSON.stringify(request.body).includes(text)),
    ).toBe(false);
    await app.close();
  });
});
