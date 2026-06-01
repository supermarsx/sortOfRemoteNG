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
  AuditEntry,
  EncryptionStatus,
  LockoutSnapshot,
  MigrationReport,
  SetupMethod,
  UnlockResult,
} from "../../types/encryption/encryption";
import {
  ENCRYPTION_EVENT_LOCKED,
  ENCRYPTION_EVENT_UNLOCKED,
} from "../../types/encryption/encryption";

type InvokeFn = <T>(cmd: string, args?: Record<string, unknown>) => Promise<T>;

async function invokeOrThrow(): Promise<InvokeFn> {
  const inv = await getInvoke();
  if (!inv) throw new Error("Tauri runtime not available");
  return inv as InvokeFn;
}

/** Phase 6 reports. */
export interface DisableSettingsReport {
  sourcePath: string;
  destinationPath: string;
  bytesIn: number;
  bytesOut: number;
}

/** Per-artifact migration counts returned by
 *  `rec_migrate_to_encrypted`. Mirrors the Rust
 *  `RecordingMigrationReport` struct in `sorng-recording`. */
export interface RecordingMigrationReport {
  envelopesMigrated: number;
  envelopesSkipped: number;
  macrosMigrated: number;
  macrosSkipped: number;
}

export interface RotateReport {
  artifactsRewritten: number;
  bytesRewritten: number;
  vaultUpdated: boolean;
  dekEncUpdated: boolean;
}

export interface UseEncryption {
  status: EncryptionStatus | null;
  loading: boolean;
  error: string | null;
  /** Live lockout state for password-mode unlock attempts. */
  lockout: LockoutSnapshot | null;
  refresh: () => Promise<void>;
  refreshLockout: () => Promise<void>;
  setup: (method: SetupMethod) => Promise<UnlockResult>;
  unlock: (password?: string) => Promise<UnlockResult>;
  lock: () => Promise<void>;
  changePassword: (
    oldPassword: string,
    newPassword: string,
    argon2?: Argon2Params,
  ) => Promise<void>;
  migrateSettings: () => Promise<MigrationReport>;
  /** Convert every plaintext recording envelope + macro under the
   *  recordings storage root to its `.json.enc` v2 form. Returns the
   *  per-artifact migrated/skipped counts. */
  migrateRecordings: () => Promise<RecordingMigrationReport>;
  /** Decrypt `settings.enc` back to plaintext `settings.json` and
   *  delete the encrypted file. Master key stays alive for other
   *  artifacts. */
  disableSettings: () => Promise<DisableSettingsReport>;
  /** Generate a fresh master DEK, re-encrypt every artifact under
   *  new sub-keys, update vault + dek.enc to match. `password` is
   *  required iff `dek.enc` is currently on disk. */
  rotateMasterKey: (password?: string) => Promise<RotateReport>;
  /** Write the master DEK as a portable wrapped blob at the chosen
   *  path. Returns the file size in bytes. */
  exportPortableDek: (
    destinationPath: string,
    password: string,
    argon2?: Argon2Params,
  ) => Promise<number>;
  /** Read a portable wrapped DEK at `sourcePath`, unwrap with
   *  `password`, install as the local master key. */
  importPortableDek: (
    sourcePath: string,
    password: string,
  ) => Promise<void>;
  /** Latest audit entries (newest last). Fetched on mount and after
   *  every mutating action. Empty array outside Tauri. */
  audit: AuditEntry[];
  /** Force a re-fetch of the audit log. */
  refreshAudit: () => Promise<void>;
  /** Truncate the audit log. The Rust side stamps a "log-cleared"
   *  entry immediately after so the gap is visible. */
  clearAudit: () => Promise<void>;
}

export function useEncryption(): UseEncryption {
  const [status, setStatus] = useState<EncryptionStatus | null>(null);
  const [lockout, setLockout] = useState<LockoutSnapshot | null>(null);
  const [audit, setAudit] = useState<AuditEntry[]>([]);
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

  const refreshLockout = useCallback(async () => {
    try {
      const inv = await getInvoke();
      if (!inv) {
        setLockout(null);
        return;
      }
      const next =
        await (inv as InvokeFn)<LockoutSnapshot>("encryption_lockout_state");
      setLockout(next);
    } catch {
      // Lockout file errors are non-fatal; surface as "no cooldown".
      setLockout(null);
    }
  }, []);

  const refreshAudit = useCallback(async () => {
    try {
      const inv = await getInvoke();
      if (!inv) {
        setAudit([]);
        return;
      }
      const next = await (inv as InvokeFn)<AuditEntry[]>("encryption_audit_read", {
        limit: 100,
      });
      setAudit(next);
    } catch {
      // Audit-log errors are non-fatal; surface as empty.
      setAudit([]);
    }
  }, []);

  useEffect(() => {
    void refresh();
    void refreshLockout();
    void refreshAudit();
  }, [refresh, refreshLockout, refreshAudit]);

  // Subscribe to cross-window unlock/lock broadcasts so secondary
  // windows refresh status without polling. The dynamic import keeps
  // jsdom tests free of `@tauri-apps/api/event` requirements.
  useEffect(() => {
    let unlistenUnlocked: (() => void) | undefined;
    let unlistenLocked: (() => void) | undefined;
    let cancelled = false;
    (async () => {
      try {
        const mod = await import("@tauri-apps/api/event");
        if (cancelled) return;
        unlistenUnlocked = await mod.listen(ENCRYPTION_EVENT_UNLOCKED, () => {
          void refresh();
          void refreshLockout();
        });
        unlistenLocked = await mod.listen(ENCRYPTION_EVENT_LOCKED, () => {
          void refresh();
        });
      } catch {
        // Outside Tauri — broadcast unavailable; that's fine.
      }
    })();
    return () => {
      cancelled = true;
      unlistenUnlocked?.();
      unlistenLocked?.();
    };
  }, [refresh, refreshLockout]);

  // Live-update the cool-down every 250 ms while one is active. Stops
  // ticking when remainingCooldownMs hits zero so the hook isn't a
  // background CPU sink.
  useEffect(() => {
    if (!lockout || lockout.remainingCooldownMs === 0) return;
    const handle = window.setInterval(() => {
      void refreshLockout();
    }, 250);
    return () => window.clearInterval(handle);
  }, [lockout, refreshLockout]);

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
      await refreshLockout();
      return result;
    },
    [refresh, refreshLockout],
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

  const migrateRecordings = useCallback(
    async (): Promise<RecordingMigrationReport> => {
      const inv = await invokeOrThrow();
      const report = await inv<RecordingMigrationReport>(
        "rec_migrate_to_encrypted",
      );
      await refresh();
      return report;
    },
    [refresh],
  );

  const disableSettings = useCallback(
    async (): Promise<DisableSettingsReport> => {
      const inv = await invokeOrThrow();
      const report = await inv<DisableSettingsReport>(
        "encryption_disable_settings",
      );
      await refresh();
      return report;
    },
    [refresh],
  );

  const rotateMasterKey = useCallback(
    async (password?: string): Promise<RotateReport> => {
      const inv = await invokeOrThrow();
      const report = await inv<RotateReport>("encryption_rotate_master_key", {
        password: password ?? null,
      });
      await refresh();
      return report;
    },
    [refresh],
  );

  const exportPortableDek = useCallback(
    async (
      destinationPath: string,
      password: string,
      argon2?: Argon2Params,
    ): Promise<number> => {
      const inv = await invokeOrThrow();
      return inv<number>("encryption_export_portable_dek", {
        destinationPath,
        password,
        argon2: argon2 ?? null,
      });
    },
    [],
  );

  const importPortableDek = useCallback(
    async (sourcePath: string, password: string): Promise<void> => {
      const inv = await invokeOrThrow();
      await inv<void>("encryption_import_portable_dek", {
        sourcePath,
        password,
      });
      await refresh();
      await refreshLockout();
      await refreshAudit();
    },
    [refresh, refreshLockout, refreshAudit],
  );

  const clearAudit = useCallback(async (): Promise<void> => {
    const inv = await invokeOrThrow();
    await inv<void>("encryption_audit_clear");
    await refreshAudit();
  }, [refreshAudit]);

  return {
    status,
    lockout,
    audit,
    loading,
    error,
    refresh,
    refreshLockout,
    refreshAudit,
    clearAudit,
    setup,
    unlock,
    lock,
    changePassword,
    migrateSettings,
    migrateRecordings,
    disableSettings,
    rotateMasterKey,
    exportPortableDek,
    importPortableDek,
  };
}
