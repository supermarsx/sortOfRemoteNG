import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  appendCapped,
  createBatchedLogBuffer,
  DEFAULT_LOG_CAP,
  DEFAULT_LOG_FLUSH_MS,
} from "../../utils/runtime/batchedLogBuffer";

export interface BatchedLogStreamOptions {
  /** Entries kept in `entries` (ring buffer, newest retained). Default 5000. */
  cap?: number;
  /** Coalescing interval in ms. Default 150. */
  flushMs?: number;
  /** Buffer only (no state updates) while true, e.g. panel hidden. */
  paused?: boolean;
  /** Also buffer while the window/document is hidden. Default true. */
  pauseWhenDocumentHidden?: boolean;
}

const documentHidden = () =>
  typeof document !== "undefined" && document.visibilityState === "hidden";

/**
 * Reusable live-log pipeline: `push` per entry from any event source; React
 * state is updated at most once per `flushMs` with the whole batch appended
 * (order preserved, capped). While paused or the window is hidden, entries are
 * buffered (also capped) and published in one update on resume. Pending
 * entries are flushed to the buffer owner on unmount without touching state.
 */
export function useBatchedLogStream<T>(options: BatchedLogStreamOptions = {}) {
  const {
    cap = DEFAULT_LOG_CAP,
    flushMs = DEFAULT_LOG_FLUSH_MS,
    paused = false,
    pauseWhenDocumentHidden = true,
  } = options;
  const [entries, setEntries] = useState<T[]>([]);
  const [dropped, setDropped] = useState(0);
  const pausedRef = useRef(paused);
  pausedRef.current = paused;
  const hiddenAware = useRef(pauseWhenDocumentHidden);
  hiddenAware.current = pauseWhenDocumentHidden;
  const alive = useRef(true);
  const capRef = useRef(cap);
  capRef.current = cap;
  const flushRef = useRef(flushMs);
  flushRef.current = flushMs;

  const buffer = useMemo(
    () =>
      createBatchedLogBuffer<T>({
        get cap() {
          return capRef.current;
        },
        get flushMs() {
          return flushRef.current;
        },
        isPaused: () =>
          pausedRef.current || (hiddenAware.current && documentHidden()),
        onFlush: (batch, lost) => {
          if (!alive.current) return;
          setEntries((previous) =>
            appendCapped(previous, batch, capRef.current),
          );
          if (lost) setDropped((previous) => previous + lost);
        },
      }),
    [],
  );

  useEffect(() => {
    alive.current = true;
    const onVisibility = () => {
      if (!documentHidden()) buffer.resume();
    };
    document.addEventListener("visibilitychange", onVisibility);
    return () => {
      document.removeEventListener("visibilitychange", onVisibility);
      alive.current = false;
      buffer.dispose();
    };
  }, [buffer]);

  useEffect(() => {
    if (!paused) buffer.resume();
  }, [paused, buffer]);

  const clear = useCallback(() => {
    buffer.clear();
    setEntries([]);
    setDropped(0);
  }, [buffer]);

  return {
    entries,
    /** Pending entries discarded by the cap before they were published. */
    dropped,
    push: buffer.push,
    flush: buffer.flush,
    clear,
    get pending() {
      return buffer.pending;
    },
  };
}
