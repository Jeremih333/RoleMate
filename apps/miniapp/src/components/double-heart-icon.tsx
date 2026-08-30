import { Heart } from 'lucide-react';

export function DoubleHeartIcon({ className = '' }: { className?: string }) {
  return (
    <span className={`double-heart-icon ${className}`.trim()} aria-hidden="true">
      <Heart />
      <Heart />
    </span>
  );
}
