import { useCallback, useEffect, useRef, useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import {
  describePageHelperFingerprint,
  PAGE_HELPER_TRACE_VALUES,
  recordSessionActivity,
  type PageHelperFingerprint,
  type PageHelperHandoff,
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
  waiting_document: "waiting for page",
  waiting_page: "waiting for DSM",
  waiting_root: "finding DSM",
  waiting_account_form: "finding login form",
  waiting_account_editable: "username not ready",
  waiting_account_stable: "checking login form",
  requesting_username: "requesting username",
  filling_username: "filling username",
  waiting_next_button: "waiting for Next",
  waiting_password_form: "waiting for password step",
  requesting_password: "requesting password",
  filling_password: "filling password",
  waiting_signin_button: "waiting for Sign in",
  verifying_sign_in: "signing in",
  submitted: "reported submission",
  timeout: "timed out",
  stopped: "stopped",
  cancelled: "cancelled",
  signed_in: "signed in",
  rejected: "sign-in rejected",
} as const;
type PagePhase = keyof typeof PAGE_PHASES;
const TERMINAL_PAGE_PHASES: readonly PagePhase[] = Object.freeze([
  "submitted",
  "timeout",
  "stopped",
  "cancelled",
  "signed_in",
  "rejected",
]);
// Terminal outcomes whose pill also names the specific cause.
const REASONED_PAGE_PHASES: readonly PagePhase[] = [
  "stopped",
  "timeout",
  "rejected",
];
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
  "route-pending":
    "DSM is still settling its sign-in route. The helper is waiting; this is not a failure.",
  "page-busy":
    "DSM is still loading or rendering its sign-in page. The helper is waiting; this is not a failure.",
  "controls-replaced":
    "DSM re-rendered the login controls. The helper is locating the current reviewed controls again.",
  "value-refilled":
    "DSM re-rendered the field and dropped the value the helper wrote, so the helper filled the current field again within its per-stage limit.",
  "panel-quiet-wait":
    "The helper is waiting for the login panel to stop changing before it requests a credential.",
  "next-reclicked":
    "The Next button was replaced before the page advanced, so the helper clicked Next once more. Sign in is never clicked twice.",
  "captcha-required":
    "DSM is showing a CAPTCHA in the login form. Complete it on the page; the helper does not answer CAPTCHAs.",
  "interactive-step-required":
    "The helper filled your saved sign-in details and DSM is now asking for an interactive sign-in step.",
  "user-input-detected":
    "You typed in the login form, so the helper stopped to avoid overwriting your input.",
  "unsafe-form-target":
    "The login form would send data to an unreviewed action or target, so the helper refused to fill it.",
  "account-mismatch":
    "The account shown on the password step did not match the saved username, so no password was filled.",
  "left-login-page":
    "The page left the DSM login page before sign-in finished.",
  "layout-unrecognized":
    "DSM loaded, but its login controls did not match the reviewed layout. This DSM version may use a different sign-in page.",
  "unsupported-login-path":
    "The sign-in page was opened on a path other than / or /webman/index.cgi, where saved sign-in is not released.",
  "page-never-ready":
    "The page never finished becoming interactive within the idle budget.",
  "login-form-never-appeared":
    "The DSM page loaded, but the login form never became ready within the idle budget.",
  "password-panel-never-appeared":
    "Next was clicked, but the password step never appeared before the deadline. Sign in was not clicked.",
  "signin-button-never-enabled":
    "The password was filled, but the Sign in button never became usable before the deadline. Sign in was not clicked.",
  "left-signin-page":
    "The page left the DSM sign-in page after Sign in was clicked, which usually means sign-in succeeded.",
  "error-visible":
    "After Sign in, DSM stayed on the password step and showed an error or cleared the password. No retry was attempted.",
  "sign-in-unconfirmed":
    "Sign in was clicked, but the page did not confirm the outcome while it was observed.",
  "no-sign-in-page":
    "No DSM sign-in page was shown, which usually means this browser session is already signed in. No credential was requested.",
} as const;
type PageReason = keyof typeof PAGE_REASONS;
const PAGE_SHORT_REASONS: Record<PageReason, string> = {
  "not-started": "not started",
  "document-loading": "page still loading",
  "form-settling": "login form settling",
  "input-settling": "input settling",
  "next-not-advanced": "Next did not advance",
  "root-missing": "DSM page not found",
  "root-ambiguous": "several DSM pages found",
  "form-missing": "login form missing",
  "form-ambiguous": "several login forms found",
  "field-missing": "input missing",
  "field-ambiguous": "several inputs found",
  "button-missing": "button missing",
  "button-ambiguous": "several buttons found",
  "field-hidden": "input hidden",
  "field-disabled": "input disabled",
  "field-readonly": "input read-only",
  "button-hidden": "button hidden",
  "button-disabled": "button disabled",
  "panel-transition": "login panel changing",
  "password-route": "password step not ready",
  "requesting-username": "requesting username",
  "requesting-password": "requesting password",
  submitted: "submitted",
  timeout: "deadline reached",
  stopped: "not completed",
  cancelled: "cancelled",
  "form-changed": "login form changed",
  "route-changed": "page route changed",
  captcha: "CAPTCHA detected",
  "credentials-unavailable": "saved credentials unavailable",
  "invalid-credential-response": "invalid credential response",
  "observation-limited": "details limited",
  "route-pending": "waiting for DSM route",
  "page-busy": "page busy",
  "controls-replaced": "controls replaced",
  "value-refilled": "value refilled",
  "panel-quiet-wait": "login form settling",
  "next-reclicked": "Next clicked again",
  "captcha-required": "CAPTCHA required",
  "interactive-step-required": "interactive sign-in step",
  "user-input-detected": "manual input detected",
  "unsafe-form-target": "unsafe form target",
  "account-mismatch": "account mismatch",
  "left-login-page": "left the login page",
  "layout-unrecognized": "login layout not recognized",
  "unsupported-login-path": "unsupported login path",
  "page-never-ready": "page never became ready",
  "login-form-never-appeared": "login form never appeared",
  "password-panel-never-appeared": "password step never appeared",
  "signin-button-never-enabled": "Sign in never enabled",
  "left-signin-page": "left the sign-in page",
  "error-visible": "DSM showed an error",
  "sign-in-unconfirmed": "sign-in not confirmed",
  "no-sign-in-page": "no sign-in page",
};
// The closed trace values are shared with the Action Log, and mirrored by
// synology_login_progress_client.js.
const TRACE = PAGE_HELPER_TRACE_VALUES;
// With 2FA or Secure SignIn, DSM's interactive step is the normal path, so the
// pill reads as a hand-off to the user rather than as a failure.
const INTERACTIVE_HANDOFFS: Record<
  Exclude<PageHelperHandoff, "other">,
  readonly [text: string, detail: string]
> = {
  otp: [
    "enter your 2FA code",
    "DSM is asking for the one-time 2FA code from your authenticator app.",
  ],
  approve: [
    "approve sign-in in Secure SignIn",
    "DSM sent a sign-in request to Synology Secure SignIn; approve it on your device.",
  ],
  "select-auth": [
    "choose a sign-in method",
    "DSM is asking you to choose how to verify this sign-in.",
  ],
  passkey: [
    "use your passkey",
    "DSM is asking for your passkey or hardware security key.",
  ],
};
const AUTOMATIC_OTP_HANDOFF = [
  "Automatic 2FA is entering the code",
  "DSM is asking for a one-time 2FA code. Automatic 2FA is enabled for this connection and enters it separately; if it cannot, use 2FA Codes.",
] as const;
const GENERIC_HANDOFF = [
  "finish sign-in on the page",
  "Complete the remaining DSM sign-in step on the page.",
] as const;
const HANDOFF_STAGES = {
  account: " DSM asked for it after the username step.",
  password: " DSM asked for it during the password step.",
  submitted: " DSM asked for it after Sign in.",
} as const;
export interface SynologyLoginTrace {
  steps?: { t: number; phase: PagePhase; reason: PageReason }[];
  fingerprint?: PageHelperFingerprint;
  handoff?: PageHelperHandoff;
}
type PageProgress = {
  phase: PagePhase;
  reason: PageReason;
  trace?: SynologyLoginTrace;
};
/** The closed page-helper vocabulary, for parity checks with the bridge and helper. */
export const SYNOLOGY_LOGIN_PROGRESS_VOCABULARY = Object.freeze({
  phases: Object.freeze(Object.keys(PAGE_PHASES) as PagePhase[]),
  terminalPhases: TERMINAL_PAGE_PHASES,
  reasons: Object.freeze(Object.keys(PAGE_REASONS) as PageReason[]),
  ...TRACE,
});
const has = (record: object, key: string) =>
  Object.prototype.hasOwnProperty.call(record, key);
const integer = (value: unknown, max: number) =>
  typeof value === "number" && value >= 0 && Number.isInteger(value)
    ? Math.min(value, max)
    : null;
const closed = <T extends string>(values: readonly T[], value: unknown) =>
  values.find((candidate) => candidate === value);
// Rebuild the bridge-forwarded trace from closed values. Each property is read
// once; malformed or hostile input omits the trace instead of the phase.
function parseTrace(value: unknown): SynologyLoginTrace | null {
  try {
    if (!value || typeof value !== "object" || Array.isArray(value))
      return null;
    const { steps, fingerprint, handoff } = value as Record<string, unknown>;
    const trace: SynologyLoginTrace = {};
    if (Array.isArray(steps)) {
      const clean: NonNullable<SynologyLoginTrace["steps"]> = [];
      const length = integer(steps.length, 2 ** 32 - 1) ?? 0;
      for (let index = Math.max(0, length - 8); index < length; index++) {
        const step: unknown = steps[index];
        if (!step || typeof step !== "object") continue;
        const { t, phase, reason } = step as Record<string, unknown>;
        const time = integer(t, 86_400_000);
        if (
          time !== null &&
          typeof phase === "string" &&
          typeof reason === "string" &&
          has(PAGE_PHASES, phase) &&
          has(PAGE_REASONS, reason) &&
          reason !== "observation-limited"
        )
          clean.push({
            t: time,
            phase: phase as PagePhase,
            reason: reason as PageReason,
          });
      }
      if (clean.length) trace.steps = clean;
    }
    if (
      fingerprint &&
      typeof fingerprint === "object" &&
      !Array.isArray(fingerprint)
    ) {
      const source = fingerprint as Record<string, unknown>;
      const print: PageHelperFingerprint = {};
      for (const name of TRACE.counts) {
        const count = integer(source[name], 9);
        if (count !== null) print[name] = count;
      }
      const hash = closed(TRACE.hashes, source.hash);
      const readyState = closed(TRACE.readyStates, source.readyState);
      const stage = closed(TRACE.stages, source.stage);
      if (hash) print.hash = hash;
      if (readyState) print.readyState = readyState;
      if (stage) print.stage = stage;
      if (Object.keys(print).length) trace.fingerprint = print;
    }
    const named = closed(TRACE.handoffs, handoff);
    if (named) trace.handoff = named;
    return trace.steps || trace.fingerprint || trace.handoff ? trace : null;
  } catch {
    return null;
  }
}
export function parseSynologyLoginProgress(
  value: unknown,
): PageProgress | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  const { phase, reason, trace } = value as Record<string, unknown>;
  if (
    typeof phase !== "string" ||
    typeof reason !== "string" ||
    !has(PAGE_PHASES, phase) ||
    !has(PAGE_REASONS, reason)
  )
    return null;
  const parsed = parseTrace(trace);
  return {
    phase: phase as PagePhase,
    reason: reason as PageReason,
    ...(parsed ? { trace: parsed } : {}),
  };
}
function describeTrace(trace: SynologyLoginTrace | undefined): string {
  const steps = trace?.steps
    ? ` Recent page steps (ms since start): ${trace.steps
        .map((step) => `${step.t} ${step.phase}/${step.reason}`)
        .join("; ")}.`
    : "";
  const fingerprint = describePageHelperFingerprint(trace?.fingerprint);
  return `${steps}${fingerprint ? ` ${fingerprint}` : ""}`;
}
const isInteractiveHandoff = (progress: PageProgress) =>
  progress.phase === "stopped" &&
  progress.reason === "interactive-step-required";
function interactiveHandoff(progress: PageProgress, automaticOtp: boolean) {
  // The helper names the hand-off; the route class is only a fallback.
  const handoff =
    progress.trace?.handoff ??
    closed(TRACE.handoffs, progress.trace?.fingerprint?.hash);
  if (handoff === "otp" && automaticOtp) return AUTOMATIC_OTP_HANDOFF;
  return handoff && handoff !== "other"
    ? INTERACTIVE_HANDOFFS[handoff]
    : GENERIC_HANDOFF;
}
function pageText(progress: PageProgress, automaticOtp: boolean): string {
  if (progress.reason === "observation-limited")
    return "Auto-fill: details limited";
  if (isInteractiveHandoff(progress))
    return `Auto-fill: filled — ${interactiveHandoff(progress, automaticOtp)[0]}`;
  if (progress.phase === "signed_in" && progress.reason === "no-sign-in-page")
    return "Auto-fill: already signed in";
  const label = `Auto-fill: ${PAGE_PHASES[progress.phase]}`;
  return REASONED_PAGE_PHASES.includes(progress.phase)
    ? `${label} — ${PAGE_SHORT_REASONS[progress.reason]}`
    : label;
}
function pageExplanation(progress: PageProgress, automaticOtp: boolean) {
  const explanation = `[${progress.phase}/${progress.reason}]: ${PAGE_REASONS[progress.reason]}`;
  const stage = progress.trace?.fingerprint?.stage;
  const handoff = isInteractiveHandoff(progress)
    ? ` ${interactiveHandoff(progress, automaticOtp)[1]}${stage ? HANDOFF_STAGES[stage] : ""} The DSM sign-in helper never enters a 2FA code, approves a sign-in or uses a passkey, and does not retry sign-in.`
    : "";
  const caveat =
    progress.phase === "signed_in"
      ? " This is advisory page state inferred from the page, not native proof of authentication."
      : " This is advisory page state, not native authorization or proof of sign-in.";
  return `${explanation}${handoff}${caveat}`;
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
  /** The connection has Automatic 2FA enabled, which answers DSM's code step. */
  automaticOtp?: boolean;
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
    lastPhase: PagePhase | null;
    phaseChanges: number;
    reasonChanges: number;
    limited: boolean;
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
          lastPhase: null,
          phaseChanges: 0,
          reasonChanges: 0,
          limited: false,
          terminal: false,
        };
      const seen = pageSeen.current;
      const key = `${progress.phase}:${progress.reason}`;
      const terminal = TERMINAL_PAGE_PHASES.includes(progress.phase);
      if (seen.terminal || seen.last === key) return;
      if (!terminal) {
        // Mirror the bridge: phase changes and reason-only churn are bounded
        // apart, and its single limit notice is accepted only once a bound is hit.
        const phaseChange = progress.phase !== seen.lastPhase;
        const bounded = phaseChange
          ? seen.phaseChanges >= 64
          : seen.reasonChanges >= 256;
        if (progress.reason === "observation-limited") {
          if (seen.limited || !bounded) return;
          seen.limited = true;
        } else if (seen.limited || bounded) return;
        else if (phaseChange) seen.phaseChanges++;
        else seen.reasonChanges++;
      }
      seen.last = key;
      seen.lastPhase = progress.phase;
      seen.terminal = terminal;
      recordSessionActivity(
        latest.current.activityContext,
        "autofill",
        progress.phase,
        {
          reason: progress.reason,
          ...(terminal && progress.trace
            ? {
                trace: {
                  fingerprint: progress.trace.fingerprint,
                  handoff: isInteractiveHandoff(progress)
                    ? progress.trace.handoff
                    : undefined,
                },
              }
            : {}),
        },
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
    ? ` Page helper reports ${pageExplanation(pageProgress, options.automaticOtp === true)}${describeTrace(pageProgress.trace)}`
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
              ? pageText(pageProgress, options.automaticOtp === true)
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
