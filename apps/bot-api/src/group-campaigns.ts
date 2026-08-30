import { InlineKeyboard, type Bot } from 'grammy';
import { NEWS_CHANNEL_URL, ru } from '@rolemate/shared';
import type { DataApiClient } from './d1-client.js';
import type { AppEnv } from './env.js';

interface ClaimedCampaignBatch {
  claimToken: string;
  campaigns: Array<{
    chatId: number;
    chatTitle: string | null;
    chatUsername: string | null;
    lastVariantIndex: number;
  }>;
}

const campaignAssets = [
  '/assets/group-campaign-discovery-v1.png?v=20260807',
  '/assets/group-campaign-privacy-v1.png?v=20260807',
  '/assets/group-campaign-media-v1.png?v=20260807',
] as const;

function telegramErrorCode(error: unknown): number | undefined {
  if (!error || typeof error !== 'object') return undefined;
  if ('error_code' in error && typeof error.error_code === 'number') return error.error_code;
  if ('error' in error) return telegramErrorCode(error.error);
  return undefined;
}

export async function dispatchGroupCampaignBatch(
  bot: Bot,
  dataApi: DataApiClient,
  env: AppEnv,
  onError: (error: unknown) => void,
): Promise<number> {
  const batch = await dataApi.execute<ClaimedCampaignBatch | null>('groupCampaigns.claimDue', {
    limit: 10,
  });
  if (!batch) return 0;
  const username = env.BOT_USERNAME.replace(/^@/, '');
  const results: Array<{
    chatId: number;
    status: 'sent' | 'retry' | 'disabled';
    variantIndex: number;
    errorCode?: string;
  }> = [];
  for (const campaign of batch.campaigns) {
    const variantIndex = (campaign.lastVariantIndex + 1) % ru.bot.groupCampaign.captions.length;
    const imagePath = campaignAssets[variantIndex % campaignAssets.length]!;
    const keyboard = new InlineKeyboard()
      .url(ru.bot.groupCampaign.openPrivate, `https://t.me/${username}?start=community`)
      .url(ru.bot.buttons.news, NEWS_CHANNEL_URL)
      .row()
      .text(ru.bot.groupCampaign.disable, `group_campaign:disable:${campaign.chatId}`);
    try {
      await bot.api.sendPhoto(campaign.chatId, `${env.PUBLIC_BASE_URL}${imagePath}`, {
        caption: ru.bot.groupCampaign.captions[variantIndex]!,
        reply_markup: keyboard,
      });
      results.push({ chatId: campaign.chatId, status: 'sent', variantIndex });
    } catch (error: unknown) {
      onError(error);
      const code = telegramErrorCode(error);
      results.push({
        chatId: campaign.chatId,
        status: code === 400 || code === 403 ? 'disabled' : 'retry',
        variantIndex,
        ...(code ? { errorCode: `TELEGRAM_${code}` } : { errorCode: 'TELEGRAM_UNKNOWN' }),
      });
    }
  }
  await dataApi.execute('groupCampaigns.recordBatch', {
    claimToken: batch.claimToken,
    results,
  });
  return results.filter((result) => result.status === 'sent').length;
}
