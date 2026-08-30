import { checkContentLinkPolicy, type ContentPolicyFailure } from '@rolemate/shared';
import type { DataApiClient } from './d1-client.js';

interface TelegramChatTarget {
  type: 'private' | 'group' | 'supergroup' | 'channel';
}

export interface ContentPolicyContext {
  premium: boolean;
  dataApi: DataApiClient;
  getChat: (chatId: string) => Promise<TelegramChatTarget>;
}

export async function validateUserContentLinks(
  text: string,
  context: ContentPolicyContext,
): Promise<{ allowed: true } | { allowed: false; reason: ContentPolicyFailure }> {
  const syntax = checkContentLinkPolicy(text, context.premium);
  if (!syntax.allowed) return syntax;

  for (const reference of syntax.references) {
    const knownUser = await context.dataApi.execute<{ is_bot: number } | null>(
      'users.resolveUsername',
      { username: reference.username },
    );
    if (knownUser && knownUser.is_bot === 0) continue;
    try {
      const chat = await context.getChat(`@${reference.username}`);
      if (chat.type === 'channel' || chat.type === 'private') continue;
      return { allowed: false, reason: 'bot_or_chat' };
    } catch {
      return { allowed: false, reason: 'unverified_target' };
    }
  }
  return { allowed: true };
}
