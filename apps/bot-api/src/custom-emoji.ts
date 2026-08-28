import type { Sticker } from 'grammy/types';
import type { DataApiClient } from './d1-client.js';

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

/**
 * Downloads one custom emoji from Telegram and keeps it. Everything after the
 * first fetch is served from our own storage: a picker holds hundreds of glyphs,
 * and asking Telegram for each of them every time is what made them stop
 * arriving. A TGS is unpacked here — it is gzipped Lottie, and the browser
 * should not have to carry a decompressor for it.
 */
export async function cacheCustomEmojiAsset(input: {
  bot: { api: { getFile: (fileId: string) => Promise<{ file_path?: string }> } };
  dataApi: DataApiClient;
  token: string;
  customEmojiId: string;
  kind: 'thumbnail' | 'animation';
  emoji: { file_id: string; thumbnail_file_id: string | null; render_kind?: string };
  requestInit?: RequestInit;
}): Promise<{ contentType: string; dataBase64: string } | null> {
  const fileId =
    input.kind === 'thumbnail'
      ? (input.emoji.thumbnail_file_id ?? input.emoji.file_id)
      : input.emoji.file_id;
  try {
    const file = await input.bot.api.getFile(fileId);
    if (!file.file_path) return null;
    const response = await fetch(
      `https://api.telegram.org/file/bot${input.token}/${file.file_path}`,
      input.requestInit ?? {},
    );
    if (!response.ok) return null;
    const extension = file.file_path.split('.').pop()?.toLowerCase();
    let bytes = new Uint8Array(await response.arrayBuffer());
    // Telegram serves every file as application/octet-stream, so the type has to
    // come from the extension. A picture labelled as a byte stream is refused by
    // a CSS mask, which is exactly how the profile header draws these.
    const byExtension: Record<string, string> = {
      webp: 'image/webp',
      png: 'image/png',
      jpg: 'image/jpeg',
      jpeg: 'image/jpeg',
      gif: 'image/gif',
      webm: 'video/webm',
      mp4: 'video/mp4',
      tgs: 'application/json',
      json: 'application/json',
    };
    const headerType = response.headers.get('content-type');
    let contentType =
      (extension ? byExtension[extension] : undefined) ??
      (headerType && !headerType.startsWith('application/octet-stream')
        ? headerType
        : 'image/webp');
    if (extension === 'tgs') {
      const unpacked = new Response(
        new Blob([bytes]).stream().pipeThrough(new DecompressionStream('gzip')),
      );
      bytes = new Uint8Array(await unpacked.arrayBuffer());
      contentType = 'application/json';
    }
    const dataBase64 = Buffer.from(bytes).toString('base64');
    await input.dataApi.execute('customEmoji.assets.store', {
      customEmojiId: input.customEmojiId,
      kind: input.kind,
      contentType,
      dataBase64,
      byteSize: bytes.byteLength,
    });
    return { contentType, dataBase64 };
  } catch {
    return null;
  }
}
