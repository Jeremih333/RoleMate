const token = process.env.TELEGRAM_BOT_TOKEN;
if (!token) throw new Error('TELEGRAM_BOT_TOKEN is required');
const response = await fetch(`https://api.telegram.org/bot${token}/getWebhookInfo`);
const result = (await response.json()) as {
  ok: boolean;
  result?: { url: string; pending_update_count: number; last_error_message?: string };
};
if (!result.ok || !result.result?.url || result.result.last_error_message) {
  throw new Error('Webhook is not healthy');
}
console.log(
  JSON.stringify({
    configured: true,
    pendingUpdates: result.result.pending_update_count,
    hasLastError: false,
  }),
);
