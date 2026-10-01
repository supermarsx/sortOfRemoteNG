import type { ConnectionSession } from "../../types/connection/connection";
import type { GlobalSettings } from "../../types/settings/settings";

export type TabFocusSettings = Partial<
  Pick<
    GlobalSettings,
    "openConnectionEditorInBackground" | "openToolInBackground"
  >
>;

/** Missing fields in older settings mean foreground; session preferences stay independent. */
export function shouldFocusNewToolTab(
  session: Pick<ConnectionSession, "protocol" | "openInBackground">,
  settings: TabFocusSettings,
): boolean {
  // Connection sessions and Windows tools retain their existing focus policies.
  if (!session.protocol.startsWith("tool:")) return false;
  if (session.openInBackground !== undefined) return !session.openInBackground;
  const background =
    session.protocol === "tool:connectionEditor" ||
    session.protocol === "tool:bulkEditor"
      ? settings.openConnectionEditorInBackground
      : settings.openToolInBackground;
  return background !== true;
}

/** Convert an explicit background gesture at the opening call site, never globally. */
export function tabOpeningModifier(event: {
  ctrlKey?: boolean;
  metaKey?: boolean;
  shiftKey?: boolean;
  button?: number;
}): boolean | undefined {
  if (event.ctrlKey || event.metaKey || event.button === 1)
    return !event.shiftKey;
  return undefined;
}
