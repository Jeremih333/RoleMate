import type { ButtonHTMLAttributes, PropsWithChildren, ReactNode } from 'react';
import { LoaderCircle } from 'lucide-react';

export function Card({ children, className = '' }: PropsWithChildren<{ className?: string }>) {
  return <div className={`glass-card ${className}`}>{children}</div>;
}

export function Button({
  children,
  className = '',
  variant = 'primary',
  loading = false,
  ...props
}: ButtonHTMLAttributes<HTMLButtonElement> & {
  variant?: 'primary' | 'secondary' | 'danger' | 'ghost';
  loading?: boolean;
}) {
  return (
    <button
      className={`button button-${variant} ${className}`}
      disabled={loading || props.disabled}
      {...props}
    >
      {loading ? <LoaderCircle className="h-4 w-4 animate-spin" /> : children}
    </button>
  );
}

export function SectionTitle({
  eyebrow,
  children,
  action,
}: PropsWithChildren<{ eyebrow?: string; action?: ReactNode }>) {
  return (
    <div className="mb-4 flex items-end justify-between gap-3">
      <div>
        {eyebrow ? <p className="eyebrow">{eyebrow}</p> : null}
        <h2 className="font-display text-3xl font-semibold tracking-tight">{children}</h2>
      </div>
      {action}
    </div>
  );
}

export function Skeleton({ className = '' }: { className?: string }) {
  return <div className={`skeleton ${className}`} aria-hidden />;
}

export function EmptyState({
  icon,
  title,
  description,
  action,
}: {
  icon: ReactNode;
  title: string;
  description: string;
  action?: ReactNode;
}) {
  return (
    <Card className="flex min-h-64 flex-col items-center justify-center p-8 text-center">
      <div className="mb-4 rounded-2xl bg-violet-500/10 p-4 text-lilac">{icon}</div>
      <h3 className="font-display text-2xl font-semibold">{title}</h3>
      <p className="mt-2 max-w-sm text-sm leading-relaxed text-muted">{description}</p>
      {action ? <div className="mt-5">{action}</div> : null}
      <p className="mt-7 text-xs text-muted">При поддержке: @piarchaticksss</p>
    </Card>
  );
}
