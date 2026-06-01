/**
 * `useEncryption` — React hook wrapping the six `encryption_*` Tauri
 * commands the encryption-at-rest subsystem ships with after Phases
 * 0–3.
 *
 * The hook caches `status` in component state and exposes `refresh()`
 * so callers can re-fetch after a mutating action (setup, unlock,
 * migration, password change). Mutating actions automatically refresh
 * — the caller doesn't need to do anything special.
 *
 * Outside Tauri (jsdom tests, plain browser dev server) every command
 * resolves to a sentinel `null` status with a benign error logged via
 * `console.debug`. Components render their "encryption unavailable"
 * placeholder.
 */

import { useCallback, useEffect, useState } from "react";
import { getInvoke } from "../../utils/tauri/invoke";
import type {
  Argon2Params,
  EncryptionStatus,
  MigrationReport,
  SetupMethod,
  UnlockResult,
} from "../../types/encryption/encryption";

type InvokeFn = <T>(cmd: string, args?: Record<string, unknown>) => Promise<T>;

async function invokeOrThrow(): Promise<InvokeFn> {
  const inv = await getInvoke();
  if (!inv) throw new Error("Tauri runtime not available");
  return inv as InvokeFn;
}

export interface UseEncryption {
  status: EncryptionStatus | null;
  loading: boolean;
  error: string | null;
  refresh: () => Promise<void>;
  setup: (method: SetupMethod) => Promise<UnlockResult>;
  unlock: (password?: string) => Promise<UnlockResult>;
  lock: () => Promise<void>;
  changePassword: (
    oldPassword: string,
    newPassword: string,
    argon2?: Argon2Params,
  ) => Promise<void>;
  migrateSettings: () => Promise<MigrationReport>;
}

export function useEncryption(): UseEncryption {
  const [status, setStatus] = useState<EncryptionStatus | null>(null);
  const [loading, setLoading] = useState<boolean>(true);
  const [error, setError] = useState<string | null>(null);

  const refresh = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const inv = await getInvoke();
      if (!inv) {
        setStatus(null);
        return;
      }
      const next = await (inv as InvokeFn)<EncryptionStatus>(
        "encryption_status",
      );
      setStatus(next);
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      setError(msg);
      setStatus(null);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  const setup = useCallback(
    async (method: SetupMethod): Promise<UnlockResult> => {
      const inv = await invokeOrThrow();
      const result = await inv<UnlockResult>("encryption_setup", { method });
      await refresh();
      return result;
    },
    [refresh],
  );

  const unlock = useCallback(
    async (password?: string): Promise<UnlockResult> => {
      const inv = await invokeOrThrow();
      const result = await inv<UnlockResult>("encryption_unlock", {
        password: password ?? null,
      });
      await refresh();
      return result;
    },
    [refresh],
  );

  const lock = useCallback(async (): Promise<void> => {
    const inv = await invokeOrThrow();
    await inv<void>("encryption_lock");
    await refresh();
  }, [refresh]);

  const changePassword = useCallback(
    async (
      oldPassword: string,
      newPassword: string,
      argon2?: Argon2Params,
    ): Promise<void> => {
      const inv = await invokeOrThrow();
      await inv<void>("encryption_change_password", {
        oldPassword,
        newPassword,
        argon2: argon2 ?? null,
      });
      await refresh();
    },
    [refresh],
  );

  const migrateSettings = useCallback(async (): Promise<MigrationReport> => {
    const inv = await invokeOrThrow();
    const report = await inv<MigrationReport>("encryption_migrate_settings");
    await refresh();
    return report;
  }, [refresh]);

  return {
    status,
    loading,
    error,
    refresh,
    setup,
    unlock,
    lock,
    changePassword,
    migrateSettings,
  };
}
