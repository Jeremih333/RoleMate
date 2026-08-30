import { randomBytes } from 'node:crypto';
import type { FastifyRequest } from 'fastify';
import { sha256 } from '@rolemate/shared';
import type { DataApiClient } from './d1-client.js';

export interface AuthenticatedSession {
  userId: string;
  telegramUserId: number;
  role: string;
  riskScore: number;
  csrfHash: string;
}

export async function createSession(
  dataApi: DataApiClient,
  userId: string,
): Promise<{ token: string; csrfToken: string; expiresAt: Date }> {
  const token = randomBytes(32).toString('base64url');
  const csrfToken = randomBytes(24).toString('base64url');
  const expiresAt = new Date(Date.now() + 15 * 60_000);
  await dataApi.execute('sessions.create', {
    userId,
    sessionHash: await sha256(token),
    csrfHash: await sha256(csrfToken),
    expiresAt: expiresAt.toISOString(),
  });
  return { token, csrfToken, expiresAt };
}

export async function refreshSession(
  request: FastifyRequest,
  dataApi: DataApiClient,
): Promise<{ token: string; csrfToken: string; expiresAt: Date }> {
  const token = request.cookies.rm_session;
  if (!token) throw new Error('UNAUTHENTICATED');
  const csrfToken = randomBytes(24).toString('base64url');
  const expiresAt = new Date(Date.now() + 15 * 60_000);
  await dataApi.execute('sessions.refresh', {
    sessionHash: await sha256(token),
    csrfHash: await sha256(csrfToken),
    expiresAt: expiresAt.toISOString(),
  });
  return { token, csrfToken, expiresAt };
}

export async function getSession(
  request: FastifyRequest,
  dataApi: DataApiClient,
): Promise<AuthenticatedSession> {
  const token = request.cookies.rm_session;
  if (!token) throw new Error('UNAUTHENTICATED');
  const row = await dataApi.execute<{
    user_id: string;
    telegram_user_id: number;
    role: string;
    risk_score: number;
    csrf_hash: string;
  }>('sessions.get', { sessionHash: await sha256(token) });
  return {
    userId: row.user_id,
    telegramUserId: row.telegram_user_id,
    role: row.role,
    riskScore: row.risk_score,
    csrfHash: row.csrf_hash,
  };
}

export async function assertCsrf(
  request: FastifyRequest,
  session: AuthenticatedSession,
): Promise<void> {
  const token = request.headers['x-csrf-token'];
  if (typeof token !== 'string' || (await sha256(token)) !== session.csrfHash) {
    throw new Error('INVALID_CSRF');
  }
}
