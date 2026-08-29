import { useEffect, useRef, type ReactNode } from 'react';
import { CustomEmojiGlyph } from './custom-emoji-glyph.js';
import { useCustomEmoji } from './custom-emoji-library.js';
import {
  customEmojiToken,
  hasCustomEmojiToken,
  splitCustomEmojiText,
} from './custom-emoji-token.js';

/**
 * A text field that shows the emoji it holds instead of the token behind it.
 *
 * The text itself stays ordinary text — `[ce:5301]` in the value, in the request
 * and in the database — because that is what survives every field, every later
 * edit and every older client. What changes is only what the writer sees: a copy
 * of the text is drawn over the field with the glyphs in place, while the field
 * keeps its own caret and selection.
 *
 * Each glyph is laid over the token it replaces rather than beside it, so it
 * takes exactly the width of the text underneath and nothing after it shifts:
 * the caret stays where the letters are. Nothing is fetched for any of this —
 * the pictures come from the pack archives the app already holds, so writing
 * with emoji costs no requests at all.
 *
 * The overlay exists only while the text actually holds an emoji, so ordinary
 * typing behaves exactly as it did before.
 */
export function CustomEmojiField({
  value,
  children,
  className = '',
}: {
  value: string;
  children: ReactNode;
  className?: string;
}) {
  const active = hasCustomEmojiToken(value);
  const wrapperRef = useRef<HTMLDivElement>(null);
  const mirrorRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!active) return;
    const field = wrapperRef.current?.querySelector('textarea, input');
    const mirror = mirrorRef.current;
    if (!(field instanceof HTMLElement) || !mirror) return;
    // Copied from the field itself rather than guessed in CSS: the composers
    // differ in font, padding and line height, and a copy that does not match
    // the original to the pixel puts the emoji next to the wrong word.
    const computed = window.getComputedStyle(field);
    for (const property of [
      'font',
      'fontFamily',
      'fontSize',
      'fontWeight',
      'lineHeight',
      'letterSpacing',
      'textIndent',
      'paddingTop',
      'paddingRight',
      'paddingBottom',
      'paddingLeft',
      'borderTopWidth',
      'borderRightWidth',
      'borderBottomWidth',
      'borderLeftWidth',
    ] as const) {
      mirror.style.setProperty(
        property.replace(/[A-Z]/g, (letter) => `-${letter.toLowerCase()}`),
        computed.getPropertyValue(property.replace(/[A-Z]/g, (l) => `-${l.toLowerCase()}`)),
      );
    }
    // A long text scrolls inside its field, and the copy has to follow it.
    const sync = () => {
      mirror.scrollTop = field.scrollTop;
      mirror.scrollLeft = field.scrollLeft;
    };
    sync();
    field.addEventListener('scroll', sync);
    return () => field.removeEventListener('scroll', sync);
  }, [active, value]);

  return (
    <div
      ref={wrapperRef}
      className={`custom-emoji-field${active ? ' is-mirrored' : ''} ${className}`.trim()}
    >
      {children}
      {active ? (
        <div className="custom-emoji-field-mirror" ref={mirrorRef} aria-hidden>
          {splitCustomEmojiText(value).map((segment, index) =>
            segment.kind === 'text' ? (
              <span key={`t${String(index)}`}>{segment.value}</span>
            ) : (
              <FieldGlyph key={`e${String(index)}`} customEmojiId={segment.customEmojiId} />
            ),
          )}
        </div>
      ) : null}
    </div>
  );
}

/**
 * One emoji, sitting exactly where its token sits.
 *
 * The token text is kept in place but hidden, which is what gives the slot the
 * width of the characters it stands for; the picture is drawn over that slot.
 */
function FieldGlyph({ customEmojiId }: { customEmojiId: string }) {
  const info = useCustomEmoji(customEmojiId);
  return (
    <span className="custom-emoji-field-slot">
      <span className="custom-emoji-field-ghost">{customEmojiToken(customEmojiId)}</span>
      <span className="custom-emoji-field-picture">
        <CustomEmojiGlyph
          customEmojiId={customEmojiId}
          renderKind={info?.renderKind ?? 'static'}
          label={info?.emoji ?? ''}
          size={20}
          {...(info?.src ? { srcOverride: info.src } : {})}
          {...(info?.sourceType ? { sourceType: info.sourceType } : {})}
        />
      </span>
    </span>
  );
}
