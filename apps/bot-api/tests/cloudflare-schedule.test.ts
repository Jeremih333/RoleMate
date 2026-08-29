import { describe, expect, it } from 'vitest';

import {
  shouldDispatchBroadcasts,
  shouldDispatchGroupCampaigns,
  shouldDispatchSparseReminderCampaigns,
  shouldExpirePendingPayments,
  shouldHydrateEmojiAssets,
  shouldPollEmojiSeeds,
} from '../src/cloudflare.js';

const at = (time: string) => Date.parse(`2026-08-25T${time}Z`);

describe('Cloudflare sparse reminder schedule', () => {
  it('runs day-scale reminder campaigns once at the start of each UTC hour', () => {
    expect(shouldDispatchSparseReminderCampaigns(at('12:00:00'))).toBe(true);
    expect(shouldDispatchSparseReminderCampaigns(at('12:01:00'))).toBe(false);
    expect(shouldDispatchSparseReminderCampaigns(at('12:59:00'))).toBe(false);
    expect(shouldDispatchSparseReminderCampaigns(at('13:00:00'))).toBe(true);
  });
});

describe('spacing the per-minute scheduled work', () => {
  // The cron fires every minute, and each of these asks the data worker a
  // question whether or not there is anything to do. Left unspaced they spend
  // thousands of requests a day on an idle product.
  it('asks for emoji packs to import only twice an hour', () => {
    expect(shouldPollEmojiSeeds(at('12:00:00'))).toBe(true);
    expect(shouldPollEmojiSeeds(at('12:30:00'))).toBe(true);
    expect(shouldPollEmojiSeeds(at('12:01:00'))).toBe(false);
    expect(shouldPollEmojiSeeds(at('12:29:00'))).toBe(false);
  });

  it('caches emoji pictures every third minute', () => {
    expect(shouldHydrateEmojiAssets(at('12:00:00'))).toBe(true);
    expect(shouldHydrateEmojiAssets(at('12:03:00'))).toBe(true);
    expect(shouldHydrateEmojiAssets(at('12:01:00'))).toBe(false);
    expect(shouldHydrateEmojiAssets(at('12:02:00'))).toBe(false);
  });

  it('looks for broadcasts every other minute and group campaigns every fifth', () => {
    expect(shouldDispatchBroadcasts(at('12:00:00'))).toBe(true);
    expect(shouldDispatchBroadcasts(at('12:02:00'))).toBe(true);
    expect(shouldDispatchBroadcasts(at('12:01:00'))).toBe(false);

    expect(shouldDispatchGroupCampaigns(at('12:05:00'))).toBe(true);
    expect(shouldDispatchGroupCampaigns(at('12:10:00'))).toBe(true);
    expect(shouldDispatchGroupCampaigns(at('12:06:00'))).toBe(false);
  });

  it('keeps the existing spacing for pending payments', () => {
    expect(shouldExpirePendingPayments(at('12:10:00'))).toBe(true);
    expect(shouldExpirePendingPayments(at('12:11:00'))).toBe(false);
  });
});
