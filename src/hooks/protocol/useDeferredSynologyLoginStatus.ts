import { useCallback, useEffect, useRef, useState } from "react";
import { invoke } from "@tauri-apps/api/core";

const STATUSES = [
  "awaiting_nas",
  "waiting_for_form",
  "waiting_for_password",
  "credentials_released",
  "expired",
  "cancelled",
] as const;
export type DeferredSynologyLoginStatus = (typeof STATUSES)[number];
export function parseDeferredSynologyLoginStatus(
  value: unknown,
): DeferredSynologyLoginStatus | null {
  return typeof value === "string" &&
    STATUSES.some((status) => status === value)
    ? (value as DeferredSynologyLoginStatus)
    : null;
}
const LABELS: Record<DeferredSynologyLoginStatus, string> = {
  awaiting_nas: "Waiting for the verified NAS",
  waiting_for_form: "Waiting for the DSM form",
  waiting_for_password: "Waiting for the password stage",
  credentials_released: "One-shot credentials released",
  expired: "Attempt expired",
  cancelled: "Attempt cancelled",
};
const VISIBLE_LABELS: Record<DeferredSynologyLoginStatus, string> = {
  awaiting_nas: "Auto-fill: awaiting NAS",
  waiting_for_form: "Auto-fill: waiting for DSM",
  waiting_for_password: "Auto-fill: waiting for password",
  credentials_released: "Auto-fill: credentials released",
  expired: "Auto-fill: expired",
  cancelled: "Auto-fill: cancelled",
};
const DIAGNOSTICS = {
  "not-observed": [
    "Saved login: status unknown",
    "No native status has been observed for this page yet.",
  ],
  "snapshot-aged": [
    "Saved login: status needs refresh",
    "The last observation is more than 30 seconds old; refresh to check the current native phase.",
  ],
  "request-failed": [
    "Saved login: status read failed",
    "The native status request failed. Refresh to retry this read; this does not retry sign-in.",
  ],
  "request-timeout": [
    "Saved login: status read timed out",
    "The native status read did not finish within 6 seconds. Its eventual reply will be ignored. Refresh to retry this read.",
  ],
  "invalid-response": [
    "Saved login: invalid status response",
    "The native status response was not a session list. Restart the desktop application to ensure the frontend and native backend match.",
  ],
  "session-missing": [
    "Saved login: session unavailable",
    "The current proxy session was absent from the native response. Reopen the original saved connection if the session has stopped.",
  ],
  "ambiguous-session": [
    "Saved login: ambiguous status response",
    "The native response contained more than one entry for this proxy session; no phase was accepted.",
  ],
  "status-missing": [
    "Saved login: no native status",
    "This native session reported no deferred-login status. It may be an anonymous session without a transferred attempt, or an older backend. Reopen the original saved connection after restarting the app.",
  ],
  "unsupported-status": [
    "Saved login: unsupported status",
    "The native session returned an unrecognized status; no phase was accepted. Restart the desktop application to use matching components.",
  ],
} as const;
type DiagnosticReason = keyof typeof DIAGNOSTICS;
interface Snapshot {
  key: string;
  status: DeferredSynologyLoginStatus | null;
  lastObserved: DeferredSynologyLoginStatus | null;
  reason: DiagnosticReason | null;
}
const READ_TIMEOUT = 6000;
interface Context {
  sessionId: string;
  generation: number;
  document: string | null;
}
interface Options {
  scope: string;
  requested: boolean;
  valid: boolean;
  context: () => Context | null;
  assertCurrent: () => void;
}

/** Advisory native snapshots only. Never resolves, arms or retries credentials. */
export function useDeferredSynologyLoginStatus(options: Options) {
  const latest = useRef(options);
  latest.current = options;
  const scope = useRef({ key: options.scope, epoch: 0 });
  if (scope.current.key !== options.scope)
    scope.current = { key: options.scope, epoch: scope.current.epoch + 1 };
  const alive = useRef(true);
  const operation = useRef(0);
  const pending = useRef<{ key: string; promise: Promise<void> } | null>(null);
  const pageResult = useRef<string | null>(null);
  const [snapshot, setSnapshot] = useState<Snapshot | null>(null);
  useEffect(() => {
    if (
      !snapshot?.status ||
      ["credentials_released", "expired", "cancelled"].includes(snapshot.status)
    )
      return;
    // Freshness is presentation-only. Expiring a snapshot never changes or
    // renews native intent, and does not start a polling loop.
    const timer = setTimeout(
      () =>
        setSnapshot((current) =>
          current === snapshot
            ? {
                ...current,
                lastObserved: current.status,
                status: null,
                reason: "snapshot-aged",
              }
            : current,
        ),
      30_000,
    );
    return () => clearTimeout(timer);
  }, [snapshot]);
  const invalidate = useCallback(() => {
    alive.current = false;
    operation.current++;
  }, []);
  useEffect(() => {
    alive.current = true;
    return invalidate;
  }, [invalidate]);
  const capture = useCallback(() => {
    const current = latest.current;
    if (!alive.current || !current.requested || !current.valid) return null;
    try {
      current.assertCurrent();
      const context = current.context();
      if (!context?.sessionId) return null;
      return { ...context, key: JSON.stringify([scope.current, context]) };
    } catch {
      return null;
    }
  }, []);
  const record = useCallback(
    (
      key: string,
      status: DeferredSynologyLoginStatus | null,
      reason: DiagnosticReason | null,
    ) => {
      setSnapshot((previous) => ({
        key,
        status,
        reason,
        lastObserved:
          status ??
          (previous?.key === key
            ? (previous.status ?? previous.lastObserved)
            : null),
      }));
    },
    [],
  );
  const receive = useCallback(
    (response: { session_id: string; deferred_login_status?: unknown }) => {
      const current = capture();
      if (!current || current.sessionId !== response.session_id) return;
      operation.current++;
      const status = parseDeferredSynologyLoginStatus(
        response.deferred_login_status,
      );
      record(
        current.key,
        status,
        status
          ? null
          : response.deferred_login_status == null
            ? "status-missing"
            : "unsupported-status",
      );
    },
    [capture, record],
  );
  const refresh = useCallback((): Promise<void> => {
    const current = capture();
    if (!current) return Promise.resolve();
    if (pending.current?.key === current.key) return pending.current.promise;
    const token = ++operation.current;
    const promise = (async () => {
      let status: DeferredSynologyLoginStatus | null = null;
      let reason: DiagnosticReason | null = "invalid-response";
      let timeout: ReturnType<typeof setTimeout> | undefined;
      const started = performance.now();
      const timedOut = Symbol("native status read timeout");
      try {
        const rows: unknown = await Promise.race([
          invoke("get_proxy_session_details", { sessionId: current.sessionId }),
          new Promise((_, reject) => {
            timeout = setTimeout(() => reject(timedOut), READ_TIMEOUT);
          }),
        ]);
        // A suspended event loop must not let an overdue reply win a microtask race.
        if (performance.now() - started >= READ_TIMEOUT) throw timedOut;
        if (Array.isArray(rows)) {
          const matches = rows.filter(
            (row) =>
              row &&
              typeof row === "object" &&
              !Array.isArray(row) &&
              row.session_id === current.sessionId,
          );
          if (matches.length === 0) reason = "session-missing";
          else if (matches.length > 1) reason = "ambiguous-session";
          else {
            const value = matches[0].deferred_login_status;
            status = parseDeferredSynologyLoginStatus(value);
            reason = status
              ? null
              : value == null
                ? "status-missing"
                : "unsupported-status";
          }
        }
      } catch (error) {
        reason = error === timedOut ? "request-timeout" : "request-failed";
      } finally {
        clearTimeout(timeout);
      }
      if (
        alive.current &&
        token === operation.current &&
        capture()?.key === current.key
      )
        record(current.key, status, reason);
    })();
    pending.current = { key: current.key, promise };
    void promise.finally(() => {
      if (pending.current?.promise === promise) pending.current = null;
    });
    return promise;
  }, [capture, record]);
  const refreshFromPage = useCallback(() => {
    const current = capture();
    if (!current || pageResult.current === current.key) return;
    pageResult.current = current.key;
    void refresh();
  }, [capture, refresh]);
  const current = capture();
  const status = snapshot?.key === current?.key ? snapshot?.status : null;
  const reason =
    snapshot?.key === current?.key ? snapshot?.reason : "not-observed";
  const lastObserved =
    snapshot?.key === current?.key ? snapshot?.lastObserved : null;
  return {
    receive,
    refresh,
    refreshFromPage,
    presentation: options.requested
      ? {
          label: "Saved Synology form login",
          text: !options.valid
            ? "Auto-fill: access changed"
            : status
              ? VISIBLE_LABELS[status]
              : DIAGNOSTICS[reason ?? "not-observed"][0],
          detail: !options.valid
            ? "Original login access changed. Reopen the original saved connection."
            : status
              ? `Native snapshot: ${LABELS[status]}. ${status === "expired" || status === "cancelled" ? "Reopen the original saved connection to start another attempt. " : ""}This is not proof of successful sign-in. Click to refresh status.`
              : `Saved login requested; native status unknown. [${reason ?? "not-observed"}] ${DIAGNOSTICS[reason ?? "not-observed"][1]} ${lastObserved ? `Last observed: ${LABELS[lastObserved]} (not current status). ` : ""}This is not proof of successful sign-in.`,
          muted:
            !options.valid ||
            !status ||
            status === "expired" ||
            status === "cancelled" ||
            status === "credentials_released",
          status,
          reason,
        }
      : null,
  };
}
