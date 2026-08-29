import { useEffect, useRef, type KeyboardEvent, type ReactNode } from 'react';
import { CustomEmojiGlyph } from './custom-emoji-glyph.js';
import { useCustomEmoji } from './custom-emoji-library.js';
import {
  draftSegments,
  hasDraftPlaceholder,
  placeholderAfter,
  placeholderBefore,
} from './custom-emoji-draft.js';

/**
 * A text field that shows the emoji it holds.
 *
 * While it is being written an emoji is one visible character — the one the pack
 * falls back to — with its id carried after it in Unicode tag characters, which
 * are invisible and take no width. So the box under the picture is the emoji's
 * own box: nothing empty beside it, the caret walks past it in one step, and a
 * counter charges one character for it. The text becomes `[ce:5301]` only on its
 * way to being sent.
 *
 * What the writer sees is a copy of the text drawn over the field with the
 * pictures in place, while the field keeps its own caret and selection. Nothing
 * is fetched for it: the pictures come from the pack archives already in hand.
 */
export function CustomEmojiField({
  value,
  onChange,
  children,
  className = '',
}: {
  value: string;
  /** Needed only for removing an emoji whole; without it the field just draws. */
  onChange?: (value: string) => void;
  children: ReactNode;
  className?: string;
}) {
  const active = hasDraftPlaceholder(value);
  const wrapperRef = useRef<HTMLDivElement>(null);
  const mirrorRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!active) return;
    const field = wrapperRef.current?.querySelector('textarea, input');
    const mirror = mirrorRef.current;
    if (!(field instanceof HTMLElement) || !mirror) return;
    // Copied from the field itself rather than guessed in CSS: the composers
    // differ in font, padding, line height and how they break words, and a copy
    // that does not match the original puts the emoji next to the wrong word.
    const computed = window.getComputedStyle(field);
    for (const property of [
      'font',
      'font-family',
      'font-size',
      'font-weight',
      'line-height',
      'letter-spacing',
      'text-indent',
      'text-align',
      'white-space',
      'overflow-wrap',
      'word-break',
      'word-spacing',
      'tab-size',
      'padding-top',
      'padding-right',
      'padding-bottom',
      'padding-left',
      'border-top-width',
      'border-right-width',
      'border-bottom-width',
      'border-left-width',
    ]) {
      mirror.style.setProperty(property, computed.getPropertyValue(property));
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

  /**
   * One press, one emoji. The caret walks code units and an emoji is several of
   * them, so backspace would otherwise chip an invisible piece off the id and
   * leave a bare character behind.
   */
  const onKeyDown = (event: KeyboardEvent<HTMLDivElement>) => {
    if (!onChange || !active) return;
    if (event.key !== 'Backspace' && event.key !== 'Delete') return;
    const field = event.target;
    if (!(field instanceof HTMLTextAreaElement || field instanceof HTMLInputElement)) return;
    const { selectionStart, selectionEnd } = field;
    if (selectionStart === null || selectionEnd === null || selectionStart !== selectionEnd) return;
    const length =
      event.key === 'Backspace'
        ? placeholderBefore(value, selectionStart)
        : placeholderAfter(value, selectionStart);
    if (length === null) return;
    event.preventDefault();
    const at = event.key === 'Backspace' ? selectionStart - length : selectionStart;
    onChange(`${value.slice(0, at)}${value.slice(at + length)}`);
    requestAnimationFrame(() => field.setSelectionRange(at, at));
  };

  return (
    <div
      ref={wrapperRef}
      className={`custom-emoji-field${active ? ' is-mirrored' : ''} ${className}`.trim()}
      onKeyDown={onKeyDown}
    >
      {children}
      {active ? (
        <div className="custom-emoji-field-mirror" ref={mirrorRef} aria-hidden>
          {draftSegments(value).map((segment, index) =>
            segment.kind === 'text' ? (
              <span key={`t${String(index)}`}>{segment.value}</span>
            ) : (
              <FieldGlyph
                key={`e${String(index)}`}
                customEmojiId={segment.customEmojiId ?? ''}
                placeholder={segment.value}
              />
            ),
          )}
        </div>
      ) : null}
    </div>
  );
}

/**
 * One emoji, sitting exactly where its character sits.
 *
 * The character is kept in place but hidden, which is what gives the slot the
 * width the field itself gives it; the picture is drawn over that slot and
 * stretched to it, so there is no gap on either side. The slot stays inline: a
 * box of its own could not be broken across a line, and the copy would then wrap
 * differently from the field it is covering.
 */
function FieldGlyph({
  customEmojiId,
  placeholder,
}: {
  customEmojiId: string;
  placeholder: string;
}) {
  const info = useCustomEmoji(customEmojiId);
  return (
    <span className="custom-emoji-field-slot">
      <span className="custom-emoji-field-ghost">{placeholder}</span>
      <span className="custom-emoji-field-picture">
        <CustomEmojiGlyph
          customEmojiId={customEmojiId}
          renderKind={info?.renderKind ?? 'static'}
          label={info?.emoji ?? ''}
          size={20}
          // It plays in the field as it will play in the message.
          animate
          {...(info?.src ? { srcOverride: info.src } : {})}
          {...(info?.sourceType ? { sourceType: info.sourceType } : {})}
        />
      </span>
    </span>
  );
}
