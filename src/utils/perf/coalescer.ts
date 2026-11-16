/**
 * Background-event coalescers built on createBatchedLogBuffer.
 * Every coalescer is lane "background" only: the name is checked against the
 * lane registry and real-time/unclassified names throw.
 *
 * Errors/terminal-affecting events must NOT use these (deliver them directly
 * or via realtimeChannel). `maxWaitMs` caps latency so nothing starves.
 */
import { createBatchedLogBuffer } from "../runtime/batchedLogBuffer";
import { assertBackgroundEvent } from "./laneRegistry";
import { metrics } from "./metrics";

export interface CoalescerBaseOptions {
  /** Event/feed name; must classify as background. */
  name: string;
  lane: "background";
  /** While true entries buffer (bounded by cap) and no flush fires. */
  paused?: () => boolean;
  /** Max buffered entries (oldest dropped). Default 5000. */
  cap?: number;
  /** Upper bound on added latency. Default = the flush interval. */
  maxWaitMs?: number;
}

export interface Coalescer<T> {
  push: (...values: T[]) => void;
  flush: () => void;
  /** Re-evaluate pause (call when visibility/pause state changes). */
  resume: () => void;
  clear: () => void;
  /** Flush pending and stop. */
  dispose: () => void;
  readonly pending: number;
}

/** One frame at 60 Hz. */
export const FRAME_MS = 16;

function guard(o: CoalescerBaseOptions): void {
  if (o.lane !== "background")
    throw new Error(`[perf] coalescer "${o.name}" must use lane "background"`);
  assertBackgroundEvent(o.name, "coalescer");
}

function make<T>(
  o: CoalescerBaseOptions,
  ms: number,
  onBatch: (batch: T[], dropped: number) => void,
): Coalescer<T> {
  guard(o);
  const flushMs = Math.max(0, Math.min(ms, o.maxWaitMs ?? ms));
  const buf = createBatchedLogBuffer<T>({
    flushMs,
    cap: o.cap,
    isPaused: o.paused,
    onFlush: (batch, dropped) => {
      metrics.count(`coalesce.out:${o.name}`);
      onBatch(batch, dropped);
    },
  });
  return {
    push: (...values) => {
      metrics.count(`coalesce.in:${o.name}`, values.length);
      buf.push(...values);
    },
    flush: buf.flush,
    resume: buf.resume,
    clear: buf.clear,
    dispose: buf.dispose,
    get pending() {
      return buf.pending;
    },
  };
}

/** Flush at most once per frame (~16 ms). Receives all entries since last flush. */
export function createFrameCoalescer<T>(
  o: CoalescerBaseOptions & { onFlush: (batch: T[], dropped: number) => void },
): Coalescer<T> {
  return make<T>(o, FRAME_MS, o.onFlush);
}

/** Flush at most once per `ms`. */
export function createIntervalCoalescer<T>(
  o: CoalescerBaseOptions & {
    ms: number;
    onFlush: (batch: T[], dropped: number) => void;
  },
): Coalescer<T> {
  return make<T>(o, o.ms, o.onFlush);
}

/** State-like events: per flush deliver only the last value for each key (first-seen key order). */
export function createLastWriteWins<T>(
  o: CoalescerBaseOptions & {
    keyOf: (value: T) => string;
    ms?: number;
    onFlush: (latest: T[]) => void;
  },
): Coalescer<T> {
  return make<T>(o, o.ms ?? FRAME_MS, (batch) => {
    const latest = new Map<string, T>();
    for (const v of batch) latest.set(o.keyOf(v), v);
    o.onFlush([...latest.values()]);
  });
}

/** Burst -> one callback with the count (and the last value). */
export function createCountingCoalescer<T = unknown>(
  o: CoalescerBaseOptions & {
    ms?: number;
    onFlush: (count: number, last: T) => void;
  },
): Coalescer<T> {
  return make<T>(o, o.ms ?? FRAME_MS, (batch, dropped) => {
    o.onFlush(batch.length + dropped, batch[batch.length - 1]);
  });
}
