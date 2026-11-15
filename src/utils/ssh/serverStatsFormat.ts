// Formatting helpers for the server stats views. Missing / non-finite input
// always renders as the em dash placeholder: we never invent numbers.

export const MISSING = "—";

export function isNum(v: unknown): v is number {
  return typeof v === "number" && Number.isFinite(v);
}

export function formatBytes(
  bytes: number | null | undefined,
  digits = 1,
): string {
  if (!isNum(bytes) || bytes < 0) return MISSING;
  if (bytes < 1024) return `${Math.round(bytes)} B`;
  const units = ["KB", "MB", "GB", "TB", "PB"];
  let v = bytes / 1024;
  let i = 0;
  while (v >= 1024 && i < units.length - 1) {
    v /= 1024;
    i++;
  }
  return `${v.toFixed(digits)} ${units[i]}`;
}

export function formatRate(bytesPerSec: number | null | undefined): string {
  const s = formatBytes(bytesPerSec);
  return s === MISSING ? s : `${s}/s`;
}

export function formatPercent(
  pct: number | null | undefined,
  digits = 1,
): string {
  if (!isNum(pct)) return MISSING;
  return `${pct.toFixed(digits)}%`;
}

export function formatLoad(load: number | null | undefined): string {
  if (!isNum(load) || load < 0) return MISSING;
  return load.toFixed(2);
}

export function formatCount(n: number | null | undefined): string {
  if (!isNum(n) || n < 0) return MISSING;
  return String(Math.round(n));
}

/** 93784 -> "1d 2h", 3700 -> "1h 1m", 59 -> "59s". */
export function formatUptime(seconds: number | null | undefined): string {
  if (!isNum(seconds) || seconds < 0) return MISSING;
  const s = Math.floor(seconds);
  const d = Math.floor(s / 86400);
  const h = Math.floor((s % 86400) / 3600);
  const m = Math.floor((s % 3600) / 60);
  if (d > 0) return `${d}d ${h}h`;
  if (h > 0) return `${h}h ${m}m`;
  if (m > 0) return `${m}m`;
  return `${s}s`;
}

/** Age in ms -> "12s ago". */
export function formatAge(ms: number | null | undefined): string {
  if (!isNum(ms) || ms < 0) return MISSING;
  const s = Math.round(ms / 1000);
  if (s < 5) return "just now";
  if (s < 60) return `${s}s ago`;
  const m = Math.floor(s / 60);
  if (m < 60) return `${m}m ago`;
  return `${Math.floor(m / 60)}h ago`;
}

export type UsageTone = "ok" | "warn" | "crit" | "none";

export function usageTone(pct: number | null | undefined): UsageTone {
  if (!isNum(pct)) return "none";
  if (pct >= 90) return "crit";
  if (pct >= 70) return "warn";
  return "ok";
}

/** Clamp a percentage into 0..100 for bar widths. */
export function clampPercent(pct: number | null | undefined): number {
  return isNum(pct) ? Math.min(100, Math.max(0, pct)) : 0;
}
