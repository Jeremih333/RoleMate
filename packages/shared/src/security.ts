import { z } from 'zod';
import {
  INTERNAL_REQUEST_MAX_SKEW_SECONDS,
  MINI_APP_AUTH_MAX_AGE_SECONDS,
  OWNER_TELEGRAM_ID,
} from './constants.js';
import { telegramUserSchema, type TelegramUser } from './schemas.js';

const encoder = new TextEncoder();
const decoder = new TextDecoder();

export const menuLaunchRouteSchema = z.enum([
  '/search',
  '/profile',
  '/questionnaires',
  '/questionnaire-editor',
  '/posts',
  '/matches',
  '/chats',
  '/premium',
  '/referrals',
  '/settings',
  '/admin',
]);
export type MenuLaunchRoute = z.infer<typeof menuLaunchRouteSchema>;

const menuLaunchPayloadSchema = z.object({
  version: z.literal(1),
  telegramUserId: z.number().int().positive().safe(),
  route: menuLaunchRouteSchema,
  expiresAt: z.number().int().positive(),
  nonce: z.string().regex(/^[a-f\d]{32}$/),
});

const menuLaunchRouteCodeSchema = z.enum(['s', 'p', 'q', 'e', 'o', 'm', 'c', 'u', 'r', 't', 'a']);
type MenuLaunchRouteCode = z.infer<typeof menuLaunchRouteCodeSchema>;

const menuLaunchRouteCodes: Record<MenuLaunchRoute, MenuLaunchRouteCode> = {
  '/search': 's',
  '/profile': 'p',
  '/questionnaires': 'q',
  '/questionnaire-editor': 'e',
  '/posts': 'o',
  '/matches': 'm',
  '/chats': 'c',
  '/premium': 'u',
  '/referrals': 'r',
  '/settings': 't',
  '/admin': 'a',
};

const compactMenuLaunchPayloadSchema = z.object({
  v: z.literal(2),
  u: z.number().int().positive().safe(),
  r: menuLaunchRouteCodeSchema,
  e: z.number().int().positive(),
  n: z.string().regex(/^[a-f\d]{16}$/),
});

export function parseMenuLaunchPath(
  pathname: string,
): { route: MenuLaunchRoute; token: string } | undefined {
  const parts = pathname.split('/');
  if (parts.length !== 4 || parts[0] !== '' || parts[2] !== '_rm') return undefined;
  const route = menuLaunchRouteSchema.safeParse(`/${parts[1] ?? ''}`);
  const token = parts[3] ?? '';
  if (!route.success || !/^[A-Za-z\d_.-]{80,512}$/.test(token)) return undefined;
  return { route: route.data, token };
}

export function createMenuLaunchPath(route: MenuLaunchRoute, token: string): string {
  return `${route}/_rm/${token}`;
}

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

function bytesToBase64Url(bytes: Uint8Array): string {
  let binary = '';
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary).replaceAll('+', '-').replaceAll('/', '_').replace(/=+$/, '');
}

function base64UrlToBytes(value: string): Uint8Array {
  if (!/^[A-Za-z\d_-]+$/.test(value)) return new Uint8Array();
  const base64 = value
    .replaceAll('-', '+')
    .replaceAll('_', '/')
    .padEnd(Math.ceil(value.length / 4) * 4, '=');
  try {
    return Uint8Array.from(atob(base64), (character) => character.charCodeAt(0));
  } catch {
    return new Uint8Array();
  }
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

export async function createMenuLaunchToken(input: {
  telegramUserId: number;
  route: MenuLaunchRoute;
  secret: string;
  now?: Date;
  ttlSeconds?: number;
}): Promise<string> {
  const ttlSeconds = input.ttlSeconds ?? 30 * 24 * 60 * 60;
  if (!Number.isInteger(ttlSeconds) || ttlSeconds < 30 || ttlSeconds > 31 * 24 * 60 * 60) {
    throw new Error('Invalid menu launch TTL');
  }
  const payload = compactMenuLaunchPayloadSchema.parse({
    v: 2,
    u: input.telegramUserId,
    r: menuLaunchRouteCodes[input.route],
    e: Math.floor((input.now ?? new Date()).getTime() / 1_000) + ttlSeconds,
    n: bytesToHex(crypto.getRandomValues(new Uint8Array(8))),
  });
  const encoded = bytesToBase64Url(encoder.encode(JSON.stringify(payload)));
  const signature = bytesToHex((await hmac(encoder.encode(input.secret), encoded)).slice(0, 16));
  return `${encoded}.${signature}`;
}

export async function verifyMenuLaunchToken(input: {
  token: string;
  route: MenuLaunchRoute;
  secret: string;
  now?: Date;
}): Promise<{ telegramUserId: number; route: MenuLaunchRoute; expiresAt: number }> {
  if (input.token.length > 1_024) throw new Error('Invalid menu launch token');
  const parts = input.token.split('.');
  const encoded = parts[0] ?? '';
  const receivedSignature = parts[1] ?? '';
  if (parts.length !== 2 || !/^(?:[a-f\d]{32}|[a-f\d]{64})$/i.test(receivedSignature)) {
    throw new Error('Invalid menu launch token');
  }
  const expectedSignature = (await hmac(encoder.encode(input.secret), encoded)).slice(
    0,
    receivedSignature.length / 2,
  );
  if (!constantTimeEqual(expectedSignature, hexToBytes(receivedSignature))) {
    throw new Error('Invalid menu launch signature');
  }
  let rawPayload: unknown;
  try {
    rawPayload = JSON.parse(decoder.decode(base64UrlToBytes(encoded)));
  } catch {
    throw new Error('Invalid menu launch payload');
  }
  const now = Math.floor((input.now ?? new Date()).getTime() / 1_000);
  const compactPayload = compactMenuLaunchPayloadSchema.safeParse(rawPayload);
  if (compactPayload.success) {
    const route = menuLaunchRouteSchema.options.find(
      (candidate) => menuLaunchRouteCodes[candidate] === compactPayload.data.r,
    );
    if (route !== input.route || compactPayload.data.e < now) {
      throw new Error('Expired or mismatched menu launch token');
    }
    return {
      telegramUserId: compactPayload.data.u,
      route,
      expiresAt: compactPayload.data.e,
    };
  }
  const payload = menuLaunchPayloadSchema.parse(rawPayload);
  if (payload.route !== input.route || payload.expiresAt < now) {
    throw new Error('Expired or mismatched menu launch token');
  }
  return payload;
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
