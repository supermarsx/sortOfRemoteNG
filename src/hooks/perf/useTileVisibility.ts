import { useCallback, useEffect, useRef, useState } from "react";

/**
 * Tracks which keyed tiles intersect the viewport so background work (e.g.
 * thumbnail capture) can skip tiles nobody can see. Returns `null` (= "all
 * visible") when IntersectionObserver is unavailable, so behaviour never
 * degrades to "nothing captured".
 *
 * `observe(id)` returns a ref callback for the tile element.
 */
export function useTileVisibility(enabled = true): {
  visibleIds: ReadonlySet<string> | null;
  observe: (id: string) => (el: Element | null) => void;
} {
  const supported =
    typeof IntersectionObserver !== "undefined" &&
    typeof window !== "undefined";
  const [visibleIds, setVisibleIds] = useState<ReadonlySet<string>>(
    () => new Set(),
  );
  const observerRef = useRef<IntersectionObserver | null>(null);
  const elementsRef = useRef(new Map<string, Element>());
  const idsRef = useRef(new WeakMap<Element, string>());

  useEffect(() => {
    if (!supported || !enabled) return;
    const observer = new IntersectionObserver((entries) => {
      setVisibleIds((previous) => {
        const next = new Set(previous);
        for (const entry of entries) {
          const id = idsRef.current.get(entry.target);
          if (id === undefined) continue;
          if (entry.isIntersecting) next.add(id);
          else next.delete(id);
        }
        const same =
          next.size === previous.size &&
          [...next].every((i) => previous.has(i));
        return same ? previous : next;
      });
    });
    observerRef.current = observer;
    for (const el of elementsRef.current.values()) observer.observe(el);
    return () => {
      observer.disconnect();
      observerRef.current = null;
    };
  }, [supported, enabled]);

  const refsRef = useRef(new Map<string, (el: Element | null) => void>());
  const observe = useCallback((id: string) => {
    // One stable ref callback per id: an inline ref would detach/attach on
    // every render and re-report visibility each time.
    let ref = refsRef.current.get(id);
    if (!ref) {
      ref = (el: Element | null) => {
        const previous = elementsRef.current.get(id);
        if (el === null) {
          if (previous) {
            observerRef.current?.unobserve(previous);
            elementsRef.current.delete(id);
            setVisibleIds((s) => {
              if (!s.has(id)) return s;
              const n = new Set(s);
              n.delete(id);
              return n;
            });
          }
          return;
        }
        if (previous === el) return;
        if (previous) observerRef.current?.unobserve(previous);
        elementsRef.current.set(id, el);
        idsRef.current.set(el, id);
        observerRef.current?.observe(el);
      };
      refsRef.current.set(id, ref);
    }
    return ref;
  }, []);

  return { visibleIds: supported && enabled ? visibleIds : null, observe };
}
