import { createPortal } from 'react-dom';
import { X } from 'lucide-react';
import { ru } from '@rolemate/shared';
import type { CustomEmojiLibrary } from '../api.js';
import { Button } from './ui.js';

/**
 * Picks one emoji out of the imported packs. Only repaintable emoji are offered
 * for a profile header — a full-colour glyph cannot take the header's tint — and
 * the sheet is rendered in a portal so the editor's own stacking context cannot
 * trap it behind the navigation.
 */
export function CustomEmojiPickerDialog({
  library,
  loading,
  selectedId,
  monochromeOnly = true,
  onPick,
  onClose,
}: {
  library: CustomEmojiLibrary | undefined;
  loading: boolean;
  selectedId: string | null;
  monochromeOnly?: boolean;
  onPick: (customEmojiId: string | null) => void;
  onClose: () => void;
}) {
  const packs = library?.packs ?? [];
  const emoji = (library?.emoji ?? []).filter(
    (item) => !monochromeOnly || item.needs_repainting === 1,
  );
  const groups = packs
    .map((pack) => ({ pack, items: emoji.filter((item) => item.pack_id === pack.id) }))
    .filter((group) => group.items.length > 0);

  return createPortal(
    <div className="custom-emoji-sheet-backdrop" role="presentation" onMouseDown={onClose}>
      <section
        className="custom-emoji-sheet"
        role="dialog"
        aria-modal="true"
        aria-label={ru.miniApp.social.customEmojiPickerTitle}
        onMouseDown={(event) => event.stopPropagation()}
      >
        <header className="custom-emoji-sheet-header">
          <strong>{ru.miniApp.social.customEmojiPickerTitle}</strong>
          <button type="button" aria-label={ru.miniApp.dialogs.cancel} onClick={onClose}>
            <X aria-hidden />
          </button>
        </header>
        {loading ? (
          <p className="custom-emoji-sheet-note">{ru.miniApp.social.customEmojiLoading}</p>
        ) : groups.length ? (
          <div className="custom-emoji-sheet-body">
            {selectedId ? (
              <Button variant="secondary" onClick={() => onPick(null)}>
                {ru.miniApp.social.customEmojiClear}
              </Button>
            ) : null}
            {groups.map(({ pack, items }) => (
              <section key={pack.id}>
                <p className="custom-emoji-pack-title">{pack.title}</p>
                <div className="custom-emoji-grid">
                  {items.map((item) => (
                    <button
                      key={item.custom_emoji_id}
                      type="button"
                      className={`custom-emoji-cell${
                        selectedId === item.custom_emoji_id ? ' is-selected' : ''
                      }`}
                      aria-pressed={selectedId === item.custom_emoji_id}
                      aria-label={item.emoji || pack.title}
                      onClick={() => onPick(item.custom_emoji_id)}
                    >
                      <img
                        src={`/api/custom-emoji/${item.custom_emoji_id}?thumbnail=1`}
                        alt={item.emoji}
                        loading="lazy"
                        decoding="async"
                      />
                    </button>
                  ))}
                </div>
              </section>
            ))}
          </div>
        ) : (
          <p className="custom-emoji-sheet-note">{ru.miniApp.social.customEmojiEmptyHint}</p>
        )}
      </section>
    </div>,
    document.body,
  );
}
