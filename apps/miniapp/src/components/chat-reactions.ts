import type { ChatReaction } from '../api.js';

export interface ChatReactionCount {
  reaction: ChatReaction;
  count: number;
}

/**
 * Reactions arrive as a JSON string built by the database. Anything malformed
 * has to collapse to an empty list rather than throw, because a single bad row
 * would otherwise take the whole conversation down with it.
 */
export function parseMessageReactions(raw: string | null | undefined): ChatReactionCount[] {
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw || '[]');
  } catch {
    return [];
  }
  if (!Array.isArray(parsed)) return [];
  return parsed.filter((item): item is ChatReactionCount => {
    if (typeof item !== 'object' || item === null) return false;
    const reaction: unknown = Reflect.get(item, 'reaction');
    const count: unknown = Reflect.get(item, 'count');
    return (
      typeof reaction === 'string' &&
      reaction.trim().length > 0 &&
      reaction.length <= 16 &&
      typeof count === 'number' &&
      Number.isFinite(count) &&
      count > 0
    );
  });
}
