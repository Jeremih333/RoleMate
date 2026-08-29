import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Trash2, X } from 'lucide-react';
import { createPortal } from 'react-dom';
import { ru } from '@rolemate/shared';
import { api } from '../api.js';
import { Button, useConfirmPrompt } from './ui.js';
import { CustomEmojiGlyph } from './custom-emoji-glyph.js';
import { useCustomEmojiArchives } from './use-custom-emoji-archives.js';

/** Bytes from the pack archive when they arrived, and nothing otherwise. */
function archiveSource(urls: Map<string, string>, id: string): { srcOverride?: string } {
  const url = urls.get(id);
  return url ? { srcOverride: url } : {};
}

/**
 * The imported packs, in one sheet.
 *
 * It is used to choose a header emoji (repaintable ones only — a full-colour
 * glyph cannot take the header's colour), to insert an emoji into text, and to
 * simply look at a pack when somebody taps one of its emoji. Removing a pack
 * takes it out everywhere, so it is offered only to whoever brought it in and to
 * staff, and always behind a confirmation.
 */
export function CustomEmojiPickerDialog({
  selectedId,
  monochromeOnly = false,
  focusPackOfEmojiId,
  onPick,
  onClose,
}: {
  selectedId?: string | null;
  monochromeOnly?: boolean;
  focusPackOfEmojiId?: string | null;
  onPick?: (customEmojiId: string | null) => void;
  onClose: () => void;
}) {
  const queryClient = useQueryClient();
  const { confirm, dialog } = useConfirmPrompt();
  const library = useQuery({
    queryKey: ['custom-emoji-packs'],
    queryFn: api.customEmojiPacks,
    staleTime: 5 * 60_000,
  });
  const remove = useMutation({
    mutationFn: (packId: string) => api.removeCustomEmojiPack(packId),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ['custom-emoji-packs'] });
      void queryClient.invalidateQueries({ queryKey: ['public-profile'] });
      void queryClient.invalidateQueries({ queryKey: ['conversations'] });
    },
  });

  // Every pack the sheet is about to show is fetched as a single archive: the
  // grid then paints from bytes already in hand rather than a request per glyph.
  const archiveUrls = useCustomEmojiArchives((library.data?.packs ?? []).map((pack) => pack.id));
  const packs = library.data?.packs ?? [];
  const emoji = (library.data?.emoji ?? []).filter(
    (item) => !monochromeOnly || item.needs_repainting === 1,
  );
  const focusPackId = focusPackOfEmojiId
    ? (library.data?.emoji.find((item) => item.custom_emoji_id === focusPackOfEmojiId)?.pack_id ??
      null)
    : null;
  const groups = packs
    .filter((pack) => !focusPackId || pack.id === focusPackId)
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
        {library.isLoading ? (
          <p className="custom-emoji-sheet-note">{ru.miniApp.social.customEmojiLoading}</p>
        ) : groups.length ? (
          <div className="custom-emoji-sheet-body">
            {onPick && selectedId ? (
              <Button variant="secondary" onClick={() => onPick(null)}>
                {ru.miniApp.social.customEmojiClear}
              </Button>
            ) : null}
            {groups.map(({ pack, items }) => (
              <section key={pack.id}>
                <div className="custom-emoji-pack-head">
                  <p className="custom-emoji-pack-title">{pack.title}</p>
                  {pack.can_remove ? (
                    <button
                      type="button"
                      className="custom-emoji-pack-remove"
                      aria-label={ru.miniApp.social.customEmojiRemovePack}
                      title={ru.miniApp.social.customEmojiRemovePack}
                      disabled={remove.isPending}
                      onClick={() =>
                        confirm(ru.miniApp.social.customEmojiRemovePackConfirm, () =>
                          remove.mutate(pack.id),
                        )
                      }
                    >
                      <Trash2 aria-hidden />
                    </button>
                  ) : null}
                </div>
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
                      disabled={!onPick}
                      onClick={() => onPick?.(item.custom_emoji_id)}
                    >
                      <CustomEmojiGlyph
                        customEmojiId={item.custom_emoji_id}
                        renderKind={item.render_kind}
                        label={item.emoji}
                        size={30}
                        {...archiveSource(archiveUrls, item.custom_emoji_id)}
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
        {remove.isError ? <div className="error-box">{remove.error.message}</div> : null}
        {dialog}
      </section>
    </div>,
    document.body,
  );
}
