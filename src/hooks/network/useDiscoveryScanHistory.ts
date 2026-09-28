"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import {
  clearDiscoveryScans,
  deleteDiscoveryScan,
  listDiscoveryScans,
  normalizeDiscoveryScan,
  normalizeDiscoveryScanName,
  renameDiscoveryScan,
  retainDiscoveryScans,
  saveDiscoveryScan,
  type SavedDiscoveryScan,
} from "../../utils/discovery/scanHistory";

const sessionNotice =
  "Some history changes exist only in memory and are not persisted. Retry saving the affected scan or clear history successfully to reset this state.";

/** Actions reject on failure as well as setting error. Valid failed writes remain
 * usable in this hook's memory until unmount. Reload never discards those scans.
 * The owner must invoke saveScan only once a scan completes, stops, or fails.
 * Explicit mutations finish persistence after unmount; reloads and React state
 * updates remain fenced to the mounted generation.
 */
export function useDiscoveryScanHistory() {
  const [scans, setScans] = useState<SavedDiscoveryScan[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const current = useRef<SavedDiscoveryScan[]>([]);
  const sessionOnly = useRef(false);
  const failedSaves = useRef(new Set<string>());
  const generation = useRef(0);
  const mounted = useRef(false);
  const queue = useRef<Promise<void>>(Promise.resolve());

  const run = useCallback(
    (action: (live: () => boolean) => Promise<void>, mustPersist = false) => {
      const token = generation.current;
      const live = () => mounted.current && generation.current === token;
      const task = queue.current.then(async () => {
        if (!live() && !mustPersist) return;
        if (live()) setLoading(true);
        try {
          await action(live);
          if (live()) {
            setScans(current.current);
            setError(
              sessionOnly.current || failedSaves.current.size > 0
                ? sessionNotice
                : null,
            );
          }
        } catch (cause) {
          if (live()) {
            setScans(current.current);
            setError(
              `${cause instanceof Error ? cause.message : "Discovery history storage failed."}${sessionOnly.current || failedSaves.current.size > 0 ? ` ${sessionNotice}` : ""}`,
            );
          }
          throw cause;
        } finally {
          if (live()) setLoading(false);
        }
      });
      queue.current = task.catch(() => {});
      return task;
    },
    [],
  );

  const reload = useCallback(
    () =>
      run(async (live) => {
        const stored = await listDiscoveryScans();
        if (live() && !sessionOnly.current && failedSaves.current.size === 0)
          current.current = stored;
      }),
    [run],
  );

  const saveScan = useCallback(
    (input: SavedDiscoveryScan) =>
      run(async () => {
        const scan = normalizeDiscoveryScan(input);
        const previousName = current.current.find(
          (item) => item.id === scan.id,
        )?.name;
        if (scan.name === undefined && previousName !== undefined)
          scan.name = previousName;
        const next = retainDiscoveryScans([
          ...current.current.filter((item) => item.id !== scan.id),
          scan,
        ]);
        if (!next.some((item) => item.id === scan.id))
          throw new Error("Snapshot is older than the retained history.");
        try {
          await saveDiscoveryScan(scan);
        } catch (cause) {
          current.current = next;
          failedSaves.current.add(scan.id);
          throw cause;
        }
        failedSaves.current.delete(scan.id);
        current.current = next;
      }, true),
    [run],
  );

  const deleteScan = useCallback(
    (id: string) =>
      run(async () => {
        // Keep a failed deletion visible so it can be retried from History.
        await deleteDiscoveryScan(id);
        failedSaves.current.delete(id);
        current.current = current.current.filter((scan) => scan.id !== id);
      }, true),
    [run],
  );

  const renameScan = useCallback(
    (id: string, input: string) =>
      run(async () => {
        const name = normalizeDiscoveryScanName(input);
        const previous = current.current.find((scan) => scan.id === id);
        if (!previous)
          throw new Error(
            "This saved scan no longer exists. Reload history before editing it.",
          );
        // A session-only snapshot has no durable record yet. Retrying its write
        // is explicit here; ordinary renames never insert an absent stored scan.
        let renamed: SavedDiscoveryScan;
        if (failedSaves.current.has(id)) {
          renamed = normalizeDiscoveryScan({ ...previous, name });
          await saveDiscoveryScan(renamed);
          failedSaves.current.delete(id);
        } else {
          renamed = await renameDiscoveryScan(id, name);
        }
        current.current = current.current.map((scan) =>
          scan.id === id ? renamed : scan,
        );
      }, true),
    [run],
  );

  const clearScans = useCallback(
    () =>
      run(async () => {
        try {
          await clearDiscoveryScans();
          sessionOnly.current = false;
          failedSaves.current.clear();
        } catch (cause) {
          sessionOnly.current = true;
          throw cause;
        } finally {
          current.current = [];
        }
      }, true),
    [run],
  );

  useEffect(() => {
    mounted.current = true;
    void reload().catch(() => {});
    return () => {
      mounted.current = false;
      generation.current += 1;
    };
  }, [reload]);

  return {
    scans,
    loading,
    error,
    saveScan,
    renameScan,
    deleteScan,
    clearScans,
    reload,
  };
}
