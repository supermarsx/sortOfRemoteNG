import { useLayoutEffect, useState } from "react";

const overlays =
  '[role="dialog"], [role="alertdialog"], [role="menu"], [role="listbox"], .sor-popover-surface, .sor-modal-backdrop';

/** Native children paint above DOM overlays. Observe portals across the shell. */
export function useOriginBrowserOverlays(hide: () => void) {
  const [blocked, setBlocked] = useState(true);
  useLayoutEffect(() => {
    const check = () => {
      const next = Array.from(
        document.querySelectorAll<HTMLElement>(overlays),
      ).some((node) => {
        if (node.closest('[hidden], [aria-hidden="true"], [inert]'))
          return false;
        for (
          let current: HTMLElement | null = node;
          current;
          current = current.parentElement
        ) {
          const style = getComputedStyle(current);
          if (style.display === "none" || style.visibility === "hidden")
            return false;
        }
        return true;
      });
      if (next) hide();
      setBlocked(next);
    };
    const observer = new MutationObserver(check);
    observer.observe(document.body, {
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
    check();
    return () => observer.disconnect();
  }, [hide]);
  return blocked;
}
