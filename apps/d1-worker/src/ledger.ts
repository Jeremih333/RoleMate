import { ApiError } from './errors.js';
import { GENESIS_HASH, hashMint, hashTransfer, rollAttribute } from './gifts.js';
import type { Env } from './types.js';

/**
 * Moves stars on a balance and writes why.
 *
 * The balance and its ledger move together in one batch: the row cannot go
 * below zero — the database refuses it rather than the code that spends —
 * and if it would, the ledger entry does not happen either. Each entry is
 * signed over the one before it, so the balance can be recomputed from its
 * history and checked against what is stored.
 */
export async function creditStars(
  env: Env,
  input: { userId: string; delta: number; reason: string; refId: string | null },
): Promise<void> {
  const last = await env.DB.prepare(
    'SELECT hash FROM star_ledger WHERE user_id = ?1 ORDER BY rowid DESC LIMIT 1',
  )
    .bind(input.userId)
    .first<{ hash: string }>();
  const createdAt = new Date().toISOString().slice(0, 19).replace('T', ' ');
  const prevHash = last?.hash ?? GENESIS_HASH;
  const hash = await hashTransfer(
    env,
    {
      itemId: input.refId ?? '',
      fromUserId: input.userId,
      toUserId: String(input.delta),
      reason: `stars:${input.reason}`,
      starAmount: Math.abs(input.delta),
      createdAt,
    },
    prevHash,
  );
  try {
    await env.DB.batch([
      // Two plain statements rather than one upsert with arithmetic in it: the
      // row is made sure of first, then moved, so there is no branch in which
      // the delta is written as the balance itself.
      env.DB.prepare('INSERT OR IGNORE INTO star_balances (user_id, balance) VALUES (?1, 0)').bind(
        input.userId,
      ),
      env.DB.prepare(
        `UPDATE star_balances SET balance = balance + ?2, updated_at = CURRENT_TIMESTAMP
         WHERE user_id = ?1`,
      ).bind(input.userId, input.delta),
      env.DB.prepare(
        `INSERT INTO star_ledger (id, user_id, delta, reason, ref_id, created_at, prev_hash, hash)
         VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8)`,
      ).bind(
        crypto.randomUUID(),
        input.userId,
        input.delta,
        input.reason,
        input.refId,
        createdAt,
        prevHash,
        hash,
      ),
    ]);
  } catch (error) {
    // The only rule this batch can break is the balance floor.
    if (input.delta < 0) {
      throw new ApiError(402, 'STAR_BALANCE_TOO_LOW', 'Not enough stars on the balance');
    }
    throw error;
  }
}

/**
 * Hands a gift to somebody, writing the move into the chain rather than
 * replacing what was there. Shared by every path that moves one — a plain gift,
 * an accepted offer, a purchase — so provenance is never bypassed.
 */
export async function moveGift(
  env: Env,
  input: {
    itemId: string;
    fromUserId: string;
    toUserId: string;
    reason: string;
    starAmount: number;
  },
): Promise<{ hash: string }> {
  const last = await env.DB.prepare(
    'SELECT hash FROM gift_transfers WHERE item_id = ?1 ORDER BY rowid DESC LIMIT 1',
  )
    .bind(input.itemId)
    .first<{ hash: string }>();
  const createdAt = new Date().toISOString().slice(0, 19).replace('T', ' ');
  const prevHash = last?.hash ?? GENESIS_HASH;
  const hash = await hashTransfer(env, { ...input, createdAt }, prevHash);
  await env.DB.batch([
    env.DB.prepare(
      `UPDATE gift_items
       SET owner_user_id = ?2, pinned_order = NULL, user_collection_id = NULL
       WHERE id = ?1`,
    ).bind(input.itemId, input.toUserId),
    env.DB.prepare(
      `INSERT INTO gift_transfers
         (id, item_id, from_user_id, to_user_id, reason, star_amount, created_at, prev_hash, hash)
       VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9)`,
    ).bind(
      crypto.randomUUID(),
      input.itemId,
      input.fromUserId,
      input.toUserId,
      input.reason,
      input.starAmount,
      createdAt,
      prevHash,
      hash,
    ),
    env.DB.prepare(
      "UPDATE gift_listings SET status = 'cancelled' WHERE item_id = ?1 AND status = 'active'",
    ).bind(input.itemId),
  ]);
  return { hash };
}

/**
 * Issues one copy of a series to somebody.
 *
 * Shared by every path that brings a copy into existence — the owner minting a
 * collectible, somebody taking a standard gift for stars — so a copy is never
 * created outside the ledger. Its number follows the last one issued, its
 * attributes are rolled by rarity, and the record is signed over the one before
 * it. The circulation is checked here and again by the database, which is what
 * makes a limited series limited.
 */
export async function issueGift(
  env: Env,
  input: { seriesId: string; ownerUserId: string; totalSupply?: number | null },
): Promise<{ itemId: string; serial: number; hash: string }> {
  const last = await env.DB.prepare(
    'SELECT serial, hash FROM gift_items WHERE series_id = ?1 ORDER BY serial DESC LIMIT 1',
  )
    .bind(input.seriesId)
    .first<{ serial: number; hash: string }>();
  const serial = Number(last?.serial ?? 0) + 1;
  if (input.totalSupply !== null && input.totalSupply !== undefined && serial > input.totalSupply) {
    throw new ApiError(409, 'GIFT_SERIES_EXHAUSTED', 'The whole issue has been given out');
  }
  const pools = (
    await env.DB.prepare(
      'SELECT id, kind, rarity_permille FROM gift_attributes ORDER BY kind, sort_order',
    ).all<{ id: string; kind: string; rarity_permille: number }>()
  ).results;
  const pick = (kind: string) =>
    rollAttribute(
      pools.filter((item) => item.kind === kind),
      Math.random(),
    );
  const model = pick('model');
  const pattern = pick('pattern');
  const backdrop = pick('backdrop');
  const mintedAt = new Date().toISOString().slice(0, 19).replace('T', ' ');
  const prevHash = last?.hash ?? GENESIS_HASH;
  const hash = await hashMint(
    env,
    {
      seriesId: input.seriesId,
      serial,
      modelId: model?.id ?? '',
      patternId: pattern?.id ?? '',
      backdropId: backdrop?.id ?? '',
      mintedAt,
    },
    prevHash,
  );
  const itemId = crypto.randomUUID();
  const transferHash = await hashTransfer(
    env,
    {
      itemId,
      fromUserId: null,
      toUserId: input.ownerUserId,
      reason: 'mint',
      starAmount: 0,
      createdAt: mintedAt,
    },
    hash,
  );
  await env.DB.batch([
    env.DB.prepare(
      `INSERT INTO gift_items
         (id, series_id, serial, model_id, pattern_id, backdrop_id, owner_user_id,
          minted_at, prev_hash, hash)
       VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10)`,
    ).bind(
      itemId,
      input.seriesId,
      serial,
      model?.id ?? null,
      pattern?.id ?? null,
      backdrop?.id ?? null,
      input.ownerUserId,
      mintedAt,
      prevHash,
      hash,
    ),
    env.DB.prepare(
      `INSERT INTO gift_transfers
         (id, item_id, from_user_id, to_user_id, reason, star_amount, created_at, prev_hash, hash)
       VALUES (?1, ?2, NULL, ?3, 'mint', 0, ?4, ?5, ?6)`,
    ).bind(crypto.randomUUID(), itemId, input.ownerUserId, mintedAt, hash, transferHash),
  ]);
  return { itemId, serial, hash };
}
