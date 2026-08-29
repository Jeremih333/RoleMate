/**
 * Whether an update is one this bot actually acts on.
 *
 * An administrator in a public group receives every message posted there, and
 * each one used to be claimed in the database before anything looked at it: two
 * writes and two worker requests for a message the bot has no interest in. On a
 * free plan that is the difference between a working product and one that stops
 * at lunchtime — seventeen thousand such rows landed in a single day.
 *
 * The bot converses in private chats, reacts to its own buttons and payments,
 * and needs to know when it is added to or removed from a chat. A group message
 * matters only when it is a command; the scheduled presentations a group gets
 * are outbound and need no update at all.
 */
export function isActionableTelegramUpdate(update: unknown): boolean {
  if (typeof update !== 'object' || update === null) return false;
  const record = update as Record<string, unknown>;
  for (const key of [
    'callback_query',
    'pre_checkout_query',
    'successful_payment',
    'my_chat_member',
    'chat_member',
    'chat_join_request',
  ]) {
    if (record[key]) return true;
  }
  const message = (record.message ?? record.edited_message ?? record.channel_post) as
    Record<string, unknown> | undefined;
  if (!message) return false;
  const chat = message.chat as { type?: unknown } | undefined;
  if (chat?.type === 'private') return true;
  // In a group, only an explicit command is addressed to us.
  const text = typeof message.text === 'string' ? message.text : '';
  const caption = typeof message.caption === 'string' ? message.caption : '';
  return text.startsWith('/') || caption.startsWith('/');
}
