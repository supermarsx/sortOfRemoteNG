import type { ConnectionSession } from "../../types/connection/connection";
import { SettingsManager } from "../settings/settingsManager";
import { shouldFocusNewToolTab } from "./tabFocus";

/** Read the current preference at opening time, including from stable toolbar callbacks. */
export function activateNewToolTab(
  session: ConnectionSession,
  activate?: (id: string) => void,
): void {
  if (
    activate &&
    shouldFocusNewToolTab(session, SettingsManager.getInstance().getSettings())
  )
    activate(session.id);
}
