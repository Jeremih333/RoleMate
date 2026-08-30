import { Hono } from 'hono';
import { secureHeaders } from 'hono/secure-headers';
import type { ContentfulStatusCode } from 'hono/utils/http-status';
import { verifyInternalRequest, sha256 } from '@rolemate/shared';
import {
  workerEnvelopeSchema,
  type WorkerFailure,
  type WorkerSuccess,
} from '@rolemate/database-contracts';
import { ZodError } from 'zod';
import { ApiError } from './errors.js';
import { executeOperation } from './operations.js';
import type { Env, Variables } from './types.js';

const app = new Hono<{ Bindings: Env; Variables: Variables }>();

const domainIdempotentOperations = new Set([
  'telegramUpdates.claim',
  'telegramUpdates.complete',
  'telegramUpdates.release',
]);

/**
 * Suffixes that unambiguously denote a read. Replaying a read returns the same
 * data and changes nothing, so it needs no nonce — and nonce rows were the single
 * largest consumer of the D1 write budget, one row per internal call including
 * the session check that runs on every request.
 *
 * The list is deliberately conservative: misjudging a read as a mutation only
 * costs a write, while the reverse would drop replay protection.
 */
const readOnlyOperationSuffixes = [
  '.list',
  '.get',
  '.getOwn',
  '.search',
  '.availability',
  '.preview',
  '.previewOwn',
  '.status',
  '.dashboard',
];

export function requiresApiNonce(operation: string): boolean {
  if (domainIdempotentOperations.has(operation)) return false;
  return !readOnlyOperationSuffixes.some((suffix) => operation.endsWith(suffix));
}

export function shouldCleanupExpiredApiNonces(nonceHash: string): boolean {
  // Sampled cleanup: with far fewer nonce rows written, sweeping on 1/256 of
  // calls still keeps the table small.
  return nonceHash.startsWith('00');
}

app.use('*', secureHeaders());
app.use('*', async (context, next) => {
  const requestId = context.req.header('X-Request-Id') ?? crypto.randomUUID();
  context.set('requestId', requestId);
  context.header('X-Request-Id', requestId);
  await next();
});

app.get('/health/live', (context) => context.json({ status: 'ok', service: 'rolemate-data-api' }));

app.get('/health/ready', async (context) => {
  try {
    await context.env.DB.prepare('SELECT 1 AS ready').first();
    return context.json({ status: 'ready' });
  } catch {
    return context.json({ status: 'unavailable' }, 503);
  }
});

app.post('/v1/execute', async (context) => {
  const body = await context.req.text();
  if (new TextEncoder().encode(body).byteLength > 128 * 1024) {
    throw new ApiError(413, 'PAYLOAD_TOO_LARGE', 'Payload is too large');
  }
  const serviceId = context.req.header('X-Service-Id') ?? '';
  const timestamp = context.req.header('X-Request-Timestamp') ?? '';
  const nonce = context.req.header('X-Request-Nonce') ?? '';
  const signature = context.req.header('X-Request-Signature') ?? '';
  const allowed = new Set(context.env.ALLOWED_SERVICE_IDS.split(',').map((value) => value.trim()));
  if (!allowed.has(serviceId)) throw new ApiError(401, 'INVALID_SERVICE', 'Unauthorized');

  const verified = await verifyInternalRequest({
    method: context.req.method,
    path: context.req.path,
    timestamp,
    nonce,
    body,
    signature,
    secret: context.env.INTERNAL_API_SECRET,
  });
  if (!verified) throw new ApiError(401, 'INVALID_SIGNATURE', 'Unauthorized');

  const envelope = workerEnvelopeSchema.parse(JSON.parse(body));
  const nonceHash = await sha256(`${serviceId}:${nonce}`);
  if (requiresApiNonce(envelope.operation)) {
    try {
      const inserted = await context.env.DB.prepare(
        `INSERT OR IGNORE INTO api_nonces (nonce_hash, service_id, expires_at)
         VALUES (?1, ?2, datetime('now', '+2 minutes'))`,
      )
        .bind(nonceHash, serviceId)
        .run();
      if (inserted.meta.changes !== 1) {
        throw new ApiError(409, 'REPLAY_DETECTED', 'Replay detected');
      }
    } catch (error) {
      if (error instanceof ApiError) throw error;
      throw new ApiError(503, 'NONCE_STORE_UNAVAILABLE', 'Service temporarily unavailable');
    }
  }

  if (shouldCleanupExpiredApiNonces(nonceHash)) {
    context.executionCtx.waitUntil(
      context.env.DB.prepare('DELETE FROM api_nonces WHERE expires_at < CURRENT_TIMESTAMP').run(),
    );
  }
  const data = await executeOperation(
    context.env,
    envelope.operation,
    envelope.input,
    context.get('requestId'),
  );
  const response: WorkerSuccess = { ok: true, data, requestId: context.get('requestId') };
  return context.json(response);
});

app.notFound((context) => {
  const response: WorkerFailure = {
    ok: false,
    error: { code: 'NOT_FOUND', message: 'Route not found' },
    requestId: context.get('requestId') || crypto.randomUUID(),
  };
  return context.json(response, 404);
});

app.onError((error, context) => {
  const requestId = context.get('requestId') || crypto.randomUUID();
  if (!(error instanceof ApiError) && !(error instanceof ZodError)) {
    console.error(
      JSON.stringify({
        event: 'unhandled_operation_error',
        requestId,
        errorName: error instanceof Error ? error.name : 'UnknownError',
        errorMessage: error instanceof Error ? error.message : 'Unknown operation error',
      }),
    );
  }
  const status = error instanceof ApiError ? error.status : error instanceof ZodError ? 400 : 500;
  const code =
    error instanceof ApiError
      ? error.code
      : error instanceof ZodError
        ? 'VALIDATION_ERROR'
        : 'INTERNAL_ERROR';
  const message =
    error instanceof ApiError
      ? error.message
      : error instanceof ZodError
        ? 'Request validation failed'
        : 'Internal service error';
  const response: WorkerFailure = { ok: false, error: { code, message }, requestId };
  return context.json(response, status as ContentfulStatusCode);
});

export default app;
