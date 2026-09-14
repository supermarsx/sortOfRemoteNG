import { useCallback, useEffect, useRef, useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import {
  recordSessionActivity,
  type SessionActivityContext,
} from "../../utils/monitoring/sessionActivityLog";

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
const PAGE_PHASES = {
  waiting_document: "page loading",
  waiting_root: "finding DSM",
  waiting_account_form: "finding login form",
  waiting_account_editable: "username not ready",
  waiting_account_stable: "checking login form",
  requesting_username: "requesting username",
  waiting_next_button: "waiting for Next",
  waiting_password_form: "finding password form",
  requesting_password: "requesting password",
  waiting_signin_button: "waiting for Sign in",
  submitted: "reported submission",
  timeout: "timed out",
  stopped: "stopped",
  cancelled: "cancelled",
} as const;
const PAGE_REASONS = {
  "not-started": "The page helper is installed but has not started.",
  "document-loading": "The document has not completed loading.",
  "form-settling":
    "The reviewed editable account controls are being checked for stability before requesting the username. This does not prove the page framework has finished initializing.",
  "input-settling":
    "The helper filled the reviewed input once and is allowing the page to process its input events before clicking.",
  "next-not-advanced":
    "Next was clicked once, but the expected password-panel transition was not accepted before the deadline. No second click or login retry was attempted.",
  "root-missing": "The reviewed DSM root is absent.",
  "root-ambiguous": "More than one matching DSM root was found.",
  "form-missing": "The reviewed form is absent.",
  "form-ambiguous": "More than one reviewed form was found.",
  "field-missing": "The exact reviewed input is absent.",
  "field-ambiguous": "More than one matching input was found.",
  "button-missing": "The reviewed action button is absent.",
  "button-ambiguous": "More than one matching action button was found.",
  "field-hidden": "The reviewed input is hidden.",
  "field-disabled": "The reviewed input is disabled.",
  "field-readonly": "The reviewed input is read-only.",
  "button-hidden": "The reviewed action button is hidden.",
  "button-disabled": "The reviewed action button is disabled.",
  "panel-transition": "The page is transitioning between login panels.",
  "password-route": "The password-stage route is not ready.",
  "requesting-username": "The helper requested the one-use username grant.",
  "requesting-password": "The helper requested the one-use password grant.",
  submitted:
    "The helper reports clicking Sign in; this does not confirm authentication.",
  timeout: "The page helper reached its existing deadline.",
  stopped: "The page helper stopped without completing submission.",
  cancelled: "The page helper was cancelled.",
  "form-changed": "The reviewed form identity changed.",
  "route-changed": "The reviewed page route changed.",
  captcha: "An interactive CAPTCHA was detected.",
  "credentials-unavailable":
    "The credential grant was unavailable; no retry was attempted.",
  "invalid-credential-response":
    "The credential response did not match the reviewed protocol.",
  "observation-limited":
    "Page-helper diagnostics changed too often. Intermediate observations are now limited; the terminal result can still be reported.",
} as const;
type PageProgress = {
  phase: keyof typeof PAGE_PHASES;
  reason: keyof typeof PAGE_REASONS;
};
export function parseSynologyLoginProgress(
  value: unknown,
): PageProgress | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  const { phase, reason } = value as Record<string, unknown>;
  if (
    typeof phase !== "string" ||
    typeof reason !== "string" ||
    !Object.prototype.hasOwnProperty.call(PAGE_PHASES, phase) ||
    !Object.prototype.hasOwnProperty.call(PAGE_REASONS, reason)
  )
    return null;
  return {
    phase: phase as PageProgress["phase"],
    reason: reason as PageProgress["reason"],
  };
}
interface Context {
  sessionId: string;
  generation: number;
  document: string | null;
}
interface Options {
  activityContext?: SessionActivityContext;
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
  const loggedNative = useRef<{ key: string; value: string } | null>(null);
  const [snapshot, setSnapshot] = useState<Snapshot | null>(null);
  const [pageSnapshot, setPageSnapshot] = useState<{
    key: string;
    progress: PageProgress;
  } | null>(null);
  const pageSeen = useRef<{
    key: string;
    last: string | null;
    count: number;
    terminal: boolean;
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
      if (capture()?.key !== key) return;
      const value = status ?? `unavailable:${reason}`;
      if (
        loggedNative.current?.key !== key ||
        loggedNative.current.value !== value
      ) {
        loggedNative.current = { key, value };
        recordSessionActivity(
          latest.current.activityContext,
          "autofill",
          status ?? "status_unavailable",
        );
      }
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
    [capture],
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
  const receivePageProgress = useCallback(
    (value: unknown) => {
      const current = capture();
      const progress = parseSynologyLoginProgress(value);
      if (!current?.document || !progress) return;
      if (pageSeen.current?.key !== current.key)
        pageSeen.current = {
          key: current.key,
          last: null,
          count: 0,
          terminal: false,
        };
      const seen = pageSeen.current;
      const key = `${progress.phase}:${progress.reason}`;
      const terminal = [
        "submitted",
        "timeout",
        "stopped",
        "cancelled",
      ].includes(progress.phase);
      const limited = progress.reason === "observation-limited";
      if (
        seen.terminal ||
        seen.last === key ||
        (!terminal && seen.count >= 64 && !(limited && seen.count === 64))
      )
        return;
      seen.last = key;
      seen.count++;
      seen.terminal = terminal;
      recordSessionActivity(
        latest.current.activityContext,
        "autofill",
        progress.phase,
        { reason: progress.reason },
      );
      setPageSnapshot({ key: current.key, progress });
    },
    [capture],
  );
  const current = capture();
  const status = snapshot?.key === current?.key ? snapshot?.status : null;
  const reason =
    snapshot?.key === current?.key ? snapshot?.reason : "not-observed";
  const lastObserved =
    snapshot?.key === current?.key ? snapshot?.lastObserved : null;
  const pageProgress =
    pageSnapshot?.key === current?.key ? pageSnapshot?.progress : null;
  const nativeDetail = status
    ? `Native snapshot: ${LABELS[status]}. ${status === "expired" || status === "cancelled" ? "Reopen the original saved connection to start another attempt. " : ""}This is not proof of successful sign-in. Click to refresh status.`
    : `Saved login requested; native status unknown. [${reason ?? "not-observed"}] ${DIAGNOSTICS[reason ?? "not-observed"][1]} ${lastObserved ? `Last observed: ${LABELS[lastObserved]} (not current status). ` : ""}This is not proof of successful sign-in.`;
  const pageDetail = pageProgress
    ? ` Page helper reports [${pageProgress.phase}/${pageProgress.reason}]: ${PAGE_REASONS[pageProgress.reason]} This is advisory page state, not native authorization or proof of sign-in.`
    : " No scoped page-helper progress has been received for this document.";
  return {
    receive,
    refresh,
    refreshFromPage,
    receivePageProgress,
    presentation: options.requested
      ? {
          label: "Saved Synology form login",
          text: !options.valid
            ? "Auto-fill: access changed"
            : pageProgress && status !== "expired" && status !== "cancelled"
              ? pageProgress.reason === "observation-limited"
                ? "Auto-fill: details limited"
                : `Auto-fill: ${PAGE_PHASES[pageProgress.phase]}`
              : status === "waiting_for_form"
                ? "Auto-fill: page helper unconfirmed"
                : status
                  ? VISIBLE_LABELS[status]
                  : DIAGNOSTICS[reason ?? "not-observed"][0],
          detail: !options.valid
            ? "Original login access changed. Reopen the original saved connection."
            : nativeDetail + pageDetail,
          muted:
            !options.valid ||
            !status ||
            status === "expired" ||
            status === "cancelled" ||
            status === "credentials_released",
          status,
          reason,
          pageProgress,
        }
      : null,
  };
}
