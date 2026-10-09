import { useCallback, useLayoutEffect, useRef, useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import type { OriginBrowserIdentity } from "../../types/protocols/originBrowser";

export type OriginBrowserDiagnosticOutcome =
  | "response"
  | "timeout"
  | "route-unavailable"
  | "tls-failed"
  | "request-failed"
  | "owner-unavailable"
  | "busy";

/** Closed scalar report. Arbitrary error text, headers and bodies never enter state. */
export interface OriginBrowserDiagnosticReport {
  outcome: OriginBrowserDiagnosticOutcome;
  elapsedMs: number;
  httpStatus: number | null;
  contentLength: number | null;
}

export interface UseOriginBrowserDiagnosticsOptions {
  identity: OriginBrowserIdentity | null;
  /** Exact canonical HTTP(S) origin; no slash, userinfo, path, query or fragment. */
  origin: string;
  enabled: boolean;
  /** Invalidate on navigation/failure changes even when the origin is unchanged. */
  scope: string;
  assertOwner: () => void;
}

const outcomes: readonly string[] = [
  "response",
  "timeout",
  "route-unavailable",
  "tls-failed",
  "request-failed",
  "owner-unavailable",
  "busy",
];
const failed =
  "The anonymous probe could not be completed. Check database access and native browser availability, then retry. The installed native runtime must support diagnostics; no direct fallback was attempted.";

function reportFrom(value: unknown): OriginBrowserDiagnosticReport | null {
  if (!value || typeof value !== "object") return null;
  const raw = value as Record<string, unknown>;
  if (
    typeof raw.outcome !== "string" ||
    !outcomes.includes(raw.outcome) ||
    typeof raw.elapsedMs !== "number" ||
    !Number.isSafeInteger(raw.elapsedMs) ||
    raw.elapsedMs < 0 ||
    raw.elapsedMs > 4_294_967_295
  )
    return null;
  const httpStatus = raw.httpStatus ?? null;
  const contentLength = raw.contentLength ?? null;
  if (
    httpStatus !== null &&
    (typeof httpStatus !== "number" ||
      !Number.isInteger(httpStatus) ||
      httpStatus < 100 ||
      httpStatus > 599)
  )
    return null;
  if (
    contentLength !== null &&
    (typeof contentLength !== "number" ||
      !Number.isSafeInteger(contentLength) ||
      contentLength < 0)
  )
    return null;
  if ((raw.outcome === "response") !== (httpStatus !== null)) return null;
  if (raw.outcome !== "response" && contentLength !== null) return null;
  return {
    outcome: raw.outcome as OriginBrowserDiagnosticOutcome,
    elapsedMs: raw.elapsedMs,
    httpStatus,
    contentLength,
  };
}

function validOrigin(value: string) {
  try {
    const url = new URL(value);
    return (
      value.length <= 2048 &&
      (url.protocol === "http:" || url.protocol === "https:") &&
      url.origin === value
    );
  } catch {
    return false;
  }
}

/** Only the native command may acquire the route. Never reconstruct it with
 * resolveRuntimeNetworkPath, fetch(), or the legacy diagnose_http_connection.
 * Native owns destination grants, relay auth, lock cancellation and timeouts. */
export function useOriginBrowserDiagnostics(
  options: UseOriginBrowserDiagnosticsOptions,
) {
  const supplied = options.identity;
  const identity = supplied
    ? {
        ownerDatabaseId: supplied.ownerDatabaseId,
        connectionId: supplied.connectionId,
        sessionId: supplied.sessionId,
        attemptId: supplied.attemptId,
      }
    : null;
  const available =
    options.enabled &&
    !!identity &&
    Object.values(identity).every(
      (value) =>
        typeof value === "string" && value.length > 0 && value.length <= 256,
    ) &&
    validOrigin(options.origin);
  const key = JSON.stringify([identity, options.origin, options.scope]);
  const committed = useRef({ ...options, identity, available, key });
  const mounted = useRef(false);
  const epoch = useRef(0);
  const pending = useRef(false);
  const [state, setState] = useState<{
    key: string;
    running: boolean;
    report: OriginBrowserDiagnosticReport | null;
    error: string | null;
  }>({ key, running: false, report: null, error: null });
  useLayoutEffect(() => {
    committed.current = { ...options, identity, available, key };
  });
  useLayoutEffect(() => {
    mounted.current = true;
    ++epoch.current;
    pending.current = false;
    setState({ key, running: false, report: null, error: null });
    return () => {
      mounted.current = false;
    };
  }, [key, available]);

  const run = useCallback(async () => {
    const start = committed.current;
    if (
      !mounted.current ||
      !start.available ||
      !start.identity ||
      pending.current
    )
      return;
    const generation = epoch.current;
    const current = () =>
      mounted.current &&
      generation === epoch.current &&
      committed.current.available &&
      committed.current.key === start.key;
    try {
      start.assertOwner();
      pending.current = true;
      setState({ key: start.key, running: true, report: null, error: null });
      const value = await invoke<unknown>("origin_browser_diagnose", {
        request: { identity: start.identity, origin: start.origin },
      });
      if (!current()) return;
      committed.current.assertOwner();
      const report = reportFrom(value);
      setState({
        key: start.key,
        running: false,
        report,
        error: report ? null : failed,
      });
    } catch {
      if (current())
        setState({
          key: start.key,
          running: false,
          report: null,
          error: failed,
        });
    } finally {
      if (current()) pending.current = false;
    }
  }, []);

  const visible = available && state.key === key;
  return {
    available,
    running: visible && state.running,
    report: visible ? state.report : null,
    error: visible ? state.error : null,
    run,
  };
}
