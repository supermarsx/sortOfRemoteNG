import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { ConnectionDatabase } from "../../types/connection/connection";
import { onCurrentDatabaseChange } from "../../utils/connection/databaseManager";
import {
  readDatabaseSizes,
  type DatabaseSize,
} from "../../utils/connection/databaseSize";

interface SizeSnapshot {
  key: string;
  sizes: Record<string, DatabaseSize>;
  loading: boolean;
}

/** One metadata batch for the entire list, including locked and hidden rows. */
export function useDatabaseSizes(collections: readonly ConnectionDatabase[]) {
  // Compare storage-relevant metadata, not array identity or presentation fields:
  // parent renders, filtering and renames must not start new IPC requests.
  const key = useMemo(
    () =>
      JSON.stringify(
        collections
          .map(
            ({
              id,
              updatedAt,
              isEncrypted,
              protectionFormat,
              securityRevision,
            }) => ({
              id,
              updatedAt,
              isEncrypted,
              protectionFormat,
              securityRevision,
            }),
          )
          .sort((left, right) => left.id.localeCompare(right.id)),
      ),
    [collections],
  );
  const [snapshot, setSnapshot] = useState<SizeSnapshot>({
    key: "",
    sizes: {},
    loading: false,
  });
  const refreshRef = useRef<() => void>(() => {});
  const refresh = useCallback(() => refreshRef.current(), []);

  useEffect(() => {
    const rows: { id: string }[] = JSON.parse(key);
    const ids = [...new Set(rows.map((row) => row.id))];
    let active = true;
    let generation = 0;
    let inFlight = false;
    let queued = false;
    let timer: ReturnType<typeof setTimeout> | undefined;

    const run = async () => {
      if (!active) return;
      if (inFlight) {
        queued = true;
        return;
      }
      queued = false;
      if (ids.length === 0) {
        setSnapshot({ key, sizes: {}, loading: false });
        return;
      }
      inFlight = true;
      const request = ++generation;
      setSnapshot((previous) => ({
        key,
        // Keep the last measurement visible during background reads. Retain
        // only requested IDs; pending/error rows still show their loading state.
        sizes: Object.fromEntries(
          ids
            .filter((id) => previous.sizes[id]?.status === "measured")
            .map((id) => [id, previous.sizes[id]]),
        ),
        loading: true,
      }));
      try {
        const result = await readDatabaseSizes(ids);
        if (!active || request !== generation) return;
        const sizes = Object.fromEntries(
          ids.map((id) => [
            id,
            result[id] ?? {
              status: "unavailable",
              reason: "No size was returned for this database.",
            },
          ]),
        );
        setSnapshot({ key, sizes, loading: false });
      } catch {
        if (!active || request !== generation) return;
        // Unexpected IPC/storage errors can contain private paths or payloads.
        // The utility's per-row reasons are safe; arbitrary thrown text is not.
        const unavailable: DatabaseSize = {
          status: "unavailable",
          reason: "Could not read database sizes. Refresh to retry.",
        };
        setSnapshot({
          key,
          sizes: Object.fromEntries(ids.map((id) => [id, unavailable])),
          loading: false,
        });
      } finally {
        inFlight = false;
        if (active && queued && timer === undefined) void run();
      }
    };

    const refreshNow = () => {
      ++generation;
      clearTimeout(timer);
      timer = undefined;
      void run();
    };
    const scheduleRefresh = () => {
      // Invalidate immediately so an older read cannot win during the delay.
      ++generation;
      if (timer !== undefined) return;
      // Coalesce autosaves without postponing forever during a stream of saves.
      timer = setTimeout(() => {
        timer = undefined;
        void run();
      }, 250);
    };
    refreshRef.current = refreshNow;
    const unsubscribe = onCurrentDatabaseChange(scheduleRefresh);
    window.addEventListener("sorng-database-data-saved", scheduleRefresh);
    window.addEventListener("focus", scheduleRefresh);
    void run();

    return () => {
      active = false;
      ++generation;
      clearTimeout(timer);
      unsubscribe();
      window.removeEventListener("sorng-database-data-saved", scheduleRefresh);
      window.removeEventListener("focus", scheduleRefresh);
      refreshRef.current = () => {};
    };
  }, [key]);

  return {
    sizes: snapshot.key === key ? snapshot.sizes : {},
    loading:
      collections.length > 0 && (snapshot.key !== key || snapshot.loading),
    refresh,
  };
}
