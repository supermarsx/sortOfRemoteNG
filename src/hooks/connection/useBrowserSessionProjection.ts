import { useEffect, useRef } from "react";
import { generateId } from "../../utils/core/id";
import {
  notifyBrowserSessionProjectionChange,
  subscribeBrowserSessionProjectionChanges,
  type BrowserSessionProjectionChange,
} from "../../utils/services/browserSessionProjectionEvents";

export interface BrowserSessionProjectionOwner {
  databaseId: string;
  /** Includes provider generation, manager/profile, target and native unlock lease. */
  assertCurrent(): void;
  isBusy(): boolean;
  currentDescriptor(): unknown;
  /** Verify/advance the target baseline and patch only projection fields. */
  refresh(): Promise<{ changed: boolean }>;
}

/** DatabaseManager alone authenticates native hints via describe. Consume only
 * its verified semantic notifications; do not install a second native listener.
 */
export function useBrowserSessionProjection(
  readyGeneration: number | undefined,
  capture: (databaseId?: string) => BrowserSessionProjectionOwner | null,
): void {
  const latest = useRef(capture);
  latest.current = capture;
  useEffect(() => {
    if (readyGeneration === undefined) return;
    let disposed = false;
    let inFlight = false;
    let publishing = false;
    let queued:
      | {
          owner: BrowserSessionProjectionOwner;
          notification?: BrowserSessionProjectionChange;
        }
      | undefined;
    let timer: ReturnType<typeof setTimeout> | undefined;
    const seen = new Set<string>();
    const arm = (delay = 50) => {
      if (!disposed && !inFlight && queued && timer === undefined)
        timer = setTimeout(() => {
          timer = undefined;
          void refresh();
        }, delay);
    };
    const refresh = async () => {
      const work = queued;
      queued = undefined;
      if (disposed || !work) return;
      const { owner, notification } = work;
      inFlight = true;
      const assertCurrent = () => {
        if (disposed)
          throw new Error("Browser projection listener was disposed.");
        notification?.assertCurrent();
        owner.assertCurrent();
      };
      try {
        assertCurrent();
        if (owner.isBusy()) {
          queued ??= work;
          return;
        }
        const result = await owner.refresh();
        assertCurrent();
        // A catch-up after provider load can discover a missed native event.
        // The target verified the delta; ordinary notifications already reached
        // the scheduler and must never be echoed with a new change ID.
        if (!notification && result.changed) {
          publishing = true;
          notifyBrowserSessionProjectionChange({
            databaseId: owner.databaseId,
            changeId: generateId(),
            assertCurrent: owner.assertCurrent,
          });
        }
      } catch {
        // CAS failures/revoked owners preserve drafts. Never retry errors in a
        // loop or log backend payloads. A subsequent verified change may retry.
      } finally {
        publishing = false;
        inFlight = false;
        arm(250);
      }
    };
    const hint = (notification?: BrowserSessionProjectionChange) => {
      if (
        disposed ||
        publishing ||
        (notification && seen.has(notification.changeId))
      )
        return;
      try {
        notification?.assertCurrent();
        const owner = latest.current(notification?.databaseId);
        if (!owner) return;
        owner.assertCurrent();
        if (notification) {
          seen.add(notification.changeId);
          if (seen.size > 256) seen.delete(seen.values().next().value!);
        }
        queued = { owner, notification };
        arm();
      } catch {
        /* A locked/changed owner is not a fallback grant. */
      }
    };
    const unsubscribe = subscribeBrowserSessionProjectionChanges(hint);
    // Close the load/subscription gap without reloading user-editable rows.
    hint();
    return () => {
      disposed = true;
      queued = undefined;
      if (timer !== undefined) clearTimeout(timer);
      unsubscribe();
    };
  }, [readyGeneration]);
}
