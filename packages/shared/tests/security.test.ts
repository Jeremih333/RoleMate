import { webcrypto } from 'node:crypto';
import { beforeAll, describe, expect, it } from 'vitest';
import {
  assertAdmin,
  createMenuLaunchToken,
  createInvoicePayload,
  signInternalRequest,
  validateTelegramInitData,
  verifyMenuLaunchToken,
  verifyInternalRequest,
} from '../src/index.js';

beforeAll(() => {
  Object.defineProperty(globalThis, 'crypto', { value: webcrypto, configurable: true });
});

describe('security contracts', () => {
  it('signs and verifies internal requests and rejects stale requests', async () => {
    const input = {
      method: 'POST',
      path: '/v1/users/upsert',
      timestamp: '1767225600',
      nonce: '0123456789abcdef',
      body: '{"ok":true}',
      secret: 'test-secret-that-is-long-enough',
    };
    const signature = await signInternalRequest(input);
    await expect(
      verifyInternalRequest({
        ...input,
        signature,
        now: new Date('2026-01-01T00:00:00Z'),
      }),
    ).resolves.toBe(true);
    await expect(
      verifyInternalRequest({
        ...input,
        signature,
        now: new Date('2026-01-01T00:02:00Z'),
      }),
    ).resolves.toBe(false);
  });

  it('binds a short-lived menu launch token to Telegram identity and route', async () => {
    const secret = 'menu-session-secret-that-is-at-least-32-characters';
    const now = new Date('2026-07-29T16:00:00Z');
    const token = await createMenuLaunchToken({
      telegramUserId: 42,
      route: '/matches',
      secret,
      now,
      ttlSeconds: 60,
    });
    await expect(
      verifyMenuLaunchToken({ token, route: '/matches', secret, now }),
    ).resolves.toMatchObject({ telegramUserId: 42, route: '/matches' });
    await expect(verifyMenuLaunchToken({ token, route: '/profile', secret, now })).rejects.toThrow(
      /mismatched/i,
    );
    await expect(
      verifyMenuLaunchToken({
        token: `${token.slice(0, -1)}0`,
        route: '/matches',
        secret,
        now,
      }),
    ).rejects.toThrow(/signature/i);
    await expect(
      verifyMenuLaunchToken({
        token,
        route: '/matches',
        secret,
        now: new Date('2026-07-29T16:01:01Z'),
      }),
    ).rejects.toThrow(/expired/i);
  });

  it('validates official Telegram initData HMAC construction', async () => {
    const token = '123456:TEST_TOKEN';
    const authDate = 1_767_225_600;
    const user = JSON.stringify({ id: 42, first_name: 'Тест' });
    const check = `auth_date=${authDate}\nquery_id=test\nuser=${user}`;
    const encoder = new TextEncoder();
    const secretKey = await crypto.subtle.importKey(
      'raw',
      encoder.encode('WebAppData'),
      { name: 'HMAC', hash: 'SHA-256' },
      false,
      ['sign'],
    );
    const secret = new Uint8Array(
      await crypto.subtle.sign('HMAC', secretKey, encoder.encode(token)),
    );
    const dataKey = await crypto.subtle.importKey(
      'raw',
      secret,
      { name: 'HMAC', hash: 'SHA-256' },
      false,
      ['sign'],
    );
    const hash = Array.from(
      new Uint8Array(await crypto.subtle.sign('HMAC', dataKey, encoder.encode(check))),
      (byte) => byte.toString(16).padStart(2, '0'),
    ).join('');
    const initData = new URLSearchParams({
      query_id: 'test',
      user,
      auth_date: String(authDate),
      hash,
    }).toString();

    await expect(
      validateTelegramInitData(initData, token, {
        now: new Date('2026-01-01T00:05:00Z'),
        maxAgeSeconds: 600,
      }),
    ).resolves.toMatchObject({ user: { id: 42 } });
    await expect(
      validateTelegramInitData(`${initData}tampered`, token, {
        now: new Date('2026-01-01T00:05:00Z'),
      }),
    ).rejects.toThrow();
  });

  it('includes the modern Telegram signature field in the HMAC check string', async () => {
    const token = ['7342037359', 'AAHI25ES9xCOMPokpYoz-p8XVrZUdygo2J4'].join(':');
    const initData =
      'user=%7B%22id%22%3A279058397%2C%22first_name%22%3A%22Vladislav%20%2B%20-%20%3F%20%5C%2F%22%2C%22last_name%22%3A%22Kibenko%22%2C%22username%22%3A%22vdkfrost%22%2C%22language_code%22%3A%22ru%22%2C%22is_premium%22%3Atrue%2C%22allows_write_to_pm%22%3Atrue%2C%22photo_url%22%3A%22https%3A%5C%2F%5C%2Ft.me%5C%2Fi%5C%2Fuserpic%5C%2F320%5C%2F4FPEE4tmP3ATHa57u6MqTDih13LTOiMoKoLDRG4PnSA.svg%22%7D&chat_instance=8134722200314281151&chat_type=private&auth_date=1733509682&signature=TYJxVcisqbWjtodPepiJ6ghziUL94-KNpG8Pau-X7oNNLNBM72APCpi_RKiUlBvcqo5L-LAxIc3dnTzcZX_PDg&hash=a433d8f9847bd6addcc563bff7cc82c89e97ea0d90c11fe5729cae6796a36d73';

    await expect(
      validateTelegramInitData(initData, token, {
        now: new Date(1_733_509_682_000),
      }),
    ).resolves.toMatchObject({ user: { id: 279_058_397 } });
  });

  it('authorizes only the configured owner', () => {
    expect(() => assertAdmin({ id: 1_040_929_628 })).not.toThrow();
    expect(() => assertAdmin({ id: 42 })).toThrow('Forbidden');
  });

  it('creates bounded opaque invoice payloads', () => {
    expect(createInvoicePayload('order', new Uint8Array([1, 2, 3]))).toBe('rm_order_010203');
  });
});
