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
  const [snapshot, setSnapshot] = useState<{
    key: string;
    status: DeferredSynologyLoginStatus | null;
  } | null>(null);
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
          current === snapshot ? { key: current.key, status: null } : current,
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
    if (!current.requested || !current.valid) return null;
    try {
      current.assertCurrent();
      const context = current.context();
      if (!context?.sessionId) return null;
      return { ...context, key: JSON.stringify([scope.current, context]) };
    } catch {
      return null;
    }
  }, []);
  const receive = useCallback(
    (response: { session_id: string; deferred_login_status?: unknown }) => {
      const current = capture();
      if (!current || current.sessionId !== response.session_id) return;
      operation.current++;
      setSnapshot({
        key: current.key,
        status: parseDeferredSynologyLoginStatus(
          response.deferred_login_status,
        ),
      });
    },
    [capture],
  );
  const refresh = useCallback((): Promise<void> => {
    const current = capture();
    if (!current) return Promise.resolve();
    if (pending.current?.key === current.key) return pending.current.promise;
    const token = ++operation.current;
    const promise = (async () => {
      let status: DeferredSynologyLoginStatus | null = null;
      try {
        const rows: unknown = await invoke("get_proxy_session_details", {
          sessionId: current.sessionId,
        });
        if (Array.isArray(rows)) {
          const matches = rows.filter(
            (row) =>
              row &&
              typeof row === "object" &&
              row.session_id === current.sessionId,
          );
          if (matches.length === 1)
            status = parseDeferredSynologyLoginStatus(
              matches[0].deferred_login_status,
            );
        }
      } catch {
        /* Unavailable is not inactive or successful. */
      }
      if (
        alive.current &&
        token === operation.current &&
        capture()?.key === current.key
      )
        setSnapshot({ key: current.key, status });
    })();
    pending.current = { key: current.key, promise };
    void promise.finally(() => {
      if (pending.current?.promise === promise) pending.current = null;
    });
    return promise;
  }, [capture]);
  const refreshFromPage = useCallback(() => {
    const current = capture();
    if (!current || pageResult.current === current.key) return;
    pageResult.current = current.key;
    void refresh();
  }, [capture, refresh]);
  const current = capture();
  const status = snapshot?.key === current?.key ? snapshot?.status : null;
  return {
    receive,
    refresh,
    refreshFromPage,
    presentation: options.requested
      ? {
          label: "Saved Synology form login",
          detail: !options.valid
            ? "Original login access changed. Reopen the original saved connection."
            : status
              ? `Native snapshot: ${LABELS[status]}. ${status === "expired" || status === "cancelled" ? "Reopen the original saved connection to start another attempt. " : ""}This is not proof of successful sign-in. Click to refresh status.`
              : "Saved login requested; native status unknown. Click to refresh the native snapshot. This is not proof of successful sign-in.",
          muted:
            !options.valid ||
            !status ||
            status === "expired" ||
            status === "cancelled" ||
            status === "credentials_released",
          status,
        }
      : null,
  };
}
