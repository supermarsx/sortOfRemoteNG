import { useSyncExternalStore } from "react";
import { reclaimShellFocus } from "../../utils/window/reclaimShellFocus";

/**
 * Security confirmations a native browser tab is waiting on.
 *
 * A native browser is a child window that paints above every shell overlay in
 * its region, so the tab that raised a security prompt stops presenting its
 * native view while the prompt is pending and shows why the page is stalled.
 * Each caller holds a release handle: releasing twice is harmless, and the
 * owner's cleanup releases on any abnormal exit, so a tab is never left hidden.
 */
export type OriginBrowserConfirmationKind =
  "ssh-host-key" | "ssh-command" | "certificate";

interface Hold {
  readonly kind: OriginBrowserConfirmationKind;
}

const holds = new Map<string, Hold[]>();
const listeners = new Set<() => void>();

const notify = () => listeners.forEach((listener) => listener());

/** Marks a confirmation pending for a tab. Returns its idempotent release. */
export function beginOriginBrowserConfirmation(
  sessionId: string,
  kind: OriginBrowserConfirmationKind,
): () => void {
  const hold: Hold = { kind };
  holds.set(sessionId, [...(holds.get(sessionId) ?? []), hold]);
  notify();
  try {
    // The prompt must take keystrokes even if the native page had focus.
    reclaimShellFocus();
  } catch {
    /* Focus is a convenience; the prompt is shown regardless. */
  }
  let released = false;
  return () => {
    if (released) return;
    released = true;
    const rest = (holds.get(sessionId) ?? []).filter((item) => item !== hold);
    if (rest.length) holds.set(sessionId, rest);
    else holds.delete(sessionId);
    notify();
  };
}

/** The most recent pending confirmation of a tab, or null. */
export function getOriginBrowserConfirmation(
  sessionId: string,
): OriginBrowserConfirmationKind | null {
  const list = holds.get(sessionId);
  return list?.length ? list[list.length - 1].kind : null;
}

function subscribe(listener: () => void) {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

export function useOriginBrowserConfirmation(
  sessionId: string,
): OriginBrowserConfirmationKind | null {
  const read = () => getOriginBrowserConfirmation(sessionId);
  return useSyncExternalStore(subscribe, read, read);
}

/** Test seam: drops every hold without notifying. */
export function resetOriginBrowserConfirmationsForTests() {
  holds.clear();
}
