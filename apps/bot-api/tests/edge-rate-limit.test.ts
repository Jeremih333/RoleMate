import { describe, expect, it } from 'vitest';
import { EdgeFastify } from '../src/edge/fastify.js';

describe('Cloudflare edge rate limiting', () => {
  it('keeps route counters isolated so normal API traffic cannot lock Telegram authentication', async () => {
    const app = new EdgeFastify();
    app.configureRateLimit({ max: 120 });
    app.get('/api/me', () => ({ ok: true }));
    app.post(
      '/api/auth/telegram',
      { config: { rateLimit: { max: 30, timeWindow: '1 minute' } } },
      () => ({ authenticated: true }),
    );
    const headers = {
      'cf-connecting-ip': '203.0.113.10',
      'content-type': 'application/json',
    };
    for (let index = 0; index < 40; index += 1) {
      const response = await app.edgeFetch(new Request('https://example.test/api/me', { headers }));
      expect(response?.status).toBe(200);
    }
    const authResponse = await app.edgeFetch(
      new Request('https://example.test/api/auth/telegram', {
        method: 'POST',
        headers,
        body: JSON.stringify({ initData: 'signed' }),
      }),
    );
    expect(authResponse?.status).toBe(200);
  });

  it('still limits repeated authentication attempts from one address', async () => {
    const app = new EdgeFastify();
    app.configureRateLimit({ max: 120 });
    app.post(
      '/api/auth/telegram',
      { config: { rateLimit: { max: 3, timeWindow: '1 minute' } } },
      () => ({ authenticated: true }),
    );
    const request = () =>
      new Request('https://example.test/api/auth/telegram', {
        method: 'POST',
        headers: {
          'cf-connecting-ip': '203.0.113.11',
          'content-type': 'application/json',
        },
        body: JSON.stringify({ initData: 'signed' }),
      });
    expect((await app.edgeFetch(request()))?.status).toBe(200);
    expect((await app.edgeFetch(request()))?.status).toBe(200);
    expect((await app.edgeFetch(request()))?.status).toBe(200);
    const limited = await app.edgeFetch(request());
    expect(limited?.status).toBe(429);
    await expect(limited?.json()).resolves.toMatchObject({ error: 'RATE_LIMITED' });
  });
});
