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

/**
 * The link form a custom emoji takes inside markdown.
 *
 * A custom scheme such as `ce:` is stripped by the markdown sanitiser, which
 * removes the href before the renderer ever sees it — the glyph then had nothing
 * to draw and the message arrived empty. A fragment has no protocol, so it
 * passes through untouched with the sanitising left fully in place.
 */
export function customEmojiHref(customEmojiId: string): string {
  return `#ce-${customEmojiId}`;
}

export function customEmojiIdFromHref(href: string | null | undefined): string | null {
  const match = /^#ce-([0-9]{1,32})$/.exec(href ?? '');
  return match?.[1] ?? null;
}

/** Asks whatever is listening — the shell — to show the pack this emoji is from. */
export function openCustomEmojiPack(customEmojiId: string): void {
  window.dispatchEvent(new CustomEvent<string>(CUSTOM_EMOJI_PACK_EVENT, { detail: customEmojiId }));
}

export type CustomEmojiSegment =
  { kind: 'text'; value: string } | { kind: 'emoji'; customEmojiId: string };

/**
 * Splits text into the pieces a field has to draw: plain runs and the emoji
 * between them. A composer shows the emoji itself where the token sits, so what
 * is being written looks like what will be sent instead of like `[ce:5301]`.
 */
export function splitCustomEmojiText(text: string): CustomEmojiSegment[] {
  const segments: CustomEmojiSegment[] = [];
  let index = 0;
  for (const match of text.matchAll(CUSTOM_EMOJI_TOKEN_PATTERN)) {
    const at = match.index ?? 0;
    if (at > index) segments.push({ kind: 'text', value: text.slice(index, at) });
    segments.push({ kind: 'emoji', customEmojiId: match[1]! });
    index = at + match[0].length;
  }
  if (index < text.length) segments.push({ kind: 'text', value: text.slice(index) });
  return segments;
}

/** Whether text holds an emoji at all — the cheap check a field makes on every keystroke. */
export function hasCustomEmojiToken(text: string): boolean {
  return /\[ce:[0-9]{1,32}\]/.test(text);
}
