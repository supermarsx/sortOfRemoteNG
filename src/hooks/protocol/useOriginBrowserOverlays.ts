import { useCallback, useLayoutEffect, useRef, useState } from "react";
import {
  originBrowserBounds,
  type OriginBrowserBounds,
} from "../../types/protocols/originBrowser";

const overlays =
  '[role="dialog"], [role="alertdialog"], [role="menu"], [role="listbox"], [role="tooltip"], .sor-popover-surface, .sor-modal-backdrop';
const interactiveOverlays =
  '[role="dialog"], [role="alertdialog"], [role="menu"], [role="listbox"], .sor-popover-surface, .sor-modal-backdrop';
interface OverlayState {
  blocked: boolean;
  rectangles: readonly OriginBrowserBounds[];
}
const inactiveState: OverlayState = { blocked: false, rectangles: [] };

/** Cut out actual shell overlay rectangles instead of unmapping the browser. */
export function useOriginBrowserOverlays(active: boolean) {
  const [state, setState] = useState<OverlayState | null>(null);
  const refreshRef = useRef<() => void>(() => {});
  const refresh = useCallback(() => refreshRef.current(), []);
  useLayoutEffect(() => {
    if (!active) {
      setState(null);
      return;
    }
    let frame: number | undefined;
    let disposed = false;
    const observed = new Set<HTMLElement>();
    const check = () => {
      frame = undefined;
      if (disposed) return;
      const nodes = Array.from(
        document.querySelectorAll<HTMLElement>(overlays),
      );
      const current = new Set(nodes);
      for (const node of observed)
        if (!current.has(node)) {
          resize.unobserve(node);
          observed.delete(node);
        }
      const rectangles: OriginBrowserBounds[] = [];
      let blocked = false;
      for (const node of nodes) {
        if (!observed.has(node)) {
          resize.observe(node);
          observed.add(node);
        }
        if (node.closest('[hidden], [aria-hidden="true"], [inert]')) continue;
        const style = getComputedStyle(node);
        if (
          style.display === "none" ||
          style.visibility === "hidden" ||
          style.visibility === "collapse"
        )
          continue;
        // Empty for display:none ancestors; visibility is inherited. Avoid
        // walking every ancestor's styles for every application mutation.
        const box = node.getBoundingClientRect();
        const x = Math.max(0, box.left - 2),
          y = Math.max(0, box.top - 2);
        if (box.width <= 0 || box.height <= 0) continue;
        const rect = originBrowserBounds({
          x,
          y,
          width: Math.min(innerWidth, box.right + 2) - x,
          height: Math.min(innerHeight, box.bottom + 2) - y,
        });
        if (!rect) continue;
        blocked ||= node.matches(interactiveOverlays);
        if (
          !rectangles.some(
            (r) =>
              r.x <= rect.x &&
              r.y <= rect.y &&
              r.x + r.width >= rect.x + rect.width &&
              r.y + r.height >= rect.y + rect.height,
          )
        )
          rectangles.push(rect);
      }
      // Bounded IPC; covering everything is safer than truncating overlays.
      const bounded =
        rectangles.length > 32
          ? [
              originBrowserBounds({
                x: 0,
                y: 0,
                width: innerWidth,
                height: innerHeight,
              }),
            ].filter((r): r is OriginBrowserBounds => !!r)
          : rectangles;
      setState((previous) =>
        previous?.blocked === blocked &&
        JSON.stringify(previous.rectangles) === JSON.stringify(bounded)
          ? previous
          : { blocked, rectangles: bounded },
      );
    };
    const schedule = () => {
      if (frame === undefined && !disposed)
        frame = requestAnimationFrame(check);
    };
    const resize = new ResizeObserver(schedule);
    const mutation = new MutationObserver(schedule);
    mutation.observe(document.body, {
      childList: true,
      subtree: true,
      attributes: true,
      attributeFilter: [
        "class",
        "style",
        "hidden",
        "aria-hidden",
        "inert",
        "role",
      ],
    });
    window.addEventListener("resize", schedule);
    window.addEventListener("scroll", schedule, true);
    refreshRef.current = schedule;
    check();
    return () => {
      disposed = true;
      if (frame !== undefined) cancelAnimationFrame(frame);
      refreshRef.current = () => {};
      mutation.disconnect();
      resize.disconnect();
      window.removeEventListener("resize", schedule);
      window.removeEventListener("scroll", schedule, true);
    };
  }, [active]);
  // Activation must not present an unclipped native child before the layout
  // effect has sampled overlays that appeared while this tab was inactive.
  const pendingBounds =
    active && !state && typeof window !== "undefined"
      ? originBrowserBounds({
          x: 0,
          y: 0,
          width: window.innerWidth,
          height: window.innerHeight,
        })
      : null;
  const presentation = active
    ? (state ?? {
        blocked: true,
        rectangles: pendingBounds ? [pendingBounds] : [],
      })
    : inactiveState;
  return { ...presentation, refresh };
}
