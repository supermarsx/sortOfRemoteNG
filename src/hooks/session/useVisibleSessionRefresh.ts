import { useCallback, useEffect, useRef } from "react";

export interface SessionRefreshLease {
  /** False after a newer invalidation, deactivation, or document hiding. */
  isCurrent(): boolean;
}
interface Options {
  enabled: boolean;
  load(lease: SessionRefreshLease): Promise<void>;
  /** Lifecycle identity only; do not pass activity counters or output buffers. */
  invalidationKey?: string;
  intervalMs?: number;
}
interface Controller {
  request(delay?: number): Promise<void>;
  cancel(): void;
  finish(): void;
}

/** One in-flight request, one coalesced follow-up, and no hidden polling. */
export function useVisibleSessionRefresh({
  enabled,
  load,
  invalidationKey = "",
  intervalMs = 15_000,
}: Options) {
  const loadRef = useRef(load);
  const enabledRef = useRef(enabled);
  const versionRef = useRef(0);
  const inFlightRef = useRef(false);
  const controllerRef = useRef<Controller | null>(null);
  const completionRef = useRef<{
    version: number;
    promise: Promise<void>;
    resolve(): void;
  } | null>(null);
  loadRef.current = load;
  enabledRef.current = enabled;

  useEffect(() => {
    let live = true;
    let queued = false;
    let timer: ReturnType<typeof setTimeout> | undefined;
    const active = () => live && enabledRef.current && !document.hidden;
    const clearTimer = () => {
      if (timer !== undefined) clearTimeout(timer);
      timer = undefined;
    };
    const invalidate = () => {
      versionRef.current++;
      clearTimer();
    };
    const settle = (version: number) => {
      const completion = completionRef.current;
      if (completion && completion.version <= version) {
        completionRef.current = null;
        completion.resolve();
      }
    };
    const pump = async () => {
      if (!active() || !queued || inFlightRef.current) return;
      clearTimer();
      queued = false;
      inFlightRef.current = true;
      const version = versionRef.current;
      try {
        await loadRef.current({
          isCurrent: () => active() && version === versionRef.current,
        });
      } catch {
        // Source hooks retain their own actionable errors. A rejected refresh
        // must still release the scheduling slot and allow the next update.
      } finally {
        if (version === versionRef.current) settle(version);
        inFlightRef.current = false;
        controllerRef.current?.finish();
      }
    };
    const request = (delay = 0): Promise<void> => {
      invalidate();
      if (!active()) return Promise.resolve();
      queued = true;
      if (completionRef.current)
        completionRef.current.version = versionRef.current;
      else {
        let resolve!: () => void;
        const promise = new Promise<void>((done) => {
          resolve = done;
        });
        completionRef.current = {
          version: versionRef.current,
          promise,
          resolve,
        };
      }
      const completion = completionRef.current.promise;
      if (delay > 0) timer = setTimeout(() => void pump(), delay);
      else void pump();
      return completion;
    };
    const finish = () => {
      if (!active()) return;
      if (queued) void pump();
      else if (intervalMs > 0)
        timer = setTimeout(() => request(), Math.max(1_000, intervalMs));
    };
    const cancel = () => {
      invalidate();
      queued = false;
      settle(versionRef.current);
      if (!inFlightRef.current) finish();
    };
    const controller = { request, cancel, finish };
    controllerRef.current = controller;
    const visibilityChanged = () => {
      if (document.hidden) {
        queued = false;
        invalidate();
        settle(versionRef.current);
      } else request();
    };
    const focus = () => {
      if (intervalMs > 0) request(150);
    };
    document.addEventListener("visibilitychange", visibilityChanged);
    window.addEventListener("focus", focus);
    request();
    const lifecycleVersion = versionRef;
    return () => {
      live = false;
      queued = false;
      invalidate();
      settle(lifecycleVersion.current);
      if (controllerRef.current === controller) controllerRef.current = null;
      document.removeEventListener("visibilitychange", visibilityChanged);
      window.removeEventListener("focus", focus);
    };
  }, [enabled, intervalMs]);

  const firstInvalidation = useRef(invalidationKey);
  useEffect(() => {
    if (firstInvalidation.current === invalidationKey) return;
    firstInvalidation.current = invalidationKey;
    controllerRef.current?.request(150);
  }, [invalidationKey]);

  // Resolves after the requested/coalesced read finishes, or its activation is
  // cancelled. Existing async panel callers can still await refresh completion.
  const refresh = useCallback(
    () => controllerRef.current?.request() ?? Promise.resolve(),
    [],
  );
  const invalidate = useCallback(() => {
    controllerRef.current?.cancel();
  }, []);
  return { refresh, invalidate };
}

/** Compare plain, acyclic IPC DTOs only (not Dates/classes or cyclic objects). */
export function sameSessionSnapshot(left: unknown, right: unknown): boolean {
  if (Object.is(left, right)) return true;
  if (!left || !right || typeof left !== "object" || typeof right !== "object")
    return false;
  if (Array.isArray(left) !== Array.isArray(right)) return false;
  const a = left as Record<string, unknown>;
  const b = right as Record<string, unknown>;
  const keys = Object.keys(a);
  return (
    keys.length === Object.keys(b).length &&
    keys.every(
      (key) =>
        Object.prototype.hasOwnProperty.call(b, key) &&
        sameSessionSnapshot(a[key], b[key]),
    )
  );
}
