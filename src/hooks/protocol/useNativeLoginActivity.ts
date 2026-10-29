import { useEffect, useState } from "react";
import { listen } from "@tauri-apps/api/event";

export const NATIVE_LOGIN_ACTIVITY_EVENT = "origin-browser-login-activity";
export const loginActivityStages = [
  "waiting-page",
  "security-check",
  "filling-username",
  "filling-password",
  "submitting",
  "waiting-2fa",
  "typing-code",
  "completed",
  "held",
  "cancelled",
  "stopped",
] as const;
export type NativeLoginStage = (typeof loginActivityStages)[number];
/** Fixed causes a page adapter names when it stops (NativeLoginRejection). */
export const nativeLoginAdapterStopReasonCodes = [
  "verification-required",
  "credentials-rejected",
  "focus-unavailable",
  "user-input",
  "page-changed",
  "field-not-empty",
  "submit-unavailable",
  "step-not-found",
  "expired",
] as const;
export const nativeLoginReasonCodes = [
  "current-context-rejected",
  "navigation-scope-rejected",
  "adapter-rejected",
  "challenge-timeout",
  "grant-rejected",
  "address-mismatch",
  "consent-expired",
  "attempt-stopped",
  "user-cancelled",
  "attempt-timeout",
  ...nativeLoginAdapterStopReasonCodes,
] as const;
export type NativeLoginReasonCode = (typeof nativeLoginReasonCodes)[number];
export interface NativeLoginActivity {
  connectionId: string;
  sessionId: string;
  attemptId: string;
  stage: NativeLoginStage;
  timestampMs: number;
  elapsedMs: number;
  /** Shell monotonic observation time; never taken from the native payload. */
  observedAtMs?: number;
  /** Fixed native diagnostic code; never arbitrary page or account text. */
  reasonCode?: NativeLoginReasonCode;
  /** Derived from preceding events in this exact attempt, not payload text. */
  lastActiveStage?: NativeLoginStage;
  /** Native time of this tab's latest one-time-code entry, in any attempt.
   * Lets a retry wait for the next code period instead of reusing a code. */
  codeTypedAtMs?: number;
}

/** Keep only native-owned identifiers and fixed stages, never payload text. */
export function parseNativeLoginActivity(
  value: unknown,
): NativeLoginActivity | null {
  if (!value || typeof value !== "object") return null;
  const raw = value as Record<string, unknown>;
  const keys = ["connectionId", "sessionId", "attemptId"] as const;
  if (
    keys.some(
      (key) =>
        typeof raw[key] !== "string" ||
        !/^[a-zA-Z0-9_.:-]{1,256}$/.test(raw[key] as string),
    )
  )
    return null;
  if (!loginActivityStages.includes(raw.stage as NativeLoginStage)) return null;
  if (
    ![raw.timestampMs, raw.elapsedMs].every(
      (n) => typeof n === "number" && Number.isSafeInteger(n) && n >= 0,
    )
  )
    return null;
  return {
    connectionId: raw.connectionId as string,
    sessionId: raw.sessionId as string,
    attemptId: raw.attemptId as string,
    stage: raw.stage as NativeLoginStage,
    timestampMs: raw.timestampMs as number,
    elapsedMs: raw.elapsedMs as number,
    ...(nativeLoginReasonCodes.includes(raw.reasonCode as NativeLoginReasonCode)
      ? { reasonCode: raw.reasonCode as NativeLoginReasonCode }
      : {}),
  };
}

export function useNativeLoginActivity(sessionIds: readonly string[]) {
  const [activity, setActivity] = useState<Record<string, NativeLoginActivity>>(
    {},
  );
  const key = JSON.stringify(sessionIds);
  useEffect(() => {
    const ids = new Set<string>(JSON.parse(key));
    setActivity((current) =>
      Object.fromEntries(Object.entries(current).filter(([id]) => ids.has(id))),
    );
    let disposed = false;
    let unlisten: (() => void) | undefined;
    void listen<unknown>(NATIVE_LOGIN_ACTIVITY_EVENT, ({ payload }) => {
      if (disposed) return;
      const event = parseNativeLoginActivity(payload);
      if (!event || !ids.has(event.sessionId)) return;
      setActivity((current) => {
        const prior = current[event.sessionId];
        if (prior && prior.timestampMs > event.timestampMs) return current;
        const terminal = ["cancelled", "stopped", "completed", "held"].includes(
          event.stage,
        );
        const lastActiveStage =
          terminal &&
          prior?.attemptId === event.attemptId &&
          prior.connectionId === event.connectionId
            ? ["cancelled", "stopped", "completed", "held"].includes(
                prior.stage,
              )
              ? prior.lastActiveStage
              : prior.stage
            : undefined;
        const priorFailure =
          prior && ["cancelled", "stopped", "held"].includes(prior.stage);
        const sameFailureChain =
          terminal &&
          event.stage !== "completed" &&
          priorFailure &&
          prior.attemptId === event.attemptId &&
          prior.connectionId === event.connectionId;
        // A native cause outranks the page adapter's own stop cause, which
        // outranks a causeless code. Within one failure chain a later, less
        // specific report never hides an earlier, more specific one.
        const rank = (code?: NativeLoginReasonCode) =>
          !code || ["adapter-rejected", "attempt-stopped"].includes(code)
            ? 0
            : (nativeLoginAdapterStopReasonCodes as readonly string[]).includes(
                  code,
                )
              ? 1
              : 2;
        const reasonCode =
          sameFailureChain &&
          rank(prior.reasonCode) > 0 &&
          rank(prior.reasonCode) > rank(event.reasonCode)
            ? prior.reasonCode
            : event.reasonCode;
        const codeTypedAtMs =
          event.stage === "typing-code"
            ? event.timestampMs
            : prior?.connectionId === event.connectionId
              ? prior.codeTypedAtMs
              : undefined;
        return {
          ...current,
          [event.sessionId]: {
            ...event,
            ...(reasonCode ? { reasonCode } : {}),
            observedAtMs: performance.now(),
            ...(lastActiveStage ? { lastActiveStage } : {}),
            ...(codeTypedAtMs === undefined ? {} : { codeTypedAtMs }),
          },
        };
      });
    })
      .then((stop) => {
        if (disposed) stop();
        else unlisten = stop;
      })
      .catch(() => {});
    return () => {
      disposed = true;
      unlisten?.();
    };
  }, [key]);
  return activity;
}
