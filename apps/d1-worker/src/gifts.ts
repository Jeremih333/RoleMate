import type { Env } from './types.js';

/**
 * The ledger behind limited gifts.
 *
 * A limited series is only limited if nobody can quietly print more of it. The
 * database refuses to change a circulation or renumber an issued copy, and this
 * is the other half: every copy and every hand it passes through is signed over
 * the signature before it. Altering a record after the fact breaks the chain
 * from that point onwards, and the break is visible to anyone who walks it —
 * which is what a blockchain is for, without needing one.
 *
 * The key lives in the worker's secrets. A record can therefore be verified and
 * never forged by whoever happens to reach the database.
 */
export const GENESIS_HASH = '0'.repeat(64);

async function sign(env: Env, payload: string): Promise<string> {
  const key = await crypto.subtle.importKey(
    'raw',
    new TextEncoder().encode(env.GIFT_LEDGER_SECRET),
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['sign'],
  );
  const signature = await crypto.subtle.sign('HMAC', key, new TextEncoder().encode(payload));
  return Array.from(new Uint8Array(signature), (byte) => byte.toString(16).padStart(2, '0')).join(
    '',
  );
}

export interface MintedLink {
  seriesId: string;
  serial: number;
  modelId: string;
  patternId: string;
  backdropId: string;
  mintedAt: string;
}

export function mintPayload(link: MintedLink, prevHash: string): string {
  return [
    'mint',
    prevHash,
    link.seriesId,
    String(link.serial),
    link.modelId,
    link.patternId,
    link.backdropId,
    link.mintedAt,
  ].join('|');
}

export function transferPayload(
  input: {
    itemId: string;
    fromUserId: string | null;
    toUserId: string;
    reason: string;
    starAmount: number;
    createdAt: string;
  },
  prevHash: string,
): string {
  return [
    'transfer',
    prevHash,
    input.itemId,
    input.fromUserId ?? '',
    input.toUserId,
    input.reason,
    String(input.starAmount),
    input.createdAt,
  ].join('|');
}

export async function hashMint(env: Env, link: MintedLink, prevHash: string): Promise<string> {
  return sign(env, mintPayload(link, prevHash));
}

export async function hashTransfer(
  env: Env,
  input: {
    itemId: string;
    fromUserId: string | null;
    toUserId: string;
    reason: string;
    starAmount: number;
    createdAt: string;
  },
  prevHash: string,
): Promise<string> {
  return sign(env, transferPayload(input, prevHash));
}

/**
 * Picks an attribute the way a collectible gets one: by rarity, out of a
 * thousand. A rare backdrop is rare because it is drawn rarely, not because
 * somebody decided afterwards which copy deserved it.
 */
export function rollAttribute<T extends { id: string; rarity_permille: number }>(
  pool: readonly T[],
  roll: number,
): T | null {
  if (!pool.length) return null;
  const total = pool.reduce((sum, item) => sum + item.rarity_permille, 0);
  let cursor = Math.floor(roll * total);
  for (const item of pool) {
    cursor -= item.rarity_permille;
    if (cursor < 0) return item;
  }
  return pool[pool.length - 1] ?? null;
}
