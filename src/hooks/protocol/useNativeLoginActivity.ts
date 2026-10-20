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
export const nativeLoginReasonCodes = [
  "current-context-rejected",
  "navigation-scope-rejected",
  "adapter-rejected",
  "challenge-timeout",
  "grant-rejected",
  "attempt-stopped",
  "user-cancelled",
  "attempt-timeout",
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
        const specific = (code?: NativeLoginReasonCode) =>
          !!code && !["adapter-rejected", "attempt-stopped"].includes(code);
        const reasonCode =
          sameFailureChain &&
          specific(prior.reasonCode) &&
          !specific(event.reasonCode)
            ? prior.reasonCode
            : event.reasonCode;
        return {
          ...current,
          [event.sessionId]: {
            ...event,
            ...(reasonCode ? { reasonCode } : {}),
            observedAtMs: performance.now(),
            ...(lastActiveStage ? { lastActiveStage } : {}),
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
