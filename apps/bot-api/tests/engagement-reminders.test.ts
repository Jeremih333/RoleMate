import type { Bot } from 'grammy';
import { describe, expect, it, vi } from 'vitest';
import type { DataApiClient } from '../src/d1-client.js';
import {
  dispatchEngagementReminderBatch,
  isTelegramChannelMember,
} from '../src/engagement-reminders.js';

describe('engagement reminder dispatcher', () => {
  it('recognizes every subscribed Telegram member status', () => {
    expect(isTelegramChannelMember({ status: 'creator' })).toBe(true);
    expect(isTelegramChannelMember({ status: 'administrator' })).toBe(true);
    expect(isTelegramChannelMember({ status: 'member' })).toBe(true);
    expect(isTelegramChannelMember({ status: 'restricted', is_member: true })).toBe(true);
    expect(isTelegramChannelMember({ status: 'restricted', is_member: false })).toBe(false);
    expect(isTelegramChannelMember({ status: 'left' })).toBe(false);
    expect(isTelegramChannelMember({ status: 'kicked' })).toBe(false);
  });

  it('checks channel membership and sends referral reminders without a Telegram lookup', async () => {
    const claimToken = '00000000-0000-4000-8000-000000000901';
    const subscribedId = '00000000-0000-4000-8000-000000000902';
    const missingId = '00000000-0000-4000-8000-000000000903';
    const referralId = '00000000-0000-4000-8000-000000000904';
    const getChatMember = vi
      .fn()
      .mockResolvedValueOnce({ status: 'administrator' })
      .mockResolvedValueOnce({ status: 'member' })
      .mockResolvedValueOnce({ status: 'left' });
    const execute = vi.fn((operation: string) =>
      Promise.resolve(
        operation === 'notifications.engagement.claimDue'
          ? {
              claimToken,
              candidates: [
                {
                  userId: subscribedId,
                  telegramUserId: 9_002,
                  kind: 'channel',
                  reminderCount: 0,
                },
                {
                  userId: missingId,
                  telegramUserId: 9_003,
                  kind: 'channel',
                  reminderCount: 0,
                },
                {
                  userId: referralId,
                  telegramUserId: 9_004,
                  kind: 'referral',
                  reminderCount: 0,
                },
              ],
            }
          : { completed: true },
      ),
    );
    const bot = {
      botInfo: { id: 8_210_973_640 },
      api: { getChatMember },
    } as unknown as Bot;
    const dataApi = { execute } as unknown as DataApiClient;

    await expect(dispatchEngagementReminderBatch(bot, dataApi)).resolves.toBe(true);
    expect(getChatMember).toHaveBeenCalledTimes(3);
    expect(execute).toHaveBeenCalledWith('notifications.engagement.complete', {
      claimToken,
      userId: subscribedId,
      outcome: 'subscribed',
    });
    expect(execute).toHaveBeenCalledWith('notifications.engagement.complete', {
      claimToken,
      userId: missingId,
      outcome: 'send',
    });
    expect(execute).toHaveBeenCalledWith('notifications.engagement.complete', {
      claimToken,
      userId: referralId,
      outcome: 'send',
    });
  });

  it('does not check users or send channel reminders until the bot is an administrator', async () => {
    const claimToken = '00000000-0000-4000-8000-000000000911';
    const channelId = '00000000-0000-4000-8000-000000000912';
    const referralId = '00000000-0000-4000-8000-000000000913';
    const getChatMember = vi.fn().mockResolvedValue({ status: 'member' });
    const execute = vi.fn((operation: string) =>
      Promise.resolve(
        operation === 'notifications.engagement.claimDue'
          ? {
              claimToken,
              candidates: [
                {
                  userId: channelId,
                  telegramUserId: 9_012,
                  kind: 'channel',
                  reminderCount: 0,
                },
                {
                  userId: referralId,
                  telegramUserId: 9_013,
                  kind: 'referral',
                  reminderCount: 0,
                },
              ],
            }
          : { completed: true },
      ),
    );
    const errors: unknown[] = [];
    const bot = {
      botInfo: { id: 8_210_973_640 },
      api: { getChatMember },
    } as unknown as Bot;

    await expect(
      dispatchEngagementReminderBatch(bot, { execute } as unknown as DataApiClient, (error) =>
        errors.push(error),
      ),
    ).resolves.toBe(true);
    expect(getChatMember).toHaveBeenCalledTimes(1);
    expect(execute).toHaveBeenCalledWith('notifications.engagement.complete', {
      claimToken,
      userId: channelId,
      outcome: 'retry',
    });
    expect(execute).toHaveBeenCalledWith('notifications.engagement.complete', {
      claimToken,
      userId: referralId,
      outcome: 'send',
    });
    expect(errors).toHaveLength(1);
  });
});
