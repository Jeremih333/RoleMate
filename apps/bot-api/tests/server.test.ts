import { webcrypto } from 'node:crypto';
import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import { ru } from '@rolemate/shared';
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

function telegramAndDataFetch(options: { duplicate?: boolean } = {}) {
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
                ? { risk_score: 0 }
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
});
