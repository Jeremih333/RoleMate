import { describe, expect, it } from 'vitest';

import { shouldDispatchSparseReminderCampaigns } from '../src/cloudflare.js';

describe('Cloudflare sparse reminder schedule', () => {
  it('runs day-scale reminder campaigns once at the start of each UTC hour', () => {
    expect(shouldDispatchSparseReminderCampaigns(Date.parse('2026-08-25T12:00:00Z'))).toBe(true);
    expect(shouldDispatchSparseReminderCampaigns(Date.parse('2026-08-25T12:01:00Z'))).toBe(false);
    expect(shouldDispatchSparseReminderCampaigns(Date.parse('2026-08-25T12:59:00Z'))).toBe(false);
    expect(shouldDispatchSparseReminderCampaigns(Date.parse('2026-08-25T13:00:00Z'))).toBe(true);
  });
});
