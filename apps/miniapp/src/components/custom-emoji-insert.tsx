import { useState } from 'react';
import { Smile } from 'lucide-react';
import { ru } from '@rolemate/shared';
import { CustomEmojiPickerDialog } from './custom-emoji-picker.js';
import { customEmojiToken } from './custom-emoji-token.js';

/**
 * Appends a custom emoji to whatever text is being written. The token is plain
 * text, so it survives the field, the database and every later edit, and the
 * renderer draws the glyph wherever that text is shown.
 */
export function CustomEmojiInsertButton({
  onInsert,
  className = '',
}: {
  onInsert: (token: string) => void;
  className?: string;
}) {
  const [open, setOpen] = useState(false);
  return (
    <>
      <button
        type="button"
        className={`custom-emoji-insert ${className}`.trim()}
        aria-label={ru.miniApp.social.customEmojiInsert}
        title={ru.miniApp.social.customEmojiInsert}
        onClick={() => setOpen(true)}
      >
        <Smile aria-hidden />
      </button>
      {open ? (
        <CustomEmojiPickerDialog
          onPick={(customEmojiId) => {
            if (customEmojiId) onInsert(customEmojiToken(customEmojiId));
            setOpen(false);
          }}
          onClose={() => setOpen(false)}
        />
      ) : null}
    </>
  );
}
