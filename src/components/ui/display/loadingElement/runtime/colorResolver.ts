import { useEffect, useState } from 'react';

/**
 * Reads --color-accent (with --color-primary fallback) from <body> live.
 * Re-reads when ThemeManager mutates body styles. Returns the resolved
 * color string the loading element should use as its accent.
 */
export function useAccentColor(fallback: string): string {
  const [color, setColor] = useState<string>(() => readAccent(fallback));

  useEffect(() => {
    if (typeof document === 'undefined') return;
    const body = document.body;
    const update = () => setColor(readAccent(fallback));
    update();
    // ThemeManager writes the active accent into <body style="--color-accent: …">
    // — observing only the style attribute keeps this hook from running on
    // every unrelated body class flip in the rest of the app.
    const obs = new MutationObserver(update);
    obs.observe(body, { attributes: true, attributeFilter: ['style'] });
    return () => obs.disconnect();
  }, [fallback]);

  return color;
}

function readAccent(fallback: string): string {
  if (typeof getComputedStyle === 'undefined' || typeof document === 'undefined') return fallback;
  const cs = getComputedStyle(document.body);
  const a = cs.getPropertyValue('--color-accent').trim();
  if (a) return a;
  const p = cs.getPropertyValue('--color-primary').trim();
  if (p) return p;
  return fallback;
}
