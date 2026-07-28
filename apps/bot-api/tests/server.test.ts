import { webcrypto } from 'node:crypto';
import { beforeAll, describe, expect, it, vi } from 'vitest';
import { DataApiClient } from '../src/d1-client.js';

beforeAll(() => {
  Object.defineProperty(globalThis, 'crypto', { value: webcrypto, configurable: true });
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
