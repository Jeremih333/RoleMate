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

  it('skips replay storage for reads, whose replay changes nothing', () => {
    // These polling operations dominate traffic; a nonce row for each was the
    // largest single consumer of the daily D1 write allowance.
    expect(requiresApiNonce('conversations.messages.list')).toBe(false);
    expect(requiresApiNonce('conversations.list')).toBe(false);
    expect(requiresApiNonce('notifications.list')).toBe(false);
    expect(requiresApiNonce('sessions.get')).toBe(false);
    expect(requiresApiNonce('settings.get')).toBe(false);
    expect(requiresApiNonce('posts.feed.list')).toBe(false);
    expect(requiresApiNonce('search.availability')).toBe(false);
    expect(requiresApiNonce('premium.status')).toBe(false);
  });

  it('still protects anything that changes state, including lookalike names', () => {
    expect(requiresApiNonce('users.quickStartContext')).toBe(true);
    expect(requiresApiNonce('groupCampaigns.claimDue')).toBe(true);
    expect(requiresApiNonce('posts.comments.create')).toBe(true);
    expect(requiresApiNonce('conversations.messages.deleteSelected')).toBe(true);
    expect(requiresApiNonce('profiles.media.add')).toBe(true);
  });

  it('samples expiry cleanup instead of writing on every internal request', () => {
    expect(shouldCleanupExpiredApiNonces('00abcdef')).toBe(true);
    expect(shouldCleanupExpiredApiNonces('01abcdef')).toBe(false);
    expect(shouldCleanupExpiredApiNonces('ffabcdef')).toBe(false);
  });
});
