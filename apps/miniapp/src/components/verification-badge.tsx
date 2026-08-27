import { BadgeCheck, Crown } from 'lucide-react';
import { ru } from '@rolemate/shared';
import type { VerificationKind } from '../api.js';

const BADGE_LABELS: Record<VerificationKind, string> = {
  owner: ru.miniApp.social.ownerVerification,
  moderator: ru.miniApp.social.moderatorVerification,
  tester: ru.miniApp.social.testerVerification,
};

export function VerificationBadge({
  kind,
  premium = false,
}: {
  kind?: VerificationKind | null | undefined;
  premium?: boolean | number | null | undefined;
}) {
  if (!kind && !premium) return null;
  const label = kind ? BADGE_LABELS[kind] : '';
  return (
    <span className="verification-badges">
      {premium ? (
        <span className="profile-premium-crown" title={ru.miniApp.social.premiumBadge}>
          <Crown aria-label={ru.miniApp.social.premiumBadge} />
        </span>
      ) : null}
      {kind ? (
        <span className={`verification-badge verification-badge-${kind}`} title={label}>
          {/* The tester mark is custom art. It is painted as a mask so it takes the
              badge colour and stays visible on both the light and dark themes. */}
          {kind === 'tester' ? (
            <i className="tester-badge-glyph" role="img" aria-label={label} />
          ) : (
            <BadgeCheck aria-label={label} />
          )}
        </span>
      ) : null}
    </span>
  );
}
