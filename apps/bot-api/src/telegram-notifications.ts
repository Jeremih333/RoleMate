import type { Bot } from 'grammy';
import { NEWS_CHANNEL_URL, ru } from '@rolemate/shared';
import type { DataApiClient } from './d1-client.js';
import type { AppEnv } from './env.js';

function telegramErrorCode(error: unknown): number | undefined {
  if (!error || typeof error !== 'object') return undefined;
  const record = error as Record<string, unknown>;
  if (typeof record.error_code === 'number') return record.error_code;
  if (record.error && typeof record.error === 'object') {
    const nested = record.error as Record<string, unknown>;
    if (typeof nested.error_code === 'number') return nested.error_code;
  }
  return undefined;
}

function notificationUrl(env: AppEnv, openPath: string): string {
  const base = new URL(env.MINI_APP_URL);
  const target = new URL(openPath, base);
  if (target.origin !== base.origin) throw new Error('Unsafe notification path');
  return target.toString();
}

export function isSafeNotificationButtonUrl(botUsernameValue: string, value: string): boolean {
  if (value === NEWS_CHANNEL_URL) return true;
  try {
    const url = new URL(value);
    const botUsername = botUsernameValue.replace(/^@/, '');
    return (
      url.protocol === 'https:' &&
      url.hostname === 't.me' &&
      url.pathname === `/${botUsername}` &&
      url.searchParams.size === 1 &&
      url.searchParams.get('start') === 'resume_registration'
    );
  } catch {
    return false;
  }
}

export async function dispatchTelegramNotificationBatch(
  bot: Bot,
  dataApi: DataApiClient,
  env: AppEnv,
  onError: (error: unknown) => void = () => undefined,
): Promise<boolean> {
  try {
    const batch = await dataApi.execute<{
      claimToken: string;
      deliveries: Array<{
        notificationId: string;
        telegramUserId: number;
        message: string;
        openPath: string;
        parseMode?: 'MarkdownV2';
        buttonText?: string;
        buttonUrl?: string;
      }>;
    } | null>('notifications.telegram.claimBatch', { limit: 30 });
    if (!batch) return false;

    const results = await Promise.all(
      batch.deliveries.map(async (delivery) => {
        try {
          if (
            delivery.buttonUrl &&
            !isSafeNotificationButtonUrl(env.BOT_USERNAME, delivery.buttonUrl)
          ) {
            throw new Error('Unsafe notification button URL');
          }
          const button = delivery.buttonUrl
            ? {
                text: delivery.buttonText ?? ru.bot.openNotification,
                url: delivery.buttonUrl,
              }
            : {
                text: delivery.buttonText ?? ru.bot.openNotification,
                web_app: { url: notificationUrl(env, delivery.openPath) },
              };
          const response = await fetch(`https://api.telegram.org/bot${bot.token}/sendMessage`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              chat_id: delivery.telegramUserId,
              text: delivery.message,
              ...(delivery.parseMode ? { parse_mode: delivery.parseMode } : {}),
              protect_content: true,
              reply_markup: {
                inline_keyboard: [[button]],
              },
            }),
            signal: AbortSignal.timeout(8_000),
          });
          if (!response.ok) {
            const payload: unknown = await response.json().catch(() => ({}));
            throw payload;
          }
          return { notificationId: delivery.notificationId, status: 'sent' as const };
        } catch (error) {
          const code = telegramErrorCode(error);
          // Telegram has no idempotency key for sendMessage. A timeout or 5xx can
          // happen after Telegram accepted the message, so retrying that outcome
          // can spam the recipient. Only an explicit flood-limit rejection is
          // safe to retry.
          const retryable = code === 429;
          return {
            notificationId: delivery.notificationId,
            status: retryable ? ('retry' as const) : ('failed' as const),
            errorCode: code === undefined ? 'TELEGRAM_UNAVAILABLE' : `TELEGRAM_${String(code)}`,
          };
        }
      }),
    );
    await dataApi.execute('notifications.telegram.recordBatch', {
      claimToken: batch.claimToken,
      results,
    });
    return true;
  } catch (error) {
    onError(error);
    return false;
  }
}
