/**
 * Custom emoji live inside ordinary text as `[ce:<id>]`. The token is plain
 * text, so it survives every field, every editor and the database untouched, and
 * only the renderer knows how to draw it.
 */
export const CUSTOM_EMOJI_TOKEN_PATTERN = /\[ce:([0-9]{1,32})\]/g;

export const CUSTOM_EMOJI_PACK_EVENT = 'rolemate:open-emoji-pack';

export function customEmojiToken(customEmojiId: string): string {
  return `[ce:${customEmojiId}]`;
}

/** Asks whatever is listening — the shell — to show the pack this emoji is from. */
export function openCustomEmojiPack(customEmojiId: string): void {
  window.dispatchEvent(
    new CustomEvent<string>(CUSTOM_EMOJI_PACK_EVENT, { detail: customEmojiId }),
  );
}
