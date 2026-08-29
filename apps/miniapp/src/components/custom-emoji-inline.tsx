import { CustomEmojiGlyph } from './custom-emoji-glyph.js';
import { useCustomEmoji } from './custom-emoji-library.js';
import { CUSTOM_EMOJI_TOKEN_PATTERN } from './custom-emoji-token.js';

/**
 * A line of text with its custom emoji drawn in it.
 *
 * The places that show a line rather than a message — a reply quote, a chat in
 * the list, a draft waiting to be sent — had no way to draw a glyph, so the text
 * arrived either as the raw `[ce:5301]` or as a single stand-in face for every
 * emoji alike. Telegram draws the real thing in all of them, and so does this.
 *
 * They are stills: a list can hold dozens of these lines, and the pictures come
 * from the pack archives the app already holds, so a preview costs nothing.
 */
export function CustomEmojiInline({ text, size = 16 }: { text: string; size?: number }) {
  const parts: Array<{ text: string } | { id: string }> = [];
  let index = 0;
  for (const match of text.matchAll(CUSTOM_EMOJI_TOKEN_PATTERN)) {
    const at = match.index ?? 0;
    if (at > index) parts.push({ text: text.slice(index, at) });
    parts.push({ id: match[1]! });
    index = at + match[0].length;
  }
  if (index < text.length) parts.push({ text: text.slice(index) });
  if (parts.length === 1 && 'text' in parts[0]!) return <>{text}</>;
  return (
    <>
      {parts.map((part, position) =>
        'text' in part ? (
          <span key={`t${String(position)}`}>{part.text}</span>
        ) : (
          <InlineGlyph key={`e${String(position)}`} customEmojiId={part.id} size={size} />
        ),
      )}
    </>
  );
}

function InlineGlyph({ customEmojiId, size }: { customEmojiId: string; size: number }) {
  const info = useCustomEmoji(customEmojiId);
  return (
    <span className="custom-emoji-inline-glyph">
      <CustomEmojiGlyph
        customEmojiId={customEmojiId}
        renderKind={info?.renderKind ?? 'static'}
        label={info?.emoji ?? ''}
        size={size}
        {...(info?.src ? { srcOverride: info.src } : {})}
        {...(info?.sourceType ? { sourceType: info.sourceType } : {})}
      />
    </span>
  );
}
