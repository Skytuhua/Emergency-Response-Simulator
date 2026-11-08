import { useEffect, useId, useRef, type ReactNode } from 'react';
import { X } from 'lucide-react';
import { Button } from '../components/ui/button';

export function SecondaryPanel({ title, children, onClose, fallbackFocusId, className = '', variant = 'drawer' }: {
  title: string; children: ReactNode; onClose: () => void; fallbackFocusId?: string; className?: string; variant?: 'drawer' | 'confirmation';
}) {
  const dialog = useRef<HTMLDialogElement>(null);
  const close = useRef<HTMLButtonElement>(null);
  const titleId = useId();
  useEffect(() => {
    const origin = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    const element = dialog.current;
    if (element && !element.open) element.showModal();
    close.current?.focus();
    return () => {
      if (element?.open) element.close();
      const target = origin?.isConnected ? origin : fallbackFocusId ? document.getElementById(fallbackFocusId) : null;
      target?.focus({ preventScroll: true });
    };
  }, [fallbackFocusId]);
  return <dialog ref={dialog} className={`secondary-panel ${variant === 'confirmation' ? 'confirmation-panel' : 'side-panel'} ${className}`} data-variant={variant} aria-labelledby={titleId}
    onCancel={event => { event.preventDefault(); event.stopPropagation(); onClose(); }}
    onKeyDown={event => { if (event.key === 'Escape') event.stopPropagation(); }}>
    <div className="side-panel-header"><h2 id={titleId}>{title}</h2><Button ref={close} variant="ghost" size="icon" aria-label={`Close ${title}`} onClick={onClose}><X /></Button></div>
    <div className="side-panel-body">{children}</div>
  </dialog>;
}
