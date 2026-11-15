import { useSyncExternalStore } from "react";
import type { Connection } from "../../types/connection/connection";

/**
 * Tiny external store holding the connection whose Arista fan panel is open.
 * Only the connection id/host metadata is kept; credentials are entered or
 * read per call by the dialog and never stored here.
 */
let target: Connection | null = null;
const listeners = new Set<() => void>();

function emit() {
  listeners.forEach((l) => l());
}

export function openAristaFans(connection: Connection): void {
  target = connection;
  emit();
}

export function closeAristaFans(): void {
  if (target === null) return;
  target = null;
  emit();
}

export function useAristaFansTarget(): Connection | null {
  return useSyncExternalStore(
    (cb) => {
      listeners.add(cb);
      return () => {
        listeners.delete(cb);
      };
    },
    () => target,
    () => null,
  );
}

/** Whether the "Arista fan speeds" entry applies to a connection. */
export function supportsAristaFans(connection: Connection): boolean {
  if (connection.isGroup) return false;
  return (
    connection.protocol === "ssh" ||
    connection.protocol === "https" ||
    connection.protocol === "http"
  );
}
