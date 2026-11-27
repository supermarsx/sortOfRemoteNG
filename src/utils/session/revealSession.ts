import type { TabLayout } from "../../types/connection/connection";

export const SESSION_REVEAL_EVENT = "wm:reveal-session";

/** Preserve an existing pane, including the opposite side of a split. Only
 * a session hidden beyond grid capacity needs to replace a visible slot. */
export function revealSessionInLayout(
  layout: TabLayout,
  sessionId: string,
  activeSessionId?: string,
): TabLayout {
  if (layout.mode === "miniMosaic") return { ...layout, mode: "tabs" };
  if (
    layout.mode === "tabs" ||
    layout.sessions.some((slot) => slot.sessionId === sessionId) ||
    !layout.sessions.length
  )
    return layout;
  const activeSlot = layout.sessions.findIndex(
    (slot) => slot.sessionId === activeSessionId,
  );
  const index = activeSlot < 0 ? 0 : activeSlot;
  return {
    ...layout,
    sessions: layout.sessions.map((slot, i) =>
      i === index ? { ...slot, sessionId } : slot,
    ),
  };
}
