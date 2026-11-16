/**
 * Perf-core metrics. Everything is a no-op unless the debug flag is on:
 * `localStorage.sorngPerf = "1"`, `?perf=1` in the URL, or
 * `globalThis.__SORNG_PERF__ = true`. Console access: `window.__sorngPerf`.
 */
import type { PerfMetrics } from "./metricsTypes";

let flag: boolean | undefined;
const counters = new Map<string, number>();
const scopes = new Map<string, Map<string, number>>();
const activeScopes = new Set<string>();
const cacheSizers = new Map<string, () => number>();

function detect(): boolean {
  try {
    const g = globalThis as { __SORNG_PERF__?: boolean };
    if (g.__SORNG_PERF__) return true;
    if (globalThis.localStorage?.getItem("sorngPerf") === "1") return true;
    const search = globalThis.location?.search;
    if (search && /[?&]perf=1(&|$)/.test(search)) return true;
  } catch {
    /* storage may be blocked */
  }
  return false;
}

export function perfEnabled(): boolean {
  if (flag === undefined) flag = detect();
  return flag;
}

/** Force the flag (tests, overlay toggle). Pass undefined to re-detect. */
export function setPerfEnabled(value: boolean | undefined): void {
  flag = value;
  if (value) installConsole();
}

export function perfCount(name: string, n = 1): void {
  if (!perfEnabled()) return;
  counters.set(name, (counters.get(name) ?? 0) + n);
  for (const scope of activeScopes) {
    const bucket = scopes.get(scope);
    if (bucket) bucket.set(name, (bucket.get(name) ?? 0) + n);
  }
}

export function perfMark(name: string): void {
  if (!perfEnabled() || typeof performance?.mark !== "function") return;
  try {
    performance.mark(`sorng:${name}`);
  } catch {
    /* ignore */
  }
}

/**
 * Count everything between begin and the returned end() under `name`
 * (e.g. beginScope("tab:proxmox") to count invokes per tab open).
 */
export function beginScope(name: string): () => void {
  if (!perfEnabled()) return () => undefined;
  scopes.set(name, new Map());
  activeScopes.add(name);
  perfMark(`scope:${name}:start`);
  return () => {
    activeScopes.delete(name);
    perfMark(`scope:${name}:end`);
  };
}

/** Caches report their live entry count here (used by report().cacheEntries). */
export function registerCacheSizer(name: string, size: () => number): void {
  cacheSizers.set(name, size);
}

export interface PerfReport {
  counters: Record<string, number>;
  scopes: Record<string, Record<string, number>>;
  caches: Record<string, number>;
  cacheEntries: number;
}

export function perfReport(): PerfReport {
  const caches: Record<string, number> = {};
  let total = 0;
  for (const [name, size] of cacheSizers) {
    const n = size();
    caches[name] = n;
    total += n;
  }
  return {
    counters: Object.fromEntries(counters),
    scopes: Object.fromEntries(
      [...scopes].map(([k, v]) => [k, Object.fromEntries(v)]),
    ),
    caches,
    cacheEntries: total,
  };
}

/** console.table of counters; returns the report. */
export function printPerfReport(): PerfReport {
  const report = perfReport();
  if (typeof console !== "undefined") {
    console.table(report.counters);
    console.table(report.caches);
  }
  return report;
}

export function resetPerf(): void {
  counters.clear();
  scopes.clear();
  activeScopes.clear();
}

function installConsole(): void {
  if (typeof window === "undefined") return;
  (window as unknown as Record<string, unknown>).__sorngPerf = {
    report: printPerfReport,
    data: perfReport,
    reset: resetPerf,
  };
}

if (perfEnabled()) installConsole();

export const metrics: PerfMetrics = {
  enabled: perfEnabled,
  count: perfCount,
  mark: perfMark,
};
