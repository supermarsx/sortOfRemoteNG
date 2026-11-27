import { useCallback, useEffect, useRef, useState } from "react";
import { scrollElementWithinContainer } from "../../components/connection/editor/scrollWithinContainer";

/** Transient feedback after React commits selection/group expansion. Never
 * remount a viewer or move a live session just to draw its highlight. */
export function useSessionRevealFeedback(
  activeSessionId: string | null | undefined,
) {
  const serial = useRef(0);
  const [request, setRequest] = useState<{ id: string; nonce: number } | null>(
    null,
  );
  const reveal = useCallback(
    (id: string) => setRequest({ id, nonce: ++serial.current }),
    [],
  );
  useEffect(() => {
    if (!request || activeSessionId !== request.id) return;
    let secondFrame = 0;
    let timer: ReturnType<typeof setTimeout> | undefined;
    const highlighted: HTMLElement[] = [];
    const animations: Animation[] = [];
    const firstFrame = requestAnimationFrame(() => {
      secondFrame = requestAnimationFrame(() => {
        const tab =
          document.getElementById(`session-tab-${request.id}`) ??
          document.getElementById(`detached-session-tab-${request.id}`);
        if (!tab) return;
        const strip = tab.closest<HTMLElement>(
          '[data-testid="session-tabs-scroll"],[data-session-tab-strip]',
        );
        if (strip)
          scrollElementWithinContainer(strip, tab, { axis: "horizontal" });
        tab.focus({ preventScroll: true });
        const panes = [
          ...document.querySelectorAll<HTMLElement>(
            "[data-session-viewer-state]",
          ),
        ].filter(
          (element) =>
            element.dataset.sessionId === request.id &&
            getComputedStyle(element).visibility !== "hidden" && getComputedStyle(element).display !== "none",
        );
        const reducedMotion = window.matchMedia?.(
          "(prefers-reduced-motion: reduce)",
        ).matches;
        for (const element of [tab, ...panes]) {
          element.dataset.sessionRevealed = String(request.nonce);
          highlighted.push(element);
          if (!reducedMotion && element.animate)
            animations.push(
              element.animate(
                [
                  { boxShadow: "inset 0 0 0 0 transparent" },
                  {
                    boxShadow: "inset 0 0 0 4px var(--color-primary)",
                    offset: 0.3,
                  },
                  { boxShadow: "inset 0 0 0 0 transparent" },
                ],
                { duration: 1100, easing: "ease-out" },
              ),
            );
        }
        timer = setTimeout(
          () =>
            highlighted.forEach((element) => {
              if (element.dataset.sessionRevealed === String(request.nonce))
                delete element.dataset.sessionRevealed;
            }),
          1200,
        );
      });
    });
    return () => {
      cancelAnimationFrame(firstFrame);
      cancelAnimationFrame(secondFrame);
      if (timer) clearTimeout(timer);
      animations.forEach((animation) => animation.cancel());
      highlighted.forEach((element) => {
        if (element.dataset.sessionRevealed === String(request.nonce))
          delete element.dataset.sessionRevealed;
      });
    };
  }, [request, activeSessionId]);
  return reveal;
}
