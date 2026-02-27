import { useEffect, useRef } from 'react';

/**
 * Scrolls to and highlights a setting element identified by `data-setting-key`.
 * Applies a 2-second blue pulse animation.
 */
export function useSettingHighlight(highlightKey: string | null) {
  const prevKey = useRef<string | null>(null);

  useEffect(() => {
    if (!highlightKey || highlightKey === prevKey.current) return;
    prevKey.current = highlightKey;

    // Small delay to allow the tab content to mount
    const timer = setTimeout(() => {
      const el = document.querySelector(`[data-setting-key="${highlightKey}"]`);
      if (!el) return;

      el.scrollIntoView({ behavior: 'smooth', block: 'center' });

      // Apply highlight animation
      const htmlEl = el as HTMLElement;
      htmlEl.style.transition = 'background-color 0.3s ease';
      htmlEl.style.backgroundColor = 'rgba(59, 130, 246, 0.2)';
      htmlEl.style.borderRadius = '6px';

      setTimeout(() => {
        htmlEl.style.backgroundColor = 'transparent';
        setTimeout(() => {
          htmlEl.style.transition = '';
          htmlEl.style.borderRadius = '';
        }, 300);
      }, 2000);
    }, 100);

    return () => clearTimeout(timer);
  }, [highlightKey]);
}
