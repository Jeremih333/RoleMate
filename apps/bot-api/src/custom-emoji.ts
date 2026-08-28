import type { Sticker } from 'grammy/types';

export interface ImportedCustomEmoji {
  customEmojiId: string;
  emoji?: string;
  fileId: string;
  thumbnailFileId?: string;
  renderKind: 'static' | 'video' | 'lottie';
  needsRepainting: boolean;
  fileSizeBytes?: number;
}

/** Telegram allows at most 200 custom emoji in a set; this is a hard stop, not a preference. */
export const CUSTOM_EMOJI_SET_LIMIT = 200;
/** A custom emoji is a few dozen kilobytes; anything larger is not one and is skipped. */
export const CUSTOM_EMOJI_MAX_BYTES = 512 * 1024;

/**
 * Extracts the sticker set name from a t.me/addemoji link. Accepts the forms
 * people actually paste: with or without a scheme, with www, the tg:// deep
 * link, and trailing query or punctuation. Sticker packs (addstickers) are not
 * emoji packs and are deliberately not matched here.
 */
export function parseAddEmojiSetName(text: string): string | null {
  const patterns = [
    /(?:https?:\/\/)?(?:www\.)?t(?:elegram)?\.me\/addemoji\/([A-Za-z0-9_]{1,64})/i,
    /tg:\/\/addemoji\?set=([A-Za-z0-9_]{1,64})/i,
  ];
  for (const pattern of patterns) {
    const match = pattern.exec(text);
    if (match?.[1]) return match[1];
  }
  return null;
}

/**
 * Telegram marks single-colour custom emoji with needs_repainting so clients can
 * paint them in the surrounding text colour. The installed type definitions omit
 * the field even though the API sends it, so it is read defensively rather than
 * asserted onto the type.
 */
function needsRepainting(sticker: Sticker): boolean {
  return Reflect.get(sticker, 'needs_repainting') === true;
}

/**
 * Maps a Telegram sticker set into rows we can store. Anything that is not a
 * usable custom emoji — no id, an implausible size — is dropped rather than
 * failing the whole import, because one odd entry should not cost the user the
 * rest of the pack.
 */
export function collectCustomEmoji(stickers: readonly Sticker[]): ImportedCustomEmoji[] {
  const collected: ImportedCustomEmoji[] = [];
  for (const sticker of stickers) {
    if (collected.length >= CUSTOM_EMOJI_SET_LIMIT) break;
    const customEmojiId = sticker.custom_emoji_id;
    if (!customEmojiId || !/^[0-9]{1,32}$/.test(customEmojiId)) continue;
    if (typeof sticker.file_size === 'number' && sticker.file_size > CUSTOM_EMOJI_MAX_BYTES) {
      continue;
    }
    collected.push({
      customEmojiId,
      ...(sticker.emoji ? { emoji: sticker.emoji.slice(0, 16) } : {}),
      fileId: sticker.file_id,
      ...(sticker.thumbnail?.file_id ? { thumbnailFileId: sticker.thumbnail.file_id } : {}),
      renderKind: sticker.is_video ? 'video' : sticker.is_animated ? 'lottie' : 'static',
      needsRepainting: needsRepainting(sticker),
      ...(typeof sticker.file_size === 'number' ? { fileSizeBytes: sticker.file_size } : {}),
    });
  }
  return collected;
}
