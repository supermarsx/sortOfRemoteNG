/**
 * Explicit pass-through for REAL-TIME events. The handler runs synchronously
 * in the caller's tick: no timers, no rAF, no queue, no visibility gating, no
 * dedupe. Real-time files (terminal/serial/telnet/RDP) may import ONLY this
 * module from src/utils/perf (a static guard test enforces it), so this file
 * must depend on nothing but the metrics counter.
 */
import { metrics } from "./metrics";

export function realtimeChannel<T>(
  name: string,
  handler: (payload: T) => void,
): (payload: T) => void {
  return (payload: T) => {
    metrics.count(`rt:${name}`);
    handler(payload);
  };
}
