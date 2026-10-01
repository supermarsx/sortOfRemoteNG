import { useEffect, useRef } from "react";
import type { ConnectionSession } from "../../types/connection/connection";
import type { TabFocusSettings } from "../../utils/session/tabFocus";
import { shouldFocusNewToolTab } from "../../utils/session/tabFocus";

/**
 * Focus dispatch-only tool openings after their tabs exist in React state.
 * Observe the complete list so a reattach/filter change is never mistaken for
 * a new tab. Existing tabs, connection sessions and Windows tools are untouched.
 */
export function useNewToolTabFocus(
  sessions: readonly ConnectionSession[],
  activate: (id: string) => void,
  getSettings: () => TabFocusSettings,
  windowId = "main",
): void {
  const previousIds = useRef(new Set(sessions.map((session) => session.id)));
  useEffect(() => {
    const added = sessions.filter(
      (session) => !previousIds.current.has(session.id),
    );
    previousIds.current = new Set(sessions.map((session) => session.id));
    const settings = getSettings();
    const matches = added.filter((session) => {
      const owner = session.layout?.isDetached
        ? session.layout.windowId
        : "main";
      return owner === windowId && shouldFocusNewToolTab(session, settings);
    });
    const target = matches[matches.length - 1];
    if (target) activate(target.id);
  }, [sessions, activate, getSettings, windowId]);
}
