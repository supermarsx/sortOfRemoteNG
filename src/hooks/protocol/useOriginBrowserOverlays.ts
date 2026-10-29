import { useCallback, useLayoutEffect, useRef, useState } from "react";
import {
  originBrowserBounds,
  type OriginBrowserBounds,
} from "../../types/protocols/originBrowser";

/**
 * The one opt-in for shell UI that floats over a native browser region without
 * being a dialog, menu, listbox, tooltip or shared popover/modal surface: put
 * `{...nativeBrowserOcclusion()}` on its outermost box. The sampler then cuts
 * its rectangle out of every visible native view. `"blocking"` also fences
 * native input and focus, as a dialog does; use it for screens that take over
 * the window. Plain notices (toasts, banners) must stay non-blocking.
 */
export const NATIVE_BROWSER_OCCLUSION_ATTRIBUTE =
  "data-native-browser-occlusion";
export function nativeBrowserOcclusion(mode: "clip" | "blocking" = "clip"): {
  "data-native-browser-occlusion": string;
} {
  return {
    [NATIVE_BROWSER_OCCLUSION_ATTRIBUTE]: mode === "blocking" ? "blocking" : "",
  };
}

const overlays =
  '[role="dialog"], [role="alertdialog"], [role="menu"], [role="listbox"], [role="tooltip"], .sor-popover-surface, .sor-modal-backdrop, [data-native-browser-occlusion]';
// Inline failure screens clip retained native content without becoming a dialog.
// Blocking here would hide their viewport ancestor and oscillate their clipping.
const interactiveOverlays =
  '[role="dialog"], [role="alertdialog"], [role="menu"], [role="listbox"], .sor-popover-surface, .sor-modal-backdrop, [data-native-browser-occlusion="blocking"]';
interface OverlayState {
  blocked: boolean;
  rectangles: readonly OriginBrowserBounds[];
}
const inactiveState: OverlayState = { blocked: false, rectangles: [] };

/** Attributes and styles only; an empty layout box is the sampler's to read. */
function shown(node: HTMLElement) {
  if (node.closest('[hidden], [aria-hidden="true"], [inert]')) return false;
  const style = getComputedStyle(node);
  return (
    style.display !== "none" &&
    style.visibility !== "hidden" &&
    style.visibility !== "collapse"
  );
}

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
        if (!shown(node)) continue;
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
        "data-native-browser-occlusion",
      ],
    });
    window.addEventListener("resize", schedule);
    window.addEventListener("scroll", schedule, true);
    // Hover/focus reveals and enter animations move a box through transforms
    // that neither observer reports; sample again when they settle.
    document.addEventListener("transitionend", schedule, true);
    document.addEventListener("animationend", schedule, true);
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
      document.removeEventListener("transitionend", schedule, true);
      document.removeEventListener("animationend", schedule, true);
    };
  }, [active]);
  // Activation must not present an unclipped native child before the layout
  // effect has sampled overlays that appeared while this tab was inactive.
  const pending = active && !state && typeof window !== "undefined";
  const pendingBounds = pending
    ? originBrowserBounds({
        x: 0,
        y: 0,
        width: window.innerWidth,
        height: window.innerHeight,
      })
    : null;
  // Blocking also takes native focus and closes DevTools, so that clip blocks
  // only while an interactive overlay may already be showing. A superset of
  // what the sample can block for the same document.
  const pendingBlocked =
    pending &&
    Array.from(
      document.querySelectorAll<HTMLElement>(interactiveOverlays),
    ).some(shown);
  const presentation = active
    ? (state ?? {
        blocked: pendingBlocked,
        rectangles: pendingBounds ? [pendingBounds] : [],
      })
    : inactiveState;
  return { ...presentation, refresh };
}
