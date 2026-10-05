import { useEffect, useRef, useState } from "react";
import { useEncryption } from "./useEncryption";
import {
  ENCRYPTION_EVENT_LOCKED,
  ENCRYPTION_EVENT_UNLOCKED,
} from "../../types/encryption/encryption";
import type { LockReason } from "./useEncryption";
import { DatabaseManager } from "../../utils/connection/databaseManager";
import { shouldShowUnlockScreen } from "../../components/encryption/unlockScreenVisibility";
import {
  executeMainGlobalLock,
  GLOBAL_LOCK_REQUEST,
  GLOBAL_LOCK_RESPONSE,
  registerGlobalLockExecutor,
} from "../../utils/security/globalEncryptionLock";
import { withDatabaseMutation } from "../../utils/connection/databaseActions";
import { getInvoke } from "../../utils/tauri/invoke";
import { useSettings } from "../../contexts/SettingsContext";

interface GuardOptions {
  primary?: boolean;
  flushCurrent?: () => Promise<void>;
  prepareViews?: (isCurrent: () => boolean) => Promise<void>;
  /** Recheck after each await before touching views; unlock retires this cleanup. */
  clearViews: (isCurrent: () => boolean) => Promise<void> | void;
}

/** Every app window blocks immediately on native lock; only main initiates a durable lock. */
export function useGlobalEncryptionGuard(options: GuardOptions) {
  const enc = useEncryption();
  const { settingsReady, settings } = useSettings();
  const policyRef = useRef(settings.autoLock);
  policyRef.current = settings.autoLock;
  const settingsReadyRef = useRef(settingsReady);
  settingsReadyRef.current = settingsReady;
  const manager = DatabaseManager.getInstance();
  const latest = useRef(options);
  latest.current = options;
  const [eventLocked, setEventLocked] = useState(false);
  const authoritativeEvent = useRef<"locked" | "unlocked" | null>(null);
  const handled = useRef(false);
  const lifecycle = useRef(0);
  useEffect(
    () => () => {
      lifecycle.current++;
    },
    [],
  );
  const lockedRef = useRef<() => void>(() => {});
  lockedRef.current = () => {
    setEventLocked(true);
    if (handled.current) return;
    handled.current = true;
    const generation = lifecycle.current;
    manager.invalidatePendingDatabaseOperations();
    void Promise.resolve(
      latest.current.clearViews(() => lifecycle.current === generation),
    ).catch((error: unknown) =>
      console.error("Storage locked; view cleanup failed", error),
    );
  };
  useEffect(() => {
    // Native event order is authoritative once observed. A status request
    // started before that event may resolve later with the opposite state.
    if (authoritativeEvent.current) return;
    if (enc.status?.unlocked && !eventLocked) {
      handled.current = false;
    } else if (shouldShowUnlockScreen(enc.status)) lockedRef.current();
  }, [enc.status, eventLocked]);
  useEffect(() => {
    if (!options.primary) return;
    return registerGlobalLockExecutor((nativeLock, request) => {
      const generation = lifecycle.current;
      const isCurrent = () => lifecycle.current === generation;
      const automatic =
        request.reason === "idle" ||
        request.reason === "blur" ||
        request.reason === "minimize" ||
        request.reason === "visibility-hidden";
      const shouldProceed = () => {
        if (!isCurrent()) return false;
        if (!automatic) return true;
        const policy = policyRef.current;
        if (!policy?.enabled || request.isCurrent?.() === false) return false;
        switch (request.reason) {
          case "idle":
            return !!policy.lockOnIdle && policy.timeoutMinutes > 0;
          case "blur":
            return !!policy.lockOnBlur;
          case "minimize":
            return !!policy.lockOnMinimize;
          case "visibility-hidden":
            return !!policy.lockOnVisibilityHidden;
          default:
            return false;
        }
      };
      return withDatabaseMutation(manager, async () => {
        if (!shouldProceed()) return;
        if (settingsReadyRef.current === false)
          throw new Error(
            "Global settings have not loaded. Unlock storage and reload settings before locking again.",
          );
        await latest.current.flushCurrent?.();
        if (!shouldProceed()) return;
        await latest.current.prepareViews?.(shouldProceed);
        if (!shouldProceed()) return;
        await latest.current.flushCurrent?.();
        // Commit point: no asynchronous work between the policy check and
        // invalidation. Once committed, finish the lock even if policy changes.
        if (!shouldProceed()) return;
        manager.invalidatePendingDatabaseOperations();
        await latest.current.clearViews(isCurrent);
        if (!isCurrent()) return;
        await nativeLock();
        if (isCurrent()) lockedRef.current();
      });
    });
  }, [manager, options.primary]);
  useEffect(() => {
    let disposed = false;
    const off: (() => void)[] = [];
    const requests = new Map<string, Promise<string | undefined>>();
    void (async () => {
      if (!(await getInvoke())) return;
      const { listen, emitTo } = await import("@tauri-apps/api/event");
      const lockOff = await listen(ENCRYPTION_EVENT_LOCKED, () => {
        if (disposed) return;
        authoritativeEvent.current = "locked";
        lockedRef.current();
      });
      if (disposed) {
        lockOff();
        return;
      }
      off.push(lockOff);
      const unlockOff = await listen(ENCRYPTION_EVENT_UNLOCKED, () => {
        if (disposed) return;
        lifecycle.current++;
        authoritativeEvent.current = "unlocked";
        handled.current = false;
        setEventLocked(false);
      });
      if (disposed) {
        unlockOff();
        return;
      }
      off.push(unlockOff);
      if (!options.primary) return;
      const requestOff = await listen<{
        requestId: string;
        windowLabel: string;
        reason?: LockReason;
      }>(GLOBAL_LOCK_REQUEST, ({ payload }) => {
        if (disposed) return;
        if (
          !payload ||
          typeof payload.requestId !== "string" ||
          typeof payload.windowLabel !== "string"
        )
          return;
        let action = requests.get(payload.requestId);
        if (!action) {
          action = executeMainGlobalLock(
            async () => {
              const invoke = await getInvoke();
              if (!invoke) throw new Error("Native encryption is unavailable.");
              await invoke("encryption_lock", {
                reason: payload.reason ?? "manual",
              });
            },
            { reason: payload.reason },
          ).then(
            () => undefined,
            (error: unknown) =>
              error instanceof Error ? error.message : String(error),
          );
          requests.set(payload.requestId, action);
          if (requests.size > 128)
            requests.delete(requests.keys().next().value!);
        }
        void action
          .then((error) => {
            if (!disposed)
              return emitTo(payload.windowLabel, GLOBAL_LOCK_RESPONSE, {
                requestId: payload.requestId,
                error,
              });
          })
          .catch((error: unknown) =>
            console.error("Unable to acknowledge storage lock", error),
          );
      });
      if (disposed) requestOff();
      else off.push(requestOff);
    })().catch((error: unknown) => {
      if (!disposed)
        console.error("Storage lock event subscription failed", error);
    });
    return () => {
      disposed = true;
      off.forEach((stop) => stop());
    };
  }, [options.primary]);
  return (
    eventLocked ||
    (authoritativeEvent.current === null &&
      shouldShowUnlockScreen(enc.status)) ||
    settingsReady === false
  );
}
