import { z } from 'zod';
import {
  INTERNAL_REQUEST_MAX_SKEW_SECONDS,
  MINI_APP_AUTH_MAX_AGE_SECONDS,
  OWNER_TELEGRAM_ID,
} from './constants.js';
import { telegramUserSchema, type TelegramUser } from './schemas.js';

const encoder = new TextEncoder();

function bytesToHex(bytes: Uint8Array): string {
  return Array.from(bytes, (byte) => byte.toString(16).padStart(2, '0')).join('');
}

function hexToBytes(value: string): Uint8Array {
  if (!/^[a-f\d]+$/i.test(value) || value.length % 2 !== 0) return new Uint8Array();
  return new Uint8Array(value.match(/.{2}/g)?.map((byte) => Number.parseInt(byte, 16)) ?? []);
}

function constantTimeEqual(left: Uint8Array, right: Uint8Array): boolean {
  if (left.length !== right.length) return false;
  let difference = 0;
  for (let index = 0; index < left.length; index++) {
    difference |= (left[index] ?? 0) ^ (right[index] ?? 0);
  }
  return difference === 0;
}

async function hmac(key: Uint8Array, data: string): Promise<Uint8Array> {
  const keyBuffer = key.buffer.slice(
    key.byteOffset,
    key.byteOffset + key.byteLength,
  ) as ArrayBuffer;
  const cryptoKey = await crypto.subtle.importKey(
    'raw',
    keyBuffer,
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['sign'],
  );
  return new Uint8Array(await crypto.subtle.sign('HMAC', cryptoKey, encoder.encode(data)));
}

export async function sha256(value: string): Promise<string> {
  return bytesToHex(new Uint8Array(await crypto.subtle.digest('SHA-256', encoder.encode(value))));
}

export async function signInternalRequest(input: {
  method: string;
  path: string;
  timestamp: string;
  nonce: string;
  body: string;
  secret: string;
}): Promise<string> {
  const bodyHash = await sha256(input.body);
  const canonical = `${input.method.toUpperCase()}${input.path}${input.timestamp}${input.nonce}${bodyHash}`;
  return bytesToHex(await hmac(encoder.encode(input.secret), canonical));
}

export async function verifyInternalRequest(input: {
  method: string;
  path: string;
  timestamp: string;
  nonce: string;
  body: string;
  signature: string;
  secret: string;
  now?: Date;
}): Promise<boolean> {
  const timestamp = Number(input.timestamp);
  if (!Number.isSafeInteger(timestamp)) return false;
  const now = Math.floor((input.now ?? new Date()).getTime() / 1_000);
  if (Math.abs(now - timestamp) > INTERNAL_REQUEST_MAX_SKEW_SECONDS) return false;
  if (!/^[a-f\d]{64}$/i.test(input.signature) || input.nonce.length < 16) return false;
  const expected = await signInternalRequest(input);
  return constantTimeEqual(hexToBytes(expected), hexToBytes(input.signature));
}

const initDataResultSchema = z.object({
  user: telegramUserSchema,
  authDate: z.number().int().positive(),
  queryId: z.string().optional(),
});
export type ValidatedInitData = z.infer<typeof initDataResultSchema>;

export async function validateTelegramInitData(
  initData: string,
  botToken: string,
  options: { now?: Date; maxAgeSeconds?: number } = {},
): Promise<ValidatedInitData> {
  const parameters = new URLSearchParams(initData);
  const receivedHash = parameters.get('hash') ?? '';
  if (!/^[a-f\d]{64}$/i.test(receivedHash)) throw new Error('Invalid initData hash');
  parameters.delete('hash');
  parameters.delete('signature');
  const dataCheckString = [...parameters.entries()]
    .sort(([left], [right]) => left.localeCompare(right))
    .map(([key, value]) => `${key}=${value}`)
    .join('\n');
  const secret = await hmac(encoder.encode('WebAppData'), botToken);
  const expectedHash = await hmac(secret, dataCheckString);
  if (!constantTimeEqual(expectedHash, hexToBytes(receivedHash))) {
    throw new Error('Invalid initData signature');
  }

  const authDate = Number(parameters.get('auth_date'));
  const now = Math.floor((options.now ?? new Date()).getTime() / 1_000);
  const maxAge = options.maxAgeSeconds ?? MINI_APP_AUTH_MAX_AGE_SECONDS;
  if (!Number.isSafeInteger(authDate) || authDate > now + 30 || now - authDate > maxAge) {
    throw new Error('Expired initData');
  }

  const rawUser = parameters.get('user');
  if (!rawUser) throw new Error('Missing initData user');
  const user = telegramUserSchema.parse(JSON.parse(rawUser));
  return initDataResultSchema.parse({
    user,
    authDate,
    queryId: parameters.get('query_id') ?? undefined,
  });
}

export function assertAdmin(user: Pick<TelegramUser, 'id'>): void {
  if (user.id !== OWNER_TELEGRAM_ID) throw new Error('Forbidden');
}

export function createInvoicePayload(orderId: string, randomBytes: Uint8Array): string {
  const suffix = bytesToHex(randomBytes);
  const payload = `rm_${orderId}_${suffix}`;
  if (payload.length > 128) throw new Error('Invoice payload exceeds Telegram limit');
  return payload;
}

export function redactForLogs(value: Record<string, unknown>): Record<string, unknown> {
  const blocked = new Set([
    'token',
    'botToken',
    'initData',
    'text',
    'caption',
    'provider_token',
    'payload',
    'secret',
  ]);
  return Object.fromEntries(
    Object.entries(value).map(([key, item]) => [key, blocked.has(key) ? '[REDACTED]' : item]),
  );
}
