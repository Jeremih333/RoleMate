import {
  useEffect,
  type ButtonHTMLAttributes,
  type HTMLAttributes,
  type PropsWithChildren,
  type ReactNode,
} from 'react';
import { LoaderCircle } from 'lucide-react';
import { ru } from '@rolemate/shared';

export function Card({
  children,
  className = '',
  ...props
}: PropsWithChildren<HTMLAttributes<HTMLDivElement>>) {
  return (
    <div className={`glass-card ${className}`} {...props}>
      {children}
    </div>
  );
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
    <div className="section-title mb-4">
      {eyebrow ? <p className="eyebrow">{eyebrow}</p> : null}
      <div className="section-title-row">
        <h2 className="font-display text-3xl font-semibold tracking-tight">{children}</h2>
        {action ? <div className="section-title-action">{action}</div> : null}
      </div>
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
      {action ? <div className="mt-5 w-full max-w-sm">{action}</div> : null}
      <p className="mt-7 text-xs text-muted">{ru.miniApp.attribution}</p>
    </Card>
  );
}

export function ConfirmDialog({
  open,
  title,
  description,
  confirmLabel,
  cancelLabel,
  loading = false,
  onConfirm,
  onCancel,
}: {
  open: boolean;
  title: string;
  description: string;
  confirmLabel: string;
  cancelLabel: string;
  loading?: boolean;
  onConfirm: () => void;
  onCancel: () => void;
}) {
  useEffect(() => {
    if (!open) return;
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape' && !loading) onCancel();
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [loading, onCancel, open]);
  if (!open) return null;
  return (
    <div
      className="confirm-dialog-backdrop"
      role="presentation"
      onMouseDown={(event) => {
        if (event.currentTarget === event.target && !loading) onCancel();
      }}
    >
      <div
        className="confirm-dialog"
        role="alertdialog"
        aria-modal="true"
        aria-labelledby="confirm-dialog-title"
        aria-describedby="confirm-dialog-description"
      >
        <div className="confirm-dialog-icon" aria-hidden>
          !
        </div>
        <h2 id="confirm-dialog-title">{title}</h2>
        <p id="confirm-dialog-description">{description}</p>
        <div className="confirm-dialog-actions">
          <Button variant="secondary" disabled={loading} onClick={onCancel}>
            {cancelLabel}
          </Button>
          <Button variant="danger" loading={loading} onClick={onConfirm}>
            {confirmLabel}
          </Button>
        </div>
      </div>
    </div>
  );
}

export function InfoDialog({
  open,
  title,
  description,
  closeLabel,
  onClose,
}: {
  open: boolean;
  title: string;
  description: string;
  closeLabel: string;
  onClose: () => void;
}) {
  useEffect(() => {
    if (!open) return;
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [onClose, open]);
  if (!open) return null;
  return (
    <div
      className="confirm-dialog-backdrop"
      role="presentation"
      onMouseDown={(event) => {
        if (event.currentTarget === event.target) onClose();
      }}
    >
      <div
        className="confirm-dialog info-dialog"
        role="dialog"
        aria-modal="true"
        aria-labelledby="info-dialog-title"
        aria-describedby="info-dialog-description"
      >
        <div className="confirm-dialog-icon" aria-hidden>
          i
        </div>
        <h2 id="info-dialog-title">{title}</h2>
        <p id="info-dialog-description" className="info-dialog-value">
          {description}
        </p>
        <div className="confirm-dialog-actions info-dialog-actions">
          <Button onClick={onClose}>{closeLabel}</Button>
        </div>
      </div>
    </div>
  );
}
