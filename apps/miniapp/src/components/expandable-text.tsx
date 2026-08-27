import { useEffect, useLayoutEffect, useRef, useState, type RefObject } from 'react';
import { ru } from '@rolemate/shared';

export function useClampedContent<T extends HTMLElement>(
  contentKey: string,
  collapsed: boolean,
): { contentRef: RefObject<T | null>; wasClamped: boolean } {
  const contentRef = useRef<T>(null);
  const [wasClamped, setWasClamped] = useState(false);

  useEffect(() => setWasClamped(false), [contentKey]);
  useLayoutEffect(() => {
    if (!collapsed) return;
    const element = contentRef.current;
    if (!element) return;
    const measure = () => {
      setWasClamped(element.scrollHeight > element.clientHeight + 1);
    };
    measure();
    const observer = new ResizeObserver(measure);
    observer.observe(element);
    return () => observer.disconnect();
  }, [collapsed, contentKey]);

  return { contentRef, wasClamped };
}

export function ExpandableText({
  text,
  emptyText,
  className = '',
  lines = 3,
  collapseOnContentClick = false,
}: {
  text: string;
  emptyText?: string;
  className?: string;
  lines?: 1 | 2 | 3 | 4;
  collapseOnContentClick?: boolean;
}) {
  const [expanded, setExpanded] = useState(false);
  const value = text || emptyText || '';
  const { contentRef, wasClamped } = useClampedContent<HTMLParagraphElement>(value, !expanded);

  return (
    <div className="expandable-text">
      <p
        ref={contentRef}
        className={`${className} ${expanded ? '' : `expandable-text-lines-${lines}`}`}
        role={expanded && collapseOnContentClick ? 'button' : undefined}
        tabIndex={expanded && collapseOnContentClick ? 0 : undefined}
        onClick={() => {
          if (expanded && collapseOnContentClick) setExpanded(false);
        }}
        onKeyDown={(event) => {
          if (!expanded || !collapseOnContentClick) return;
          if (event.key !== 'Enter' && event.key !== ' ') return;
          event.preventDefault();
          setExpanded(false);
        }}
      >
        {value}
      </p>
      {wasClamped ? (
        <button
          className="profile-bio-more"
          type="button"
          aria-expanded={expanded}
          onClick={() => setExpanded((valueExpanded) => !valueExpanded)}
        >
          {expanded ? ru.miniApp.social.collapseBio : ru.miniApp.social.expandBio}
        </button>
      ) : null}
    </div>
  );
}
