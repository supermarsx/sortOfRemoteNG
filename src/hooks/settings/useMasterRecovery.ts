import { useCallback, useEffect, useRef, useState } from "react";
import { getInvoke } from "../../utils/tauri/invoke";

export interface MasterRecoveryChallenge {
  token: string;
  delayMs: number;
  expiresInMs: number;
  verified: string[];
  warnings: string[];
}
export interface MasterRecoveryReport {
  restored: boolean;
  oldWrapperBackup: string | null;
  warnings: string[];
}

/** UI countdown is informational; the native one-shot challenge owns timing,
 * profile/window binding, candidate validation and receipt commit authority. */
export function useMasterRecovery(onRestored: () => Promise<void>) {
  const [challenge, setChallenge] = useState<MasterRecoveryChallenge | null>(
    null,
  );
  const [report, setReport] = useState<MasterRecoveryReport | null>(null);
  const [remainingMs, setRemainingMs] = useState(0);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const pending = useRef<string | null>(null);
  const inFlight = useRef(false);
  const mounted = useRef(true);
  const deadline = useRef(0);
  const expires = useRef(0);
  const refresh = useRef(onRestored);
  refresh.current = onRestored;

  const release = useCallback(async (token: string) => {
    const invoke = await getInvoke();
    if (invoke) await invoke("encryption_cancel_master_recovery", { token });
  }, []);
  const cancel = useCallback(async () => {
    const token = pending.current;
    pending.current = null;
    if (mounted.current) {
      setChallenge(null);
      setRemainingMs(0);
    }
    if (token) await release(token);
  }, [release]);
  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
      const token = pending.current;
      pending.current = null;
      if (token) void release(token).catch(() => undefined);
    };
  }, [release]);
  useEffect(() => {
    if (!challenge) return;
    const update = () => {
      if (Date.now() >= expires.current) {
        void cancel().catch(() => undefined);
        setError("Recovery confirmation expired. Verify the backup again.");
        return;
      }
      setRemainingMs(Math.max(0, deadline.current - Date.now()));
    };
    update();
    const timer = setInterval(update, 250);
    return () => clearInterval(timer);
  }, [challenge, cancel]);

  const prepare = useCallback(
    async (sourcePath: string, backupPassword: string, newPassword: string) => {
      if (inFlight.current) return;
      inFlight.current = true;
      setBusy(true);
      setError(null);
      setReport(null);
      try {
        await cancel();
        const invoke = await getInvoke();
        if (!invoke) throw new Error("Native recovery is unavailable.");
        const next = await invoke<MasterRecoveryChallenge>(
          "encryption_prepare_master_recovery",
          { sourcePath, backupPassword, newPassword },
        );
        if (!mounted.current) {
          await release(next.token);
          return;
        }
        pending.current = next.token;
        deadline.current = Date.now() + next.delayMs;
        expires.current = Date.now() + next.expiresInMs;
        setRemainingMs(next.delayMs);
        setChallenge(next);
      } catch (failure) {
        if (mounted.current)
          setError(
            failure instanceof Error ? failure.message : String(failure),
          );
      } finally {
        inFlight.current = false;
        if (mounted.current) setBusy(false);
      }
    },
    [cancel, release],
  );

  const commit = useCallback(async () => {
    const token = pending.current;
    if (
      !token ||
      inFlight.current ||
      Date.now() < deadline.current ||
      Date.now() >= expires.current
    )
      return;
    inFlight.current = true;
    setBusy(true);
    setError(null);
    try {
      const invoke = await getInvoke();
      if (!invoke) throw new Error("Native recovery is unavailable.");
      const result = await invoke<MasterRecoveryReport>(
        "encryption_commit_master_recovery",
        { token },
      );
      pending.current = null;
      if (!result.restored)
        throw new Error(
          "Native recovery did not confirm a restored key receipt.",
        );
      if (mounted.current) {
        setReport(result);
        setChallenge(null);
      }
      await refresh.current();
    } catch (failure) {
      // Native commit consumes its one-shot candidate before receipt mutation.
      // Always require fresh verification after any uncertain/failed attempt.
      pending.current = null;
      void release(token).catch(() => undefined);
      if (mounted.current) {
        setChallenge(null);
        setError(failure instanceof Error ? failure.message : String(failure));
      }
    } finally {
      inFlight.current = false;
      if (mounted.current) setBusy(false);
    }
  }, [release]);

  return {
    challenge,
    report,
    remainingMs,
    busy,
    error,
    prepare,
    commit,
    cancel,
  };
}
