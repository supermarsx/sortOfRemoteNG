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

/** Tauri event name emitted by `rec_migrate_to_encrypted` as it walks
 *  each artifact. Match the Rust-side `REC_MIGRATE_EVENT` constant. */
export const REC_MIGRATE_EVENT = "recording-migrate-progress";

/** Payload shape for every event on [`REC_MIGRATE_EVENT`]. Mirrors
 *  `sorng_recording::service::RecordingMigrationProgressEvent`. */
export interface RecordingMigrationProgressEvent {
  /** `"envelopes"` or `"macros"`. The stage tag lets the UI render
   *  two progress bars / a stage label. */
  stage: "envelopes" | "macros" | string;
  /** 1-based index of the file just processed. The opening event
   *  for each stage has `index === 0`. */
  index: number;
  /** Total file count for the active stage. Equal across every
   *  event for that stage. */
  total: number;
  /** Basename of the file just processed. Empty on the opening
   *  `index === 0` event. */
  name: string;
  /** `true` when the file was skipped (unreadable / unparseable),
   *  `false` when it was migrated. */
  skipped: boolean;
}

export interface RotateReport {
  artifactsRewritten: number;
  bytesRewritten: number;
  vaultUpdated: boolean;
  dekEncUpdated: boolean;
}

/** Full-artifact rotation report. Mirrors the Rust
 *  `FullRotateReport` returned by
 *  `encryption_rotate_master_key_full`. */
export interface FullRotateReport {
  settingsRewritten: boolean;
  connectionsRewritten: boolean;
  backupsRewritten: number;
  recordingEnvelopesRewritten: number;
  mediaSidecarsRewritten: number;
  macrosRewritten: number;
  bytesRewritten: number;
  vaultUpdated: boolean;
  dekEncUpdated: boolean;
  failures: FullRotateFailure[];
}

export interface FullRotateFailure {
  artifact: string;
  path: string;
  reason: string;
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
   *  per-artifact migrated/skipped counts.
   *
   *  `onProgress` (optional) is invoked for every progress event the
   *  backend emits on `recording-migrate-progress`. The first event
   *  per stage has `index === 0` and reports the file `total`; each
   *  subsequent event marks one file processed. */
  migrateRecordings: (
    onProgress?: (event: RecordingMigrationProgressEvent) => void,
  ) => Promise<RecordingMigrationReport>;
  /** Flip the cooperative cancel flag on the in-flight recording
   *  migration. Safe to call when no migration is running. */
  cancelRecordingsMigration: () => Promise<void>;
  /** Decrypt `settings.enc` back to plaintext `settings.json` and
   *  delete the encrypted file. Master key stays alive for other
   *  artifacts. */
  disableSettings: () => Promise<DisableSettingsReport>;
  /** Legacy rotation — only rotates `settings.enc` + key-storage
   *  receipts. Prefer [`rotateMasterKeyFull`] for any user-facing
   *  "Rotate" button; this entry point is retained for callers that
   *  genuinely want the settings-only behaviour. */
  rotateMasterKey: (password?: string) => Promise<RotateReport>;
  /** Generate a fresh master DEK, re-encrypt every persisted
   *  artifact under new sub-keys (settings, connections database,
   *  every v2 backup file, recording metadata, recording-media
   *  sidecars, macros), then update vault + dek.enc. `password` is
   *  required iff `dek.enc` is currently on disk. */
  rotateMasterKeyFull: (password?: string) => Promise<FullRotateReport>;
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
    async (
      onProgress?: (event: RecordingMigrationProgressEvent) => void,
    ): Promise<RecordingMigrationReport> => {
      const inv = await invokeOrThrow();
      // Subscribe to the progress event before invoking the command —
      // otherwise the first few `total` / `step` events may fire
      // before the listener is attached and the UI would show 0% for
      // a moment that the migrator has actually moved past.
      let unlisten: (() => void) | null = null;
      if (onProgress) {
        try {
          const { listen } = await import("@tauri-apps/api/event");
          const handle = await listen<RecordingMigrationProgressEvent>(
            REC_MIGRATE_EVENT,
            (e) => onProgress(e.payload),
          );
          unlisten = handle;
        } catch {
          // Event API unavailable (web / jsdom) — degrade silently.
        }
      }
      try {
        const report = await inv<RecordingMigrationReport>(
          "rec_migrate_to_encrypted",
        );
        await refresh();
        return report;
      } finally {
        if (unlisten) unlisten();
      }
    },
    [refresh],
  );

  const cancelRecordingsMigration = useCallback(async (): Promise<void> => {
    const inv = await invokeOrThrow();
    await inv<void>("rec_cancel_migration");
  }, []);

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

  const rotateMasterKeyFull = useCallback(
    async (password?: string): Promise<FullRotateReport> => {
      const inv = await invokeOrThrow();
      const report = await inv<FullRotateReport>(
        "encryption_rotate_master_key_full",
        { password: password ?? null },
      );
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
    cancelRecordingsMigration,
    disableSettings,
    rotateMasterKey,
    rotateMasterKeyFull,
    exportPortableDek,
    importPortableDek,
  };
}
