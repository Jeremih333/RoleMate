import type { Bot } from 'grammy';
import type { DataApiClient } from './d1-client.js';

export async function dispatchBroadcastBatch(
  bot: Bot,
  dataApi: DataApiClient,
  onError: (error: unknown) => void = () => undefined,
): Promise<boolean> {
  try {
    const batch = await dataApi.execute<{
      broadcastId: string;
      jobId: string;
      message: string;
      buttonText: string | null;
      buttonUrl: string | null;
      deliveries: Array<{ deliveryId: string; telegramUserId: number }>;
    } | null>('broadcasts.claimBatch', { limit: 30 });
    if (!batch) return false;
    const replyMarkup =
      batch.buttonText && batch.buttonUrl
        ? { inline_keyboard: [[{ text: batch.buttonText, url: batch.buttonUrl }]] }
        : undefined;
    const results = [];
    for (const delivery of batch.deliveries) {
      try {
        await bot.api.sendMessage(delivery.telegramUserId, batch.message, {
          protect_content: true,
          ...(replyMarkup ? { reply_markup: replyMarkup } : {}),
        });
        results.push({ deliveryId: delivery.deliveryId, status: 'sent' as const });
      } catch (error) {
        const message = error instanceof Error ? error.message : 'Telegram delivery failed';
        results.push({
          deliveryId: delivery.deliveryId,
          status: 'failed' as const,
          errorCode: error instanceof Error ? error.name.slice(0, 64) : 'DELIVERY_FAILED',
          safeMessage: message.slice(0, 500),
        });
      }
    }
    await dataApi.execute('broadcasts.recordBatch', {
      broadcastId: batch.broadcastId,
      jobId: batch.jobId,
      results,
    });
    return true;
  } catch (error) {
    onError(error);
    return false;
  }
}
