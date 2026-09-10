import { useCallback, useContext, useEffect, useRef } from "react";
import { ToastContext } from "../../contexts/ToastContext";
import type { ConnectionDatabase } from "../../types/connection/connection";
import type {
  DatabaseOpenObserver,
  DatabaseOpenStage,
} from "../../types/connection/databaseOpening";

/** One notification follows one captured intent even if its picker unmounts. */
export function useDatabaseOpenNotification() {
  const toast = useContext(ToastContext)?.toast;
  const currentToast = useRef(toast);
  currentToast.current = toast;
  const active = useRef<{
    databaseId: string;
    phase: DatabaseOpenStage;
    notify: DatabaseOpenObserver;
  } | null>(null);
  const begin = useCallback(
    (
      database: Pick<ConnectionDatabase, "id" | "name">,
      phase: DatabaseOpenStage,
    ): DatabaseOpenObserver => {
      if (active.current?.databaseId === database.id) {
        const notify = active.current.notify;
        notify(phase);
        return notify;
      }
      active.current?.notify("cancelled");
      const capturedToast = currentToast.current;
      const name = database.name;
      const id = capturedToast?.loading(`Opening “${name}”…`);
      const entry = {
        databaseId: database.id,
        phase,
        notify: (() => {}) as DatabaseOpenObserver,
      };
      let terminal = false;
      entry.notify = (next) => {
        if (terminal || active.current !== entry) return;
        entry.phase = next;
        const messages: Record<DatabaseOpenStage, string> = {
          "waiting-unlock": `Unlock “${name}” to continue opening…`,
          unlocking: `Unlocking “${name}”…`,
          loading: `Loading and decrypting “${name}”…`,
          success: `Opened “${name}”.`,
          failed: `Could not open “${name}”. Review the database error and retry.`,
          cancelled: `Opening “${name}” was cancelled.`,
          unconfirmed: `Opening “${name}” finished without confirmation. Check the database status.`,
        };
        terminal = ["success", "failed", "cancelled", "unconfirmed"].includes(
          next,
        );
        if (id)
          capturedToast?.update(id, {
            type:
              next === "success"
                ? "success"
                : next === "failed"
                  ? "error"
                  : terminal
                    ? "info"
                    : "loading",
            message: messages[next],
            ...(terminal ? { duration: next === "failed" ? 7000 : 4000 } : {}),
          });
        if (terminal) active.current = null;
      };
      active.current = entry;
      entry.notify(phase);
      return entry.notify;
    },
    [],
  );
  const cancel = useCallback(() => active.current?.notify("cancelled"), []);
  const update = useCallback((databaseId: string, stage: DatabaseOpenStage) => {
    if (active.current?.databaseId === databaseId) active.current.notify(stage);
  }, []);
  useEffect(
    () => () => {
      // An in-flight open settles itself after unmount; closing a password prompt
      // is cancellation, not a spinner left behind or a false successful open.
      if (active.current?.phase === "waiting-unlock")
        active.current.notify("cancelled");
    },
    [],
  );
  return { begin, cancel, update };
}
