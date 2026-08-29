import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { Smile } from 'lucide-react';
import { useLocation } from 'wouter';
import { ru } from '@rolemate/shared';
import { api } from '../api.js';
import { CustomEmojiPickerDialog } from './custom-emoji-picker.js';
import { customEmojiToken } from './custom-emoji-token.js';
import { InfoDialog } from './ui.js';

/**
 * Appends a custom emoji to whatever text is being written. The token is plain
 * text, so it survives the field, the database and every later edit, and the
 * renderer draws the glyph wherever that text is shown.
 *
 * Using one is a Premium feature. Without a subscription the button says so and
 * offers the way to it rather than disappearing, because a control that vanishes
 * reads as a bug; the server enforces the same rule regardless.
 */
export function CustomEmojiInsertButton({
  onInsert,
  className = '',
}: {
  onInsert: (token: string) => void;
  className?: string;
}) {
  const [open, setOpen] = useState(false);
  const [offerPremium, setOfferPremium] = useState(false);
  const [, navigate] = useLocation();
  const premium = useQuery({
    queryKey: ['premium-status'],
    queryFn: api.premiumStatus,
    staleTime: 60_000,
  });
  const allowed = premium.data?.premium === true;
  return (
    <>
      <button
        type="button"
        className={`custom-emoji-insert ${className}`.trim()}
        aria-label={ru.miniApp.social.customEmojiInsert}
        title={ru.miniApp.social.customEmojiInsert}
        onClick={() => (allowed ? setOpen(true) : setOfferPremium(true))}
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
      <InfoDialog
        open={offerPremium}
        title={ru.miniApp.social.customEmojiPremiumTitle}
        description={ru.miniApp.social.customEmojiPremiumHint}
        closeLabel={ru.miniApp.social.appearanceOpenPremium}
        onClose={() => {
          setOfferPremium(false);
          navigate('/premium');
        }}
      />
    </>
  );
}
