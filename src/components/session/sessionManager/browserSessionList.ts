import type { Connection } from "../../../types/connection/connection";
import type {
  NativeBrowserDiagnostics,
  NativeBrowserSessionDiagnostics,
} from "../../../types/network/nativeBrowserDiagnostics";
import type { UnifiedSessionRow } from "../../../hooks/session/useUnifiedSessionManager";

/** Normalized browser-session lifecycle shown in the list and statistics. */
export type BrowserSessionStatus =
  "loading" | "ready" | "closing" | "closed" | "failed" | "error" | "unknown";

export interface BrowserSessionListRow {
  /** Frontend tab id; equals the native identity's sessionId. */
  id: string;
  title: string;
  subtitle: string;
  connectionId?: string;
  status: BrowserSessionStatus;
  failureReason?: string;
  startedAt?: Date;
  lastActivity?: Date;
  /** Present when the tab is open in this window and can be closed. */
  frontendRow?: UnifiedSessionRow;
  /** Live native observation for this tab, when one was reported. */
  native?: NativeBrowserSessionDiagnostics;
}

export const BROWSER_SESSION_STATUS_META: Record<
  BrowserSessionStatus,
  { label: string; tone: "ok" | "warn" | "err" | "muted" }
> = {
  loading: { label: "Loading", tone: "warn" },
  ready: { label: "Ready", tone: "ok" },
  closing: { label: "Closing", tone: "muted" },
  closed: { label: "Closed", tone: "muted" },
  failed: { label: "Failed", tone: "err" },
  error: { label: "Error", tone: "err" },
  unknown: { label: "Unknown", tone: "muted" },
};

export const BROWSER_STATUS_ORDER: BrowserSessionStatus[] = [
  "ready",
  "loading",
  "failed",
  "error",
  "closing",
  "closed",
  "unknown",
];

const BROWSER_PROTOCOLS = new Set(["http", "https"]);

export function isBrowserSessionRow(row: UnifiedSessionRow): boolean {
  return (
    row.source === "frontend" &&
    BROWSER_PROTOCOLS.has((row.protocol ?? "").toLowerCase())
  );
}

function statusFromPhase(
  phase: NativeBrowserSessionDiagnostics["phase"],
): BrowserSessionStatus {
  switch (phase) {
    case "starting":
      return "loading";
    case "attached":
      return "ready";
    case "closing":
      return "closing";
    case "closed":
      return "closed";
    case "failed":
      return "failed";
    default:
      return "unknown";
  }
}

function statusFromFrontend(row: UnifiedSessionRow): BrowserSessionStatus {
  switch (row.status) {
    case "connected":
    case "detached":
      return "ready";
    case "waiting":
      return "loading";
    case "error":
      return "error";
    case "disconnected":
      return "closed";
    default:
      return "unknown";
  }
}

/**
 * One row per browser session: every open HTTP/HTTPS tab, enriched with the
 * native observation that shares its session id, plus native sessions this
 * window reports without a matching tab (so nothing observed is hidden).
 */
export function buildBrowserSessionRows(
  frontendRows: UnifiedSessionRow[],
  diagnostics: NativeBrowserDiagnostics | undefined,
  connections: Connection[],
): BrowserSessionListRow[] {
  const nativeBySession = new Map<string, NativeBrowserSessionDiagnostics>();
  for (const session of diagnostics?.sessions ?? []) {
    nativeBySession.set(session.identity.sessionId, session);
  }
  const rows: BrowserSessionListRow[] = [];
  const seen = new Set<string>();
  for (const row of frontendRows.filter(isBrowserSessionRow)) {
    const native = nativeBySession.get(row.nativeId);
    seen.add(row.nativeId);
    rows.push({
      id: row.nativeId,
      title: row.title,
      subtitle: row.subtitle || row.hostname || row.nativeId,
      connectionId: row.connectionId,
      status:
        native && native.phase !== null
          ? statusFromPhase(native.phase)
          : statusFromFrontend(row),
      failureReason: native?.failureReason
        ? humanizeToken(native.failureReason)
        : row.errorMessage,
      startedAt: row.startedAt,
      lastActivity: row.lastActivity,
      frontendRow: row,
      native,
    });
  }
  const connectionNames = new Map(
    connections.map((connection) => [connection.id, connection.name]),
  );
  for (const native of diagnostics?.sessions ?? []) {
    if (seen.has(native.identity.sessionId)) continue;
    seen.add(native.identity.sessionId);
    rows.push({
      id: native.identity.sessionId,
      title:
        connectionNames.get(native.identity.connectionId) || "Browser session",
      subtitle: native.identity.sessionId,
      connectionId: native.identity.connectionId,
      status: statusFromPhase(native.phase),
      failureReason: native.failureReason
        ? humanizeToken(native.failureReason)
        : undefined,
      native,
    });
  }
  return rows;
}

const NUMBER_FORMAT = new Intl.NumberFormat();
const DATE_FORMAT = new Intl.DateTimeFormat(undefined, {
  dateStyle: "medium",
  timeStyle: "short",
});
const RELATIVE_FORMAT = new Intl.RelativeTimeFormat(undefined, {
  numeric: "auto",
});

/** Placeholder for values the backend did not report. */
export const UNKNOWN_VALUE = "—";

export function formatCount(value: number): string {
  return NUMBER_FORMAT.format(value);
}

export function formatAbsoluteTime(value?: Date): string {
  if (!value || Number.isNaN(value.getTime())) return UNKNOWN_VALUE;
  return DATE_FORMAT.format(value);
}

export function formatRelativeTime(value?: Date, now = Date.now()): string {
  if (!value || Number.isNaN(value.getTime())) return UNKNOWN_VALUE;
  const seconds = Math.round((value.getTime() - now) / 1000);
  const abs = Math.abs(seconds);
  if (abs < 45) return RELATIVE_FORMAT.format(0, "second");
  if (abs < 3600)
    return RELATIVE_FORMAT.format(Math.round(seconds / 60), "minute");
  if (abs < 86_400)
    return RELATIVE_FORMAT.format(Math.round(seconds / 3600), "hour");
  return RELATIVE_FORMAT.format(Math.round(seconds / 86_400), "day");
}

/** Compact duration such as "2h 5m" or "45s". */
export function formatDuration(totalSeconds?: number): string {
  if (
    totalSeconds == null ||
    !Number.isFinite(totalSeconds) ||
    totalSeconds < 0
  )
    return UNKNOWN_VALUE;
  const days = Math.floor(totalSeconds / 86_400);
  const hours = Math.floor((totalSeconds % 86_400) / 3600);
  const minutes = Math.floor((totalSeconds % 3600) / 60);
  const seconds = Math.floor(totalSeconds % 60);
  if (days > 0) return `${days}d ${hours}h`;
  if (hours > 0) return `${hours}h ${minutes}m`;
  if (minutes > 0) return `${minutes}m ${seconds}s`;
  return `${seconds}s`;
}

/** "redirect-denied" -> "Redirect denied". */
export function humanizeToken(value: string): string {
  const spaced = value.replace(/[-_]+/g, " ").trim();
  return spaced.charAt(0).toUpperCase() + spaced.slice(1);
}
