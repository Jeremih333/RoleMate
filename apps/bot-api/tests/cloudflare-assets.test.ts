import { existsSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { withMiniAppCachePolicy, withMiniAppShellCacheBypass } from '../src/cloudflare.js';
import { EdgeFastify } from '../src/edge/fastify.js';

describe('Cloudflare MiniApp asset responses', () => {
  it('routes every SPA request through the Worker cache policy', () => {
    const wranglerConfig = readFileSync(path.resolve(process.cwd(), 'wrangler.toml'), 'utf8');

    expect(wranglerConfig).toMatch(/run_worker_first\s*=\s*true/);
  });

  it('enqueues due onboarding reminders before dispatching the Telegram outbox', () => {
    const workerSource = readFileSync(path.resolve(process.cwd(), 'src/cloudflare.ts'), 'utf8');
    const enqueueIndex = workerSource.indexOf("'notifications.onboarding.enqueueDue'");
    const dispatchIndex = workerSource.indexOf('dispatchTelegramNotificationBatch(bot');

    expect(enqueueIndex).toBeGreaterThan(-1);
    expect(dispatchIndex).toBeGreaterThan(enqueueIndex);
  });

  it('synchronizes membership updates and schedules automatic group presentations', () => {
    const workerSource = readFileSync(path.resolve(process.cwd(), 'src/cloudflare.ts'), 'utf8');
    expect(workerSource).toContain("'my_chat_member'");
    expect(workerSource).toContain('synchronizeBotCommands(bot)');
    expect(workerSource).toContain('dispatchGroupCampaignBatch(bot');
    for (const name of ['discovery', 'privacy', 'media']) {
      expect(
        existsSync(
          path.resolve(process.cwd(), `../miniapp/public/assets/group-campaign-${name}-v1.png`),
        ),
      ).toBe(true);
    }
  });

  it('prevents Telegram WebView from retaining an obsolete HTML shell', async () => {
    const response = withMiniAppCachePolicy(
      new Response('<!doctype html><title>RoleMate</title>', {
        headers: { 'Content-Type': 'text/html; charset=utf-8', ETag: 'old-shell' },
      }),
    );

    expect(response.headers.get('cache-control')).toBe(
      'no-store, no-cache, must-revalidate, max-age=0',
    );
    expect(response.headers.get('pragma')).toBe('no-cache');
    expect(response.headers.get('expires')).toBe('0');
    expect(response.headers.get('etag')).toBe('old-shell');
    await expect(response.text()).resolves.toContain('RoleMate');
  });

  it('keeps fingerprinted non-HTML assets unchanged', () => {
    const response = new Response('console.log("RoleMate")', {
      headers: { 'Content-Type': 'text/javascript', 'Cache-Control': 'public, max-age=31536000' },
    });

    expect(withMiniAppCachePolicy(response)).toBe(response);
  });

  it('bypasses the internal asset cache for SPA shells without disabling asset caching', () => {
    const pageRequest = withMiniAppShellCacheBypass(
      new Request('https://example.test/search?rmv=current'),
    );
    const assetRequest = new Request('https://example.test/assets/index-current.js');

    expect(pageRequest.headers.get('cache-control')).toBe('no-cache');
    expect(withMiniAppShellCacheBypass(assetRequest)).toBe(assetRequest);
  });

  it('preserves streamed media bytes instead of serializing the stream as JSON', async () => {
    const app = new EdgeFastify();
    app.get('/media', (_request, reply) => {
      const stream = new ReadableStream<Uint8Array>({
        start(controller) {
          controller.enqueue(new Uint8Array([0x52, 0x4d, 0x01, 0xff]));
          controller.close();
        },
      });
      return reply.header('Content-Type', 'application/octet-stream').send(stream);
    });

    const response = await app.edgeFetch(new Request('https://example.test/media'));

    expect(response?.headers.get('content-type')).toBe('application/octet-stream');
    await expect(response?.arrayBuffer()).resolves.toEqual(
      new Uint8Array([0x52, 0x4d, 0x01, 0xff]).buffer,
    );
  });
});
