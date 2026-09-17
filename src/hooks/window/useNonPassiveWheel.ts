import { useCallback, useEffect, useRef, type RefObject } from "react";

/**
 * Attach a `wheel` listener that is allowed to call `preventDefault()`.
 *
 * React registers its own `wheel` listener on the root container as a *passive*
 * listener, so `preventDefault()` inside a React `onWheel` handler does nothing:
 * the browser logs "Unable to preventDefault inside passive event listener
 * invocation" and scrolls or zooms anyway. A handler that has to suppress the
 * default scroll must therefore be registered natively with `{ passive: false }`.
 *
 * The listener follows `ref.current`, so conditionally mounted elements are
 * picked up on the render that mounts them, and the latest `handler` always
 * runs without re-registering the listener.
 */
export function useNonPassiveWheel<T extends HTMLElement>(
  ref: RefObject<T | null>,
  handler: (event: WheelEvent) => void,
): void {
  const handlerRef = useRef(handler);
  const attachedRef = useRef<T | null>(null);

  useEffect(() => {
    handlerRef.current = handler;
  }, [handler]);

  const listener = useCallback((event: WheelEvent) => {
    handlerRef.current(event);
  }, []);

  // No dependency array on purpose: the element can appear, change or disappear
  // on any render (canvases behind a connection state, a tab strip behind an
  // early return), and only a changed element re-registers the listener.
  useEffect(() => {
    const element = ref.current;
    if (element === attachedRef.current) return;
    attachedRef.current?.removeEventListener("wheel", listener);
    attachedRef.current = element;
    element?.addEventListener("wheel", listener, { passive: false });
  });

  useEffect(
    () => () => {
      attachedRef.current?.removeEventListener("wheel", listener);
      attachedRef.current = null;
    },
    [listener],
  );
}
