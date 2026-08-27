import { BadgeCheck, Crown } from 'lucide-react';
import { ru } from '@rolemate/shared';

export function VerificationBadge({
  kind,
  premium = false,
}: {
  kind?: 'owner' | 'moderator' | null | undefined;
  premium?: boolean | number | null | undefined;
}) {
  if (!kind && !premium) return null;
  const label =
    kind === 'owner'
      ? ru.miniApp.social.ownerVerification
      : ru.miniApp.social.moderatorVerification;
  return (
    <span className="verification-badges">
      {premium ? (
        <span className="profile-premium-crown" title={ru.miniApp.social.premiumBadge}>
          <Crown aria-label={ru.miniApp.social.premiumBadge} />
        </span>
      ) : null}
      {kind ? (
        <span className={`verification-badge verification-badge-${kind}`} title={label}>
          <BadgeCheck aria-label={label} />
        </span>
      ) : null}
    </span>
  );
}
