import type { Bot } from 'grammy';
import type { DataApiClient } from './d1-client.js';

const NEWS_CHANNEL_CHAT_ID = '@rolemate';

interface ReminderCandidate {
  userId: string;
  telegramUserId: number;
  kind: 'channel' | 'referral';
  reminderCount: number;
}

interface ReminderClaim {
  claimToken: string;
  candidates: ReminderCandidate[];
}

interface ChatMemberState {
  status: string;
  is_member?: boolean;
}

export function isTelegramChannelMember(member: ChatMemberState): boolean {
  if (['creator', 'administrator', 'member'].includes(member.status)) return true;
  return member.status === 'restricted' && member.is_member === true;
}

export async function dispatchEngagementReminderBatch(
  bot: Bot,
  dataApi: DataApiClient,
  onError: (error: unknown) => void = () => undefined,
): Promise<boolean> {
  try {
    const batch = await dataApi.execute<ReminderClaim | null>('notifications.engagement.claimDue', {
      limit: 20,
    });
    if (!batch) return false;

    let channelCheckAvailable = true;
    if (batch.candidates.some((candidate) => candidate.kind === 'channel')) {
      try {
        const botMember = await bot.api.getChatMember(NEWS_CHANNEL_CHAT_ID, bot.botInfo.id);
        channelCheckAvailable = ['creator', 'administrator'].includes(botMember.status);
        if (!channelCheckAvailable) {
          onError(new Error('RoleMate bot is not an administrator of @rolemate'));
        }
      } catch (error) {
        channelCheckAvailable = false;
        onError(error);
      }
    }

    for (const candidate of batch.candidates) {
      if (candidate.kind === 'referral') {
        await dataApi.execute('notifications.engagement.complete', {
          claimToken: batch.claimToken,
          userId: candidate.userId,
          outcome: 'send',
        });
        continue;
      }
      if (!channelCheckAvailable) {
        await dataApi.execute('notifications.engagement.complete', {
          claimToken: batch.claimToken,
          userId: candidate.userId,
          outcome: 'retry',
        });
        continue;
      }
      try {
        const member = await bot.api.getChatMember(NEWS_CHANNEL_CHAT_ID, candidate.telegramUserId);
        await dataApi.execute('notifications.engagement.complete', {
          claimToken: batch.claimToken,
          userId: candidate.userId,
          outcome: isTelegramChannelMember(member) ? 'subscribed' : 'send',
        });
      } catch (error) {
        onError(error);
        await dataApi.execute('notifications.engagement.complete', {
          claimToken: batch.claimToken,
          userId: candidate.userId,
          outcome: 'retry',
        });
      }
    }
    return true;
  } catch (error) {
    onError(error);
    return false;
  }
}
