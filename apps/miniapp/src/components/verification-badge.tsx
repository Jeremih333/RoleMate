import { BadgeCheck } from 'lucide-react';
import { ru } from '@rolemate/shared';

export function VerificationBadge({ kind }: { kind?: 'owner' | 'moderator' | null | undefined }) {
  if (!kind) return null;
  const label =
    kind === 'owner'
      ? ru.miniApp.social.ownerVerification
      : ru.miniApp.social.moderatorVerification;
  return (
    <span className={`verification-badge verification-badge-${kind}`} title={label}>
      <BadgeCheck aria-label={label} />
    </span>
  );
}
