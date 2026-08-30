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

  it('does not rate-limit an authenticated Telegram webhook by Telegram infrastructure IP', async () => {
    const app = new EdgeFastify();
    app.configureRateLimit({ max: 120 });
    app.post('/telegram/webhook', { config: { rateLimit: false } }, () => ({ ok: true }));
    const request = () =>
      new Request('https://example.test/telegram/webhook', {
        method: 'POST',
        headers: {
          'cf-connecting-ip': '149.154.167.220',
          'content-type': 'application/json',
          'x-telegram-bot-api-secret-token': 'verified-by-the-route-handler',
        },
        body: JSON.stringify({ update_id: crypto.getRandomValues(new Uint32Array(1))[0] }),
      });

    for (let index = 0; index < 350; index += 1) {
      expect((await app.edgeFetch(request()))?.status).toBe(200);
    }
  });
});

describe('route options on GET', () => {
  it('accepts options like every other verb, and honours a disabled limit', async () => {
    const app = new EdgeFastify();
    app.configureRateLimit({ max: 5 });
    // Passing options to get() used to hand the options object to the router as
    // the handler, and every request to such a route answered 500.
    app.get('/api/asset/:id', { config: { rateLimit: false } }, () => ({ served: true }));
    const headers = { 'cf-connecting-ip': '203.0.113.44' };
    for (let index = 0; index < 25; index += 1) {
      const response = await app.edgeFetch(
        new Request('https://example.test/api/asset/42?thumbnail=1', { headers }),
      );
      expect(response?.status).toBe(200);
    }
  });

  it('still applies the shared limit to a GET without options', async () => {
    const app = new EdgeFastify();
    app.configureRateLimit({ max: 3 });
    app.get('/api/limited', () => ({ ok: true }));
    const headers = { 'cf-connecting-ip': '203.0.113.45' };
    const statuses: number[] = [];
    for (let index = 0; index < 5; index += 1) {
      const response = await app.edgeFetch(
        new Request('https://example.test/api/limited', { headers }),
      );
      statuses.push(response?.status ?? 0);
    }
    expect(statuses.slice(0, 3)).toEqual([200, 200, 200]);
    expect(statuses.at(-1)).toBe(429);
  });
});
