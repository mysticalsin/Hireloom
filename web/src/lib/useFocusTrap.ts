import { useEffect, type RefObject } from 'react';

const FOCUSABLE =
  'a[href],button:not([disabled]),input:not([disabled]),select:not([disabled]),textarea:not([disabled]),[tabindex]:not([tabindex="-1"])';

// Modal a11y: trap Tab within the panel, close on Escape, and restore focus to the
// opener on unmount. Components set their own initial focus (autofocus / a ref).
export function useFocusTrap(ref: RefObject<HTMLElement | null>, onClose: () => void) {
  useEffect(() => {
    const opener = document.activeElement as HTMLElement | null;
    const panel = ref.current;
    const focusables = () => Array.from(panel?.querySelectorAll<HTMLElement>(FOCUSABLE) ?? []);

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
    document.body.style.overflow = 'hidden'; // lock page scroll behind the modal
    return () => {
      document.removeEventListener('keydown', onKey);
      document.body.style.overflow = prevOverflow;
      opener?.focus?.();
    };
  }, [ref, onClose]);
}
