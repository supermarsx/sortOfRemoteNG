import type { NativeBrowserDiagnostics } from "../../types/network/nativeBrowserDiagnostics";
import {
  logProxyEvent,
  redactText,
  type BrowserLogLevel,
  type ProxyLogKind,
} from "./browserEventLog";

const lastCounters = new Map<string, Record<string, number | string>>();
const seenLegacy = new Set<string>();

const COUNTER_EVENTS: {
  field:
    | "acceptedConnections"
    | "authenticationChallenges"
    | "authenticatedRequests"
    | "destinationDenials"
    | "upstreamFailures"
    | "requestRejections"
    | "capacityRefusals";
  kind: ProxyLogKind;
  level: BrowserLogLevel;
  message: string;
}[] = [
  {
    field: "acceptedConnections",
    kind: "connection",
    level: "info",
    message: "Connections accepted",
  },
  {
    field: "authenticationChallenges",
    kind: "auth",
    level: "info",
    message: "Authentication challenges issued",
  },
  {
    field: "authenticatedRequests",
    kind: "auth",
    level: "info",
    message: "Authenticated requests",
  },
  {
    field: "destinationDenials",
    kind: "denied",
    level: "warn",
    message: "Destinations denied",
  },
  {
    field: "upstreamFailures",
    kind: "upstream",
    level: "error",
    message: "Upstream failures",
  },
  {
    field: "requestRejections",
    kind: "denied",
    level: "warn",
    message: "Requests rejected",
  },
  {
    field: "capacityRefusals",
    kind: "capacity",
    level: "warn",
    message: "Capacity refusals",
  },
];

/** Turn CEF relay counter changes into log events. The first sighting of a
 * session only sets the baseline, so reopening the view never replays history. */
export function recordProxyDiagnostics(
  diagnostics: NativeBrowserDiagnostics | undefined,
  at = Date.now(),
): void {
  if (!diagnostics) return;
  for (const session of diagnostics.sessions) {
    const sessionId = session.identity.sessionId;
    const proxy = session.proxy;
    if (!proxy) continue;
    const previous = lastCounters.get(sessionId);
    const next: Record<string, number | string> = { state: proxy.state };
    for (const { field } of COUNTER_EVENTS) next[field] = proxy[field] ?? 0;
    lastCounters.set(sessionId, next);
    if (!previous) continue;
    if (previous.state !== proxy.state)
      logProxyEvent({
        at,
        source: "cef",
        level:
          proxy.state === "listener-failed" || proxy.state === "task-ended"
            ? "error"
            : "info",
        kind: "state",
        message: `Relay ${proxy.state}`,
        sessionId,
      });
    for (const { field, kind, level, message } of COUNTER_EVENTS) {
      const delta = (proxy[field] ?? 0) - Number(previous[field] ?? 0);
      if (delta > 0)
        logProxyEvent({
          at,
          source: "cef",
          level,
          kind,
          message,
          sessionId,
          count: delta,
        });
    }
  }
}

export interface LegacyLogRow {
  id?: string;
  session_id: string;
  method: string;
  url: string;
  status: number;
  error: string | null;
  timestamp: string;
}

export function recordLegacyProxyLog(rows: readonly LegacyLogRow[]): void {
  for (const row of rows) {
    const key =
      row.id || `${row.session_id}|${row.timestamp}|${row.method}|${row.url}`;
    if (seenLegacy.has(key)) continue;
    seenLegacy.add(key);
    if (seenLegacy.size > 5000)
      seenLegacy.delete(seenLegacy.values().next().value as string);
    const at = Date.parse(row.timestamp);
    const kind: ProxyLogKind = row.error
      ? "upstream"
      : row.status === 401 || row.status === 407
        ? "auth"
        : row.status === 403
          ? "denied"
          : "request";
    logProxyEvent({
      at: Number.isFinite(at) ? at : Date.now(),
      source: "legacy",
      level:
        row.error || row.status >= 500
          ? "error"
          : row.status >= 400
            ? "warn"
            : "info",
      kind,
      message: row.error ? redactText(row.error) : `HTTP ${row.status}`,
      sessionId: row.session_id,
      method: row.method,
      url: row.url,
      status: row.status,
    });
  }
}

export function resetProxyRecorderForTests() {
  lastCounters.clear();
  seenLegacy.clear();
}
