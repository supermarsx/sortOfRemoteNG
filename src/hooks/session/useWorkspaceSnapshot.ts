import { useEffect, useRef } from "react";
import type { ConnectionSession } from "../../types/connection/connection";
import { isRestorableConnectionSession } from "../../utils/session/sessionClassification";
import {
  buildWorkspaceSnapshot,
  WorkspaceSnapshotWriter,
  type WorkspaceSnapshotLayout,
} from "../../services/session/workspaceSnapshot";
import { isWorkspaceRestoreBlocked } from "../../utils/safeMode/safeModeState";

interface Options {
  sessions: readonly ConnectionSession[];
  activeSessionId: string | undefined;
  /** Optional tiling mode to record alongside the tabs. */
  getLayout?: () => WorkspaceSnapshotLayout | undefined;
  /** Optional per-tab viewer scroll offsets (kept in memory by the caller). */
  getScroll?: () => Readonly<Record<string, number>> | undefined;
}

/**
 * Keeps the durable workspace snapshot current: debounced writes on every tab
 * change, a synchronous flush when the page is hidden or unloading.
 *
 * An empty tab list is not written until this run has had at least one tab:
 * a booting window must not erase the snapshot the restore step is about to
 * read. After that, closing the last tab does clear it.
 */
export function useWorkspaceSnapshot({
  sessions,
  activeSessionId,
  getLayout,
  getScroll,
}: Options): void {
  const writerRef = useRef<WorkspaceSnapshotWriter | null>(null);
  // Callers pass fresh closures every render; keep them out of effect deps.
  const getLayoutRef = useRef(getLayout);
  getLayoutRef.current = getLayout;
  const getScrollRef = useRef(getScroll);
  getScrollRef.current = getScroll;
  const sawTabsRef = useRef(false);

  useEffect(() => {
    const writer = new WorkspaceSnapshotWriter();
    writerRef.current = writer;
    const flush = () => writer.flush();
    const onVisibility = () => {
      if (document.visibilityState === "hidden") flush();
    };
    window.addEventListener("pagehide", flush);
    document.addEventListener("visibilitychange", onVisibility);
    return () => {
      window.removeEventListener("pagehide", flush);
      document.removeEventListener("visibilitychange", onVisibility);
      writer.flush();
      writer.dispose();
      writerRef.current = null;
    };
  }, []);

  useEffect(() => {
    const writer = writerRef.current;
    if (!writer) return;
    // Safe mode never overwrites the saved workspace snapshot.
    if (isWorkspaceRestoreBlocked()) return;
    const snapshot = buildWorkspaceSnapshot({
      sessions,
      activeSessionId,
      layout: getLayoutRef.current?.(),
      scrollBySession: getScrollRef.current?.(),
      now: Date.now(),
      isRestorable: isRestorableConnectionSession,
    });
    if (snapshot.tabs.length === 0 && !sawTabsRef.current) return;
    if (snapshot.tabs.length > 0) sawTabsRef.current = true;
    writer.schedule(snapshot);
  }, [sessions, activeSessionId]);
}
