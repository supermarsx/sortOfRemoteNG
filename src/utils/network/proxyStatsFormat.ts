import type {
  NativeBrowserSessionDiagnostics,
  NativeProxyDiagnostics,
} from "../../types/network/nativeBrowserDiagnostics";

/** Compact count: 1,234 -> "1.2K", 1_500_000 -> "1.5M". Small values stay exact. */
export function formatCount(value: number): string {
  if (!Number.isFinite(value) || value < 0) return "0";
  if (value < 10_000) return Math.trunc(value).toLocaleString("en-US");
  if (value < 1_000_000) return `${trimFixed(value / 1_000)}K`;
  if (value < 1_000_000_000) return `${trimFixed(value / 1_000_000)}M`;
  return `${trimFixed(value / 1_000_000_000)}B`;
}

function trimFixed(n: number): string {
  return n.toFixed(1).replace(/\.0$/, "");
}

/** Percentage of part/total, or null when total is zero (never invent 0%). */
export function formatPercent(part: number, total: number): string | null {
  if (!(total > 0)) return null;
  const pct = (part / total) * 100;
  return `${pct >= 10 || pct === 0 ? pct.toFixed(0) : pct.toFixed(1)}%`;
}

export const problemFields = [
  "destinationDenials",
  "upstreamFailures",
  "requestRejections",
  "capacityRefusals",
] as const;

export const trafficFields = [
  "acceptedConnections",
  "authenticatedRequests",
  "authenticationChallenges",
] as const;

export function problemTotal(proxy: NativeProxyDiagnostics): number {
  return problemFields.reduce((sum, f) => sum + proxy[f], 0);
}

export interface NativeProxyTotals {
  /** Sessions in the snapshot. */
  sessions: number;
  /** Sessions whose relay snapshot was available. */
  observed: number;
  listening: number;
  /** Relay in a state that needs attention (listener-failed / task-ended). */
  faulted: number;
  acceptedConnections: number;
  authenticatedRequests: number;
  authenticationChallenges: number;
  problems: number;
}

/** Aggregate only the sessions that supplied a relay snapshot. */
export function summarizeNativeProxy(
  sessions: readonly NativeBrowserSessionDiagnostics[],
): NativeProxyTotals {
  const totals: NativeProxyTotals = {
    sessions: sessions.length,
    observed: 0,
    listening: 0,
    faulted: 0,
    acceptedConnections: 0,
    authenticatedRequests: 0,
    authenticationChallenges: 0,
    problems: 0,
  };
  for (const s of sessions) {
    const p = s.proxy;
    if (!p) continue;
    totals.observed += 1;
    if (p.state === "listening") totals.listening += 1;
    if (p.state === "listener-failed" || p.state === "task-ended")
      totals.faulted += 1;
    totals.acceptedConnections += p.acceptedConnections;
    totals.authenticatedRequests += p.authenticatedRequests;
    totals.authenticationChallenges += p.authenticationChallenges;
    totals.problems += problemTotal(p);
  }
  return totals;
}

export type StatsTone = "ok" | "warn" | "err" | "muted";

export function relayStateTone(
  state: NativeProxyDiagnostics["state"],
): StatsTone {
  if (state === "listening") return "ok";
  if (state === "revoking" || state === "stopped") return "muted";
  return "err";
}
