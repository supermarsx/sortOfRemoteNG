import { useEffect, useRef } from "react";
import {
  createCountingCoalescer,
  createFrameCoalescer,
  createIntervalCoalescer,
  createLastWriteWins,
  type Coalescer,
} from "../../utils/perf/coalescer";
import { subscribeEvent } from "../../utils/perf/eventBus";
import { assertBackgroundEvent } from "../../utils/perf/laneRegistry";
import { isHidden, subscribeVisibility } from "../../utils/perf/visibility";

export type CoalesceMode<T> =
  | { kind: "frame" }
  | { kind: "interval"; ms: number }
  | { kind: "lastWriteWins"; keyOf: (payload: T) => string; ms?: number }
  | { kind: "count"; ms?: number };

/**
 * Subscribe to a BACKGROUND Tauri event through the shared listener and
 * deliver it coalesced:
 * - frame / interval: handler(batch: T[]) once per flush
 * - lastWriteWins: handler(latestPerKey: T[])
 * - count: handler([lastPayload], count) — `count` is the 2nd argument
 * Throws for real-time/unclassified event names. Buffers while the window is
 * hidden and flushes on return and on unmount.
 */
export function useCoalescedEvent<T>(
  name: string,
  handler: (batch: T[], count: number) => void,
  mode: CoalesceMode<T> = { kind: "frame" },
  enabled = true,
): void {
  assertBackgroundEvent(name, "useCoalescedEvent");
  const handlerRef = useRef(handler);
  handlerRef.current = handler;
  const modeKey = JSON.stringify([mode.kind, (mode as { ms?: number }).ms]);
  const keyOfRef = useRef<((p: T) => string) | undefined>(undefined);
  keyOfRef.current = mode.kind === "lastWriteWins" ? mode.keyOf : undefined;

  useEffect(() => {
    if (!enabled) return;
    const base = {
      name,
      lane: "background" as const,
      paused: isHidden,
    };
    let c: Coalescer<T>;
    switch (mode.kind) {
      case "interval":
        c = createIntervalCoalescer<T>({
          ...base,
          ms: mode.ms,
          onFlush: (b) => handlerRef.current(b, b.length),
        });
        break;
      case "lastWriteWins":
        c = createLastWriteWins<T>({
          ...base,
          ms: mode.ms,
          keyOf: (v) => keyOfRef.current!(v),
          onFlush: (b) => handlerRef.current(b, b.length),
        });
        break;
      case "count":
        c = createCountingCoalescer<T>({
          ...base,
          ms: mode.ms,
          onFlush: (n, last) => handlerRef.current([last], n),
        });
        break;
      default:
        c = createFrameCoalescer<T>({
          ...base,
          onFlush: (b) => handlerRef.current(b, b.length),
        });
    }
    const offEvent = subscribeEvent(name, (p) => c.push(p as T));
    const offVis = subscribeVisibility(() => {
      if (!isHidden()) c.resume();
    });
    return () => {
      offEvent();
      offVis();
      c.dispose();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [name, modeKey, enabled]);
}
