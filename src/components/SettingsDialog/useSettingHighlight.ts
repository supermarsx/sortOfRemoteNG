import { useEffect, useRef } from "react";

/** `data-testid` applied to the element while it is highlighted. */
export const SETTINGS_SEARCH_HIGHLIGHT_TESTID = "settings-search-highlight";

/** Duration of the highlight tint, in ms. */
const HIGHLIGHT_MS = 2000;

export interface SettingHighlightOptions {
  /**
   * Called when no `[data-setting-key]` anchor exists for the key — i.e. the
   * search result navigates nowhere. Used by tests to assert that a result
   * actually resolves to a control.
   */
  onMissingAnchor?: (key: string) => void;
}

/**
 * Scrolls to and highlights a setting element identified by `data-setting-key`.
 * Applies a 2-second blue pulse animation.
 *
 * While highlighted, the element also carries
 * `data-testid="settings-search-highlight"`. Any pre-existing `data-testid` is
 * saved and restored when the highlight ends, so borrowing the attribute cannot
 * permanently rename a control.
 *
 * A missing anchor is a **bug**, not a no-op: it means an index entry names a
 * `settingKey` that no control renders, so clicking the result does nothing.
 * `tests/settings/settingsSearchDrift.test.ts` makes that state unreachable; the
 * warning below is the runtime backstop.
 */
export function useSettingHighlight(
  highlightKey: string | null,
  options: SettingHighlightOptions = {},
) {
  const prevKey = useRef<string | null>(null);
  const onMissingAnchorRef = useRef(options.onMissingAnchor);
  onMissingAnchorRef.current = options.onMissingAnchor;

  useEffect(() => {
    if (!highlightKey || highlightKey === prevKey.current) return;
    prevKey.current = highlightKey;

    let clearTestId: (() => void) | null = null;
    const timers: ReturnType<typeof setTimeout>[] = [];

    // Small delay to allow the tab content to mount
    const timer = setTimeout(() => {
      const el = document.querySelector(
        `[data-setting-key="${highlightKey}"]`,
      ) as HTMLElement | null;
      if (!el) {
        console.warn(
          `[settings-search] no anchor for setting key "${highlightKey}" — ` +
            "the search result cannot navigate anywhere",
        );
        onMissingAnchorRef.current?.(highlightKey);
        return;
      }

      const previousTestId = el.getAttribute("data-testid");
      el.setAttribute("data-testid", SETTINGS_SEARCH_HIGHLIGHT_TESTID);
      clearTestId = () => {
        if (el.getAttribute("data-testid") !== SETTINGS_SEARCH_HIGHLIGHT_TESTID)
          return;
        if (previousTestId === null) el.removeAttribute("data-testid");
        else el.setAttribute("data-testid", previousTestId);
      };

      el.scrollIntoView({ behavior: "smooth", block: "center" });

      // Apply highlight animation
      el.style.transition = "background-color 0.3s ease";
      el.style.backgroundColor = "rgba(59, 130, 246, 0.2)";
      el.style.borderRadius = "6px";

      timers.push(
        setTimeout(() => {
          el.style.backgroundColor = "transparent";
          clearTestId?.();
          clearTestId = null;
          timers.push(
            setTimeout(() => {
              el.style.transition = "";
              el.style.borderRadius = "";
            }, 300),
          );
        }, HIGHLIGHT_MS),
      );
    }, 100);

    return () => {
      clearTimeout(timer);
      for (const t of timers) clearTimeout(t);
      clearTestId?.();
    };
  }, [highlightKey]);
}
