import { useEffect, useRef } from 'react';
import type { KeyboardEvent, ReactNode } from 'react';

export function Modal({ titleId, className = '', busy, onClose, children }: {
  titleId: string;
  className?: string;
  busy: boolean;
  onClose(): void;
  children: ReactNode;
}) {
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const previous = document.activeElement;
    ref.current?.focus();
    return () => { if (previous instanceof HTMLElement) previous.focus(); };
  }, []);

  function handleKey(event: KeyboardEvent<HTMLDivElement>) {
    if (event.key === 'Escape') {
      event.stopPropagation();
      if (!busy) onClose();
      return;
    }
    if (event.key !== 'Tab') return;
    const dialog = event.currentTarget;
    const controls = [...dialog.querySelectorAll<HTMLElement>('button, input, textarea, select, summary, a[href], [tabindex]')]
      .filter(element => !element.matches(':disabled') && element.tabIndex >= 0 && element.getClientRects().length > 0);
    const first = controls[0];
    const last = controls.at(-1);
    const active = document.activeElement;
    if (!first || active === dialog || active === (event.shiftKey ? first : last)) {
      event.preventDefault();
      (event.shiftKey ? last : first)?.focus();
    }
  }

  return <div className="modal-backdrop" onMouseDown={event => { if (event.target === event.currentTarget && !busy) onClose(); }}>
    <div className={`modal ${className}`} role="dialog" aria-modal="true" aria-labelledby={titleId}
      tabIndex={-1} ref={ref} onKeyDown={handleKey}>
      {children}
    </div>
  </div>;
}
