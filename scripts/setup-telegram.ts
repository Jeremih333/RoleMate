const token = process.env.TELEGRAM_BOT_TOKEN;
const publicUrl = process.env.PUBLIC_BASE_URL;
const secret = process.env.TELEGRAM_WEBHOOK_SECRET;
const miniAppUrl = process.env.MINI_APP_URL;

if (!token || !publicUrl || !secret || !miniAppUrl) {
  throw new Error(
    'TELEGRAM_BOT_TOKEN, PUBLIC_BASE_URL, TELEGRAM_WEBHOOK_SECRET and MINI_APP_URL are required',
  );
}

const api = async (method: string, body: Record<string, unknown>) => {
  const response = await fetch(`https://api.telegram.org/bot${token}/${method}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
  const result = (await response.json()) as { ok: boolean; description?: string };
  if (!result.ok) throw new Error(`${method} failed: ${result.description ?? 'unknown error'}`);
};

await api('setWebhook', {
  url: new URL('/telegram/webhook', publicUrl).toString(),
  secret_token: secret,
  allowed_updates: ['message', 'callback_query', 'pre_checkout_query'],
  drop_pending_updates: false,
});
await api('setChatMenuButton', {
  menu_button: { type: 'web_app', text: 'Открыть RoleMate', web_app: { url: miniAppUrl } },
});

console.log('Telegram webhook and menu button configured.');
