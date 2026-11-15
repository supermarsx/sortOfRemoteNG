/**
 * Framework-free coalescing buffer for high-rate log/event streams.
 *
 * Producers call `push` per entry (cheap, no allocation beyond the array
 * push). Entries are handed to `onFlush` in ONE call per interval, in arrival
 * order, so a consumer performs one state update per flush instead of one per
 * entry. While `isPaused()` is true entries keep buffering (bounded by `cap`,
 * oldest dropped first) and nothing is flushed until `resume()`/`flush()`.
 */
export interface BatchedLogBufferOptions<T> {
  /** Receives the pending batch (oldest first). Never called with an empty batch. */
  onFlush: (batch: T[], dropped: number) => void;
  /** Flush cadence in ms. Defaults to 150. */
  flushMs?: number;
  /** Max entries held between flushes; oldest are dropped. Defaults to 5000. */
  cap?: number;
  /** When true, entries are buffered but no flush is scheduled. */
  isPaused?: () => boolean;
}

export interface BatchedLogBuffer<T> {
  push: (...entries: T[]) => void;
  /** Flush now (ignores pause: used for resume and unmount). */
  flush: () => void;
  /** Re-evaluate pause state; schedules a flush if entries are waiting. */
  resume: () => void;
  /** Drop pending entries without flushing. */
  clear: () => void;
  /** Flush what is pending and stop scheduling. */
  dispose: () => void;
  readonly pending: number;
}

export const DEFAULT_LOG_FLUSH_MS = 150;
export const DEFAULT_LOG_CAP = 5000;

export function createBatchedLogBuffer<T>(
  options: BatchedLogBufferOptions<T>,
): BatchedLogBuffer<T> {
  const flushMs = () => Math.max(0, options.flushMs ?? DEFAULT_LOG_FLUSH_MS);
  const cap = () => Math.max(1, options.cap ?? DEFAULT_LOG_CAP);
  let queue: T[] = [];
  let dropped = 0;
  let timer: ReturnType<typeof setTimeout> | undefined;
  let disposed = false;

  const flush = () => {
    if (timer !== undefined) {
      clearTimeout(timer);
      timer = undefined;
    }
    if (!queue.length && !dropped) return;
    const batch = queue;
    const lost = dropped;
    queue = [];
    dropped = 0;
    if (batch.length) options.onFlush(batch, lost);
  };
  const schedule = () => {
    if (disposed || timer !== undefined || !queue.length) return;
    if (options.isPaused?.()) return;
    timer = setTimeout(() => {
      timer = undefined;
      if (options.isPaused?.()) return;
      flush();
    }, flushMs());
  };
  return {
    push: (...entries) => {
      if (disposed || !entries.length) return;
      for (const entry of entries) queue.push(entry);
      if (queue.length > cap()) {
        const excess = queue.length - cap();
        queue.splice(0, excess);
        dropped += excess;
      }
      schedule();
    },
    flush,
    resume: schedule,
    clear: () => {
      queue = [];
      dropped = 0;
      if (timer !== undefined) clearTimeout(timer);
      timer = undefined;
    },
    dispose: () => {
      flush();
      disposed = true;
    },
    get pending() {
      return queue.length;
    },
  };
}

/** Appends a batch to a bounded list, keeping the newest `cap` entries. */
export function appendCapped<T>(
  previous: readonly T[],
  batch: readonly T[],
  cap: number,
): T[] {
  const total = previous.length + batch.length;
  if (total <= cap) return previous.concat(batch);
  if (batch.length >= cap) return batch.slice(batch.length - cap);
  return previous.slice(total - cap).concat(batch);
}
