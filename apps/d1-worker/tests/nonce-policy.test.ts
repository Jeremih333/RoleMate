import { describe, expect, it } from 'vitest';

import { requiresApiNonce, shouldCleanupExpiredApiNonces } from '../src/index.js';

describe('internal API nonce policy', () => {
  it('keeps replay storage for ordinary operations', () => {
    expect(requiresApiNonce('users.upsertTelegram')).toBe(true);
    expect(requiresApiNonce('payments.create')).toBe(true);
    expect(requiresApiNonce('notifications.engagement.claimDue')).toBe(true);
  });

  it('does not duplicate writes for Telegram update operations with domain idempotency', () => {
    expect(requiresApiNonce('telegramUpdates.claim')).toBe(false);
    expect(requiresApiNonce('telegramUpdates.complete')).toBe(false);
    expect(requiresApiNonce('telegramUpdates.release')).toBe(false);
  });

  it('samples expiry cleanup instead of writing on every internal request', () => {
    expect(shouldCleanupExpiredApiNonces('00abcdef')).toBe(true);
    expect(shouldCleanupExpiredApiNonces('01abcdef')).toBe(false);
    expect(shouldCleanupExpiredApiNonces('ffabcdef')).toBe(false);
  });
});
