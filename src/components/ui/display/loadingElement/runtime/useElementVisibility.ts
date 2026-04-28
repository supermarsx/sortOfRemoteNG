import { useEffect, useState, type RefObject } from 'react';

/**
 * Returns whether the element is visible on screen. Used by variants to
 * skip rAF work when off-screen. If `enabled` is false the hook always
 * returns true (caller doesn't want this gating).
 */
export function useElementVisibility(
  ref: RefObject<HTMLElement | null>,
  enabled: boolean,
): boolean {
  const [visible, setVisible] = useState(true);

  useEffect(() => {
    if (!enabled) { setVisible(true); return; }
    const el = ref.current;
    if (!el || typeof IntersectionObserver === 'undefined') return;
    const io = new IntersectionObserver((entries) => {
      for (const e of entries) setVisible(e.isIntersecting);
    }, { threshold: 0.01 });
    io.observe(el);
    return () => io.disconnect();
  }, [ref, enabled]);

  return visible;
}
