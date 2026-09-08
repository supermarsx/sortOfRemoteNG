import { useLayoutEffect, type KeyboardEvent, type RefObject } from "react";

const focusable = (root: HTMLElement) =>
  Array.from(
    root.querySelectorAll<HTMLElement>(
      "button, input, select, textarea, a[href], [tabindex]",
    ),
  ).filter(
    (node) =>
      node.tabIndex >= 0 &&
      !node.matches(":disabled") &&
      !node.closest('[hidden], [inert], [aria-hidden="true"]') &&
      getComputedStyle(node).display !== "none" &&
      getComputedStyle(node).visibility !== "hidden",
  );

/** Lock-only isolation; shared app modals deliberately retain their normal behavior. */
export function useUnlockIsolation(
  ref: RefObject<HTMLDivElement | null>,
  active: boolean,
) {
  useLayoutEffect(() => {
    const root = ref.current;
    if (!active || !root) return;
    const previousFocus =
      document.activeElement instanceof HTMLElement
        ? document.activeElement
        : null;
    const originals = new Map<
      Element,
      { inert: string | null; hidden: string | null }
    >();
    const focusInside = () => (focusable(root)[0] ?? root).focus();
    const isolate = () => {
      let branch: Element = root;
      while (branch.parentElement) {
        const parent = branch.parentElement;
        for (const sibling of parent.children) {
          if (sibling === branch) continue;
          if (!originals.has(sibling))
            originals.set(sibling, {
              inert: sibling.getAttribute("inert"),
              hidden: sibling.getAttribute("aria-hidden"),
            });
          sibling.setAttribute("inert", "");
          sibling.setAttribute("aria-hidden", "true");
        }
        if (parent === document.body) break;
        branch = parent;
      }
    };
    const blockOutside = (event: Event) => {
      if (event.target instanceof Node && root.contains(event.target)) return;
      event.preventDefault();
      event.stopImmediatePropagation();
      if (event.type === "focusin") focusInside();
    };
    const events = [
      "focusin",
      "pointerdown",
      "mousedown",
      "click",
      "keydown",
      "keyup",
      "keypress",
    ];
    events.forEach((name) => window.addEventListener(name, blockOutside, true));
    if (!root.contains(document.activeElement)) focusInside();
    isolate();
    const observer = new MutationObserver(isolate);
    observer.observe(document.body, { childList: true, subtree: true });
    return () => {
      observer.disconnect();
      events.forEach((name) =>
        window.removeEventListener(name, blockOutside, true),
      );
      for (const [node, original] of originals) {
        if (node.getAttribute("inert") === "") {
          if (original.inert === null) node.removeAttribute("inert");
          else node.setAttribute("inert", original.inert);
        }
        if (node.getAttribute("aria-hidden") === "true") {
          if (original.hidden === null) node.removeAttribute("aria-hidden");
          else node.setAttribute("aria-hidden", original.hidden);
        }
      }
      if (
        previousFocus?.isConnected &&
        !root.contains(previousFocus) &&
        !previousFocus.closest("[inert], [hidden]")
      )
        previousFocus.focus();
    };
  }, [active, ref]);

  return (event: KeyboardEvent<HTMLDivElement>) => {
    // Child React handlers run first (password Enter/recovery Enter); prevent
    // document-level background confirmation, Escape and shortcut handlers.
    event.stopPropagation();
    if (event.type !== "keydown" || event.key !== "Tab") return;
    event.preventDefault();
    const root = ref.current;
    if (!root) return;
    const nodes = focusable(root);
    const index = nodes.indexOf(document.activeElement as HTMLElement);
    const next = event.shiftKey
      ? index <= 0
        ? nodes.length - 1
        : index - 1
      : (index + 1) % nodes.length;
    (nodes[next] ?? root).focus();
  };
}
