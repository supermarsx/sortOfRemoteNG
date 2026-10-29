import { useCallback, useEffect, useRef, useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import type { OriginBrowserIdentity } from "../../types/protocols/originBrowser";
import type { Connection } from "../../types/connection/connection";
import type {
  NativeLoginActivity,
  NativeLoginStage,
} from "./useNativeLoginActivity";

/** Which automatic-login step the user asked to retry. */
export type OriginAutoLoginRetryStep = "credentials" | "mfa";

/** Stages in which native is entering text into the page right now. A retry
 * then would race the entry, so the controls wait. Waiting stages (page,
 * security check, 2FA prompt) can still be retried. */
const ENTERING: ReadonlySet<NativeLoginStage> = new Set([
  "filling-username",
  "filling-password",
  "submitting",
  "typing-code",
]);

export interface OriginAutoLoginRetryConfiguration {
  /** The saved connection asks native to sign in automatically. */
  enabled: boolean;
  /** A saved credential exists for native to deliver. */
  credentials: boolean;
  /** A saved authenticator is selected for automatic 2FA. */
  mfa: boolean;
  /** Code period of the selected authenticator, in seconds. */
  periodSeconds: number;
}

/** Mirrors the saved-row checks native makes before it signs in. This only
 * decides what the shell offers: native re-reads and re-authorizes the saved
 * row for the replacement attempt, so nothing here grants anything. */
export function originAutoLoginRetryConfiguration(
  connection: Connection | undefined,
): OriginAutoLoginRetryConfiguration {
  const enabled =
    !!connection &&
    (connection.httpApplication
      ? connection.httpApplication.loginMode === "form"
      : connection.httpAutoLogin === true);
  const credentials =
    enabled &&
    (connection.credentialSource?.kind === "vault" ||
      !!connection.password ||
      !!connection.basicAuthPassword);
  const mfaSettings = connection?.httpAutoMfa;
  const mfa =
    credentials && mfaSettings?.enabled === true && !!mfaSettings.totpConfigId;
  const period = connection?.totpConfigs?.find(
    (config) => config.id === mfaSettings?.totpConfigId,
  )?.period;
  return {
    enabled,
    credentials,
    mfa,
    periodSeconds:
      typeof period === "number" && Number.isInteger(period) && period > 0
        ? period
        : 30,
  };
}

/** The first moment whose code differs from the one typed at `typedAtMs`:
 * the start of the next code period. */
export function nextFreshCodeAtMs(
  typedAtMs: number | undefined,
  periodSeconds: number,
): number {
  if (typedAtMs === undefined) return 0;
  const period = periodSeconds * 1000;
  return (Math.floor(typedAtMs / period) + 1) * period;
}

/** Tauri command that re-runs automatic login on the current page, in place.
 * Native looks up this exact attempt's login and re-arms only its own grant. */
export const ORIGIN_BROWSER_RETRY_LOGIN_COMMAND = "origin_browser_retry_login";

export interface OriginBrowserRetryLoginRequest {
  readonly identity: OriginBrowserIdentity;
  readonly step: OriginAutoLoginRetryStep;
}

/** Fixed native refusal codes; anything else is treated as unavailable. */
export const originBrowserRetryLoginRefusals = [
  /** The attempt, owner or document is no longer the one asked about. */
  "not-current",
  /** This attempt has no automatic login (manual, or no saved login). */
  "no-login",
  /** Native is still entering text or delivering for this attempt. */
  "busy",
  /** No automatic 2FA authenticator for this attempt. */
  "no-mfa",
  /** The current code period's code was already delivered; wait for the next. */
  "code-used",
  /** Too many retries in a short time. */
  "rate-limited",
  /** The current page shows no login or 2FA form this step can fill. */
  "no-form",
] as const;
export type OriginBrowserRetryLoginRefusal =
  (typeof originBrowserRetryLoginRefusals)[number];

export type OriginBrowserRetryLoginReceipt =
  | { readonly status: "started" }
  | {
      readonly status: "refused";
      readonly reason: OriginBrowserRetryLoginRefusal;
    };

export type OriginAutoLoginRetryOutcome =
  | { status: "started" }
  | { status: "refused"; reason: OriginBrowserRetryLoginRefusal }
  /** No answer native could stand behind: an older host without the command,
   * a rejected request, or a malformed reply. */
  | { status: "unavailable" };

/** Keep only a fixed status and reason; never native prose. */
export function parseRetryLoginReceipt(
  value: unknown,
): OriginAutoLoginRetryOutcome {
  if (!value || typeof value !== "object") return { status: "unavailable" };
  const { status, reason } = value as Record<string, unknown>;
  if (status === "started") return { status: "started" };
  if (
    status === "refused" &&
    originBrowserRetryLoginRefusals.includes(
      reason as OriginBrowserRetryLoginRefusal,
    )
  )
    return {
      status: "refused",
      reason: reason as OriginBrowserRetryLoginRefusal,
    };
  return { status: "unavailable" };
}

export type OriginBrowserRetryLoginTransport = (
  request: OriginBrowserRetryLoginRequest,
) => Promise<unknown>;

const nativeRetryLogin: OriginBrowserRetryLoginTransport = (request) =>
  invoke(ORIGIN_BROWSER_RETRY_LOGIN_COMMAND, { request });

export interface OriginAutoLoginRetryOptions {
  connection: Connection | undefined;
  /** Latest native login activity for this tab, if any. */
  activity: NativeLoginActivity | undefined;
  /** The attached native attempt whose current page is retried. */
  identity: OriginBrowserIdentity | null;
  /** A native page is attached, visible and not loading. */
  attached: boolean;
  transport?: OriginBrowserRetryLoginTransport;
  /** Reports each answered retry through the shell's status mechanism. */
  onOutcome?: (
    step: OriginAutoLoginRetryStep,
    outcome: OriginAutoLoginRetryOutcome,
  ) => void;
  now?: () => number;
}

export interface OriginAutoLoginRetryStepState {
  available: boolean;
  reason: "no-credentials" | "no-mfa" | "busy" | "wait" | null;
}

/**
 * Retry automatic login on the page that is open now, without reloading or
 * reconnecting. Native re-runs the same adapter under the same checks as the
 * first sign-in (owner lease, attempt, exact origin, saved consent, steps);
 * the shell names only the attempt and the step, never a credential or code.
 *
 * A 2FA retry waits until the code period after the last typed code, so it
 * always asks for a new code; native enforces the same rule.
 */
export function useOriginAutoLoginRetry({
  connection,
  activity,
  identity,
  attached,
  transport = nativeRetryLogin,
  onOutcome,
  now = Date.now,
}: OriginAutoLoginRetryOptions) {
  const configuration = originAutoLoginRetryConfiguration(connection);
  const [pending, setPending] = useState(false);
  const pendingRef = useRef(false);
  const alive = useRef(true);
  useEffect(() => {
    alive.current = true;
    return () => {
      alive.current = false;
    };
  }, []);
  const freshAt = configuration.mfa
    ? nextFreshCodeAtMs(activity?.codeTypedAtMs, configuration.periodSeconds)
    : 0;
  const clockSource = useRef(now);
  clockSource.current = now;
  const [clock, setClock] = useState(now);
  const waitMs = Math.max(0, freshAt - clock);
  useEffect(() => {
    const read = () => clockSource.current();
    setClock(read());
    if (freshAt <= read()) return;
    const timer = setInterval(() => {
      const at = read();
      setClock(at);
      if (at >= freshAt) clearInterval(timer);
    }, 250);
    return () => clearInterval(timer);
  }, [freshAt]);
  const entering = !!activity && ENTERING.has(activity.stage);
  const busy = pending || entering || !attached || !identity;
  const step = (
    missing: boolean,
    missingReason: OriginAutoLoginRetryStepState["reason"],
    wait: boolean,
  ): OriginAutoLoginRetryStepState => {
    const reason = missing
      ? missingReason
      : busy
        ? "busy"
        : wait && waitMs > 0
          ? "wait"
          : null;
    return { available: reason === null, reason };
  };
  const credentials = step(!configuration.credentials, "no-credentials", false);
  const mfa = step(!configuration.mfa, "no-mfa", true);
  const latest = useRef({
    states: { credentials, mfa },
    identity,
    transport,
    onOutcome,
  });
  latest.current = {
    states: { credentials, mfa },
    identity,
    transport,
    onOutcome,
  };
  const retry = useCallback(
    async (
      target: OriginAutoLoginRetryStep,
    ): Promise<OriginAutoLoginRetryOutcome | null> => {
      const current = latest.current;
      if (
        pendingRef.current ||
        !current.identity ||
        !current.states[target].available
      )
        return null;
      pendingRef.current = true;
      setPending(true);
      let outcome: OriginAutoLoginRetryOutcome;
      try {
        const { ownerDatabaseId, connectionId, sessionId, attemptId } =
          current.identity;
        outcome = parseRetryLoginReceipt(
          await current.transport({
            identity: { ownerDatabaseId, connectionId, sessionId, attemptId },
            step: target,
          }),
        );
      } catch {
        outcome = { status: "unavailable" };
      } finally {
        pendingRef.current = false;
        if (alive.current) setPending(false);
      }
      if (alive.current) latest.current.onOutcome?.(target, outcome);
      return outcome;
    },
    [],
  );
  return {
    enabled: configuration.enabled,
    credentials,
    mfa,
    pending,
    waitSeconds: Math.ceil(waitMs / 1000),
    retry,
  };
}

export type OriginAutoLoginRetryController = ReturnType<
  typeof useOriginAutoLoginRetry
>;
