import { webcrypto } from 'node:crypto';
import { beforeAll, describe, expect, it } from 'vitest';
import {
  assertAdmin,
  createInvoicePayload,
  signInternalRequest,
  validateTelegramInitData,
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

  it('authorizes only the configured owner', () => {
    expect(() => assertAdmin({ id: 1_040_929_628 })).not.toThrow();
    expect(() => assertAdmin({ id: 42 })).toThrow('Forbidden');
  });

  it('creates bounded opaque invoice payloads', () => {
    expect(createInvoicePayload('order', new Uint8Array([1, 2, 3]))).toBe('rm_order_010203');
  });
});
