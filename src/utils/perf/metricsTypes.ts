/** Minimal metrics surface the perf core calls. Implemented by ./metrics. */
export interface PerfMetrics {
  /** True when the debug flag is on (localStorage.sorngPerf=1 or ?perf=1). */
  enabled(): boolean;
  /** Add `n` (default 1) to a named counter. No-op when disabled. */
  count(name: string, n?: number): void;
  /** `performance.mark("sorng:<name>")` when enabled. */
  mark(name: string): void;
}

export type PerfLane = "realtime" | "background";
