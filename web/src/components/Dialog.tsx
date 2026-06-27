import { useEffect, useId, useRef, type ReactNode } from 'react';
import { X } from 'lucide-react';

interface DialogProps {
  title: string;
  onClose: () => void;
  children: ReactNode;
  className?: string;
}

const FOCUSABLE = 'a[href],button:not([disabled]),input:not([disabled]),select:not([disabled]),textarea:not([disabled]),[tabindex]:not([tabindex="-1"])';

// Accessible modal: role=dialog + aria-modal + aria-labelledby, focus trap, Escape to
// close, focus restored to the opener, body scroll locked. Settings routes through here;
// AuthModal + RoleDetail apply the same guarantees via the useFocusTrap hook.
export default function Dialog({ title, onClose, children, className }: DialogProps) {
  const panelRef = useRef<HTMLDivElement>(null);
  const titleId = useId();

  useEffect(() => {
    const opener = document.activeElement as HTMLElement | null;
    const panel = panelRef.current;
    const focusables = () => Array.from(panel?.querySelectorAll<HTMLElement>(FOCUSABLE) ?? []);
    (focusables()[0] ?? panel)?.focus();

    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') { onClose(); return; }
      if (e.key === 'Tab') {
        const list = focusables();
        if (list.length === 0) return;
        const idx = list.indexOf(document.activeElement as HTMLElement);
        if (e.shiftKey && idx <= 0) { e.preventDefault(); list[list.length - 1].focus(); }
        else if (!e.shiftKey && idx === list.length - 1) { e.preventDefault(); list[0].focus(); }
      }
    };
    document.addEventListener('keydown', onKey);
    const prevOverflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    return () => {
      document.removeEventListener('keydown', onKey);
      document.body.style.overflow = prevOverflow;
      opener?.focus?.();
    };
  }, [onClose]);

  return (
    <div className="fixed inset-0 z-[100] flex items-center justify-center p-4" role="dialog" aria-modal="true" aria-labelledby={titleId}>
      <div className="absolute inset-0 bg-overlay backdrop-blur-sm" onClick={onClose} />
      <div ref={panelRef} tabIndex={-1} className={`relative max-h-[85vh] w-full overflow-y-auto rounded-2xl border border-hairline-strong bg-surface p-7 text-ink shadow-md outline-none ${className ?? 'max-w-lg'}`}>
        <div className="mb-5 flex items-start justify-between gap-4">
          <h2 id={titleId} className="font-display text-xl font-semibold tracking-tight">{title}</h2>
          <button onClick={onClose} aria-label="Close" className="-mr-2 -mt-2 flex h-11 w-11 shrink-0 items-center justify-center rounded-full text-ink-muted hover:text-ink focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent">
            <X size={20} />
          </button>
        </div>
        {children}
      </div>
    </div>
  );
}
