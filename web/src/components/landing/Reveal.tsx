import { motion, useReducedMotion } from 'framer-motion';
import { useEffect, useRef, type ReactNode, type MouseEvent } from 'react';
import Lenis from 'lenis';

// Smooth scroll for the landing (disabled under prefers-reduced-motion).
export function useLenis() {
  const reduce = useReducedMotion();
  useEffect(() => {
    if (reduce) return;
    const lenis = new Lenis({ duration: 1.1, easing: (t: number) => 1 - Math.pow(1 - t, 3) });
    let raf = 0;
    const loop = (time: number) => { lenis.raf(time); raf = requestAnimationFrame(loop); };
    raf = requestAnimationFrame(loop);
    return () => { cancelAnimationFrame(raf); lenis.destroy(); };
  }, [reduce]);
}

// Scroll-triggered reveal: opacity + small rise, once. Reduced-motion → no transform.
export function Reveal({ children, delay = 0, className }: { children: ReactNode; delay?: number; className?: string }) {
  const reduce = useReducedMotion();
  if (reduce) return <div className={className}>{children}</div>;
  return (
    <motion.div
      className={className}
      initial={{ opacity: 0, y: 24 }}
      whileInView={{ opacity: 1, y: 0 }}
      viewport={{ once: true, margin: '-80px' }}
      transition={{ duration: 0.5, ease: [0.23, 1, 0.32, 1], delay }}
    >
      {children}
    </motion.div>
  );
}

// Magnetic hover for the single primary CTA. Reduced-motion → inert.
export function MagneticButton({
  children, onClick, className, ariaLabel,
}: { children: ReactNode; onClick?: () => void; className?: string; ariaLabel?: string }) {
  const reduce = useReducedMotion();
  const ref = useRef<HTMLButtonElement>(null);
  const onMove = (e: MouseEvent<HTMLButtonElement>) => {
    if (reduce || !ref.current) return;
    const r = ref.current.getBoundingClientRect();
    const x = e.clientX - (r.left + r.width / 2);
    const y = e.clientY - (r.top + r.height / 2);
    ref.current.style.transform = `translate(${x * 0.18}px, ${y * 0.18}px)`;
  };
  const onLeave = () => { if (ref.current) ref.current.style.transform = ''; };
  return (
    <button
      ref={ref} onClick={onClick} aria-label={ariaLabel}
      onMouseMove={onMove} onMouseLeave={onLeave}
      className={className}
      style={{ transition: 'transform 0.2s cubic-bezier(0.23,1,0.32,1)' }}
    >
      {children}
    </button>
  );
}
