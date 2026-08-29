import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Trash2, X } from 'lucide-react';
import { createPortal } from 'react-dom';
import { ru } from '@rolemate/shared';
import { api, type CustomEmojiItem } from '../api.js';
import { Button, useConfirmPrompt } from './ui.js';
import { CustomEmojiGlyph } from './custom-emoji-glyph.js';
import { useCustomEmojiSources } from './custom-emoji-library.js';
import { useCustomEmojiArchives } from './use-custom-emoji-archives.js';

/**
 * The imported packs, in one sheet.
 *
 * It is used to choose a header emoji (repaintable ones only — a full-colour
 * glyph cannot take the header's colour), to insert an emoji into text, and to
 * simply look at a pack when somebody taps one of its emoji. A pack nobody here
 * has imported can be looked at the same way and added from the sheet, which is
 * the whole path from meeting an emoji to owning its set. Removing a pack takes
 * it out everywhere, so it is offered only to whoever brought it in and to
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
    staleTime: 30 * 60_000,
  });
  const remove = useMutation({
    mutationFn: (packId: string) => api.removeCustomEmojiPack(packId),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ['custom-emoji-packs'] });
      void queryClient.invalidateQueries({ queryKey: ['public-profile'] });
      void queryClient.invalidateQueries({ queryKey: ['conversations'] });
    },
  });
  const install = useMutation({
    mutationFn: (packId: string) => api.installCustomEmojiPack(packId),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ['custom-emoji-packs'] });
    },
  });

  // Bytes already in hand: the shared library keeps one archive per imported
  // pack, so a grid of hundreds of glyphs costs nothing further to paint.
  const lookup = useCustomEmojiSources();
  const packs = library.data?.packs ?? [];
  const emoji = library.data?.emoji ?? [];
  // An emoji tapped in a message may belong to a set nobody here has. Its set is
  // fetched on its own, exactly as Telegram opens a sticker set from a message.
  const known = emoji.some((item) => item.custom_emoji_id === focusPackOfEmojiId);
  const foreign = useQuery({
    queryKey: ['custom-emoji-of', focusPackOfEmojiId],
    queryFn: async () => {
      const [described] = await api.describeCustomEmoji([focusPackOfEmojiId ?? '']);
      return described ? await api.customEmojiPack(described.pack_id) : null;
    },
    enabled: Boolean(focusPackOfEmojiId) && !known && !library.isLoading,
    staleTime: 30 * 60_000,
  });
  const foreignPackId = foreign.data?.pack.id;
  const foreignSources = useCustomEmojiArchives(foreignPackId ? [foreignPackId] : []);

  const focusPackId = focusPackOfEmojiId
    ? (emoji.find((item) => item.custom_emoji_id === focusPackOfEmojiId)?.pack_id ?? null)
    : null;
  const visible = (items: CustomEmojiItem[]) =>
    items.filter((item) => !monochromeOnly || item.needs_repainting === 1);
  const groups: Array<{
    pack: { id: string; title: string; is_own: number; can_remove: number };
    items: CustomEmojiItem[];
  }> = foreign.data
    ? [
        {
          pack: { ...foreign.data.pack, can_remove: 0 },
          items: visible(foreign.data.emoji),
        },
      ]
    : packs
        .filter((pack) => !focusPackId || pack.id === focusPackId)
        .map((pack) => ({ pack, items: visible(emoji.filter((item) => item.pack_id === pack.id)) }))
        .filter((group) => group.items.length > 0);

  const sourceFor = (customEmojiId: string): { srcOverride?: string; sourceType?: string } => {
    const fromLibrary = lookup(customEmojiId);
    if (fromLibrary?.src) {
      return {
        srcOverride: fromLibrary.src,
        ...(fromLibrary.sourceType ? { sourceType: fromLibrary.sourceType } : {}),
      };
    }
    const fromForeign = foreignSources.get(customEmojiId);
    return fromForeign ? { srcOverride: fromForeign.url, sourceType: fromForeign.contentType } : {};
  };

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
        {library.isLoading || foreign.isLoading ? (
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
                {pack.is_own ? null : (
                  <Button
                    variant="secondary"
                    disabled={install.isPending}
                    onClick={() => install.mutate(pack.id)}
                  >
                    {install.isSuccess
                      ? ru.miniApp.social.customEmojiPackAdded
                      : ru.miniApp.social.customEmojiAddPack}
                  </Button>
                )}
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
                        {...sourceFor(item.custom_emoji_id)}
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
        {install.isError ? <div className="error-box">{install.error.message}</div> : null}
        {dialog}
      </section>
    </div>,
    document.body,
  );
}
