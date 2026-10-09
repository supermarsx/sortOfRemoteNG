import {
  originBrowserFailureReason,
  type OriginBrowserFailureReason,
  type OriginBrowserSnapshot,
} from "../protocols/originBrowser";

export interface NativeProxyDiagnostics {
  state:
    "listening" | "revoking" | "stopped" | "listener-failed" | "task-ended";
  acceptedConnections: number;
  authenticationChallenges: number;
  authenticatedRequests: number;
  destinationDenials: number;
  upstreamFailures: number;
  requestRejections: number;
  capacityRefusals: number;
}

export interface NativeBrowserSessionDiagnostics {
  identity: { connectionId: string; sessionId: string; attemptId: string };
  /** Null means the native snapshot was busy, not an inferred phase. */
  phase: OriginBrowserSnapshot["phase"] | null;
  failureReason?: OriginBrowserFailureReason | "redirect-denied";
  /** Null means no nonblocking relay snapshot was available. */
  proxy: NativeProxyDiagnostics | null;
}

export interface NativeBrowserDiagnostics {
  /** Compiled observation support, not engine readiness or website health. */
  available: boolean;
  sessions: NativeBrowserSessionDiagnostics[];
}

export const nativeProxyCounters = [
  ["acceptedConnections", "Accepted connections"],
  ["authenticationChallenges", "Authentication challenges"],
  ["authenticatedRequests", "Authenticated proxy requests"],
  ["destinationDenials", "Destination denials"],
  ["upstreamFailures", "Upstream failures"],
  ["requestRejections", "Request rejections"],
  ["capacityRefusals", "Capacity refusals"],
] as const;

const invalid = () => new Error("Native browser diagnostics are unavailable.");
function record(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value))
    throw invalid();
  return value as Record<string, unknown>;
}
function identifier(value: unknown): string {
  if (typeof value !== "string" || !/^[a-zA-Z0-9_.:-]{1,256}$/.test(value))
    throw invalid();
  return value;
}
function proxySnapshot(value: unknown): NativeProxyDiagnostics | null {
  if (value === null) return null;
  const raw = record(value);
  if (
    ![
      "listening",
      "revoking",
      "stopped",
      "listener-failed",
      "task-ended",
    ].includes(String(raw.state))
  )
    throw invalid();
  const proxy = { state: raw.state } as NativeProxyDiagnostics;
  for (const [field] of nativeProxyCounters) {
    const count = raw[field];
    if (
      typeof count !== "number" ||
      !Number.isInteger(count) ||
      count < 0 ||
      count > 0xffffffff
    )
      throw invalid();
    proxy[field] = count;
  }
  return proxy;
}

/** Project known bounded scalar fields only; never retain native/page text. */
export function parseNativeBrowserDiagnostics(
  value: unknown,
): NativeBrowserDiagnostics {
  const raw = record(value);
  if (typeof raw.available !== "boolean" || !Array.isArray(raw.sessions))
    throw invalid();
  if (!raw.available) return { available: false, sessions: [] };
  if (raw.sessions.length > 64) throw invalid();
  const seen = new Set<string>();
  return {
    available: true,
    sessions: raw.sessions.map((value) => {
      const row = record(value);
      const owner = record(row.identity);
      const identity = {
        connectionId: identifier(owner.connectionId),
        sessionId: identifier(owner.sessionId),
        attemptId: identifier(owner.attemptId),
      };
      if (seen.has(identity.attemptId)) throw invalid();
      seen.add(identity.attemptId);
      if (
        row.phase !== null &&
        !["starting", "attached", "closing", "closed", "failed"].includes(
          String(row.phase),
        )
      )
        throw invalid();
      const phase = row.phase as NativeBrowserSessionDiagnostics["phase"];
      const failureReason =
        row.phase === "failed" && row.failureReason === "redirect-denied"
          ? "redirect-denied"
          : originBrowserFailureReason(row.phase, row.failureReason);
      return {
        identity,
        phase,
        ...(failureReason ? { failureReason } : {}),
        proxy: proxySnapshot(row.proxy),
      };
    }),
  };
}
