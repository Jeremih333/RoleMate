import { useEffect, type ReactNode } from 'react';
import { createPortal } from 'react-dom';
import { X } from 'lucide-react';
import { ru } from '@rolemate/shared';

/**
 * A full-screen editor, the way Threads and X open one.
 *
 * Editing a post used to unfold a panel inside the card: the feed jumped, the
 * post being edited scrolled away under the fields, and every setting was laid
 * out at once with no sense of what mattered. An editor is a place you go to and
 * come back from — the writing fills the screen, and the two things that finish
 * it, saving and leaving, sit still at the bottom where a thumb reaches them.
 */
export function EditorSheet({
  title,
  onClose,
  footer,
  children,
}: {
  title: string;
  onClose: () => void;
  footer: ReactNode;
  children: ReactNode;
}) {
  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') onClose();
    };
    document.addEventListener('keydown', onKeyDown);
    // The page behind must not scroll under an open editor.
    const previous = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    return () => {
      document.removeEventListener('keydown', onKeyDown);
      document.body.style.overflow = previous;
    };
  }, [onClose]);

  return createPortal(
    <div className="editor-sheet-backdrop" role="presentation" onMouseDown={onClose}>
      <section
        className="editor-sheet"
        role="dialog"
        aria-modal="true"
        aria-label={title}
        onMouseDown={(event) => event.stopPropagation()}
      >
        <header className="editor-sheet-header">
          <strong>{title}</strong>
          <button type="button" aria-label={ru.miniApp.dialogs.cancel} onClick={onClose}>
            <X aria-hidden />
          </button>
        </header>
        <div className="editor-sheet-body">{children}</div>
        <footer className="editor-sheet-footer">{footer}</footer>
      </section>
    </div>,
    document.body,
  );
}

/**
 * The parts of an editor that are not the writing itself — a title, tags, a
 * playlist name. Threads keeps them out of the way behind one line you open when
 * you want them, rather than in front of everyone who only wants to fix a typo.
 */
export function EditorExtras({
  label,
  hint,
  open,
  onToggle,
  children,
}: {
  label: string;
  hint?: string;
  open: boolean;
  onToggle: () => void;
  children: ReactNode;
}) {
  return (
    <div className="editor-extras">
      <button
        type="button"
        className="editor-extras-toggle"
        aria-expanded={open}
        onClick={onToggle}
      >
        <span>{label}</span>
        <i aria-hidden className={open ? 'is-open' : ''} />
      </button>
      {open ? (
        <div className="editor-extras-body">
          {hint ? <p className="text-xs text-muted">{hint}</p> : null}
          {children}
        </div>
      ) : null}
    </div>
  );
}
