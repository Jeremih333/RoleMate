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

/**
 * Plain-text places — a chat list preview, a quoted reply, a notification —
 * cannot draw a glyph, and the raw `[ce:…]` reads as a leaked internal detail.
 * The token becomes a neutral mark there, so a message made only of emoji still
 * previews as something a person recognises.
 */
export function stripCustomEmojiTokens(text: string, placeholder = '🙂'): string {
  return text.replace(CUSTOM_EMOJI_TOKEN_PATTERN, placeholder).replace(/\s+/gu, ' ').trim();
}

/** Asks whatever is listening — the shell — to show the pack this emoji is from. */
export function openCustomEmojiPack(customEmojiId: string): void {
  window.dispatchEvent(new CustomEvent<string>(CUSTOM_EMOJI_PACK_EVENT, { detail: customEmojiId }));
}
