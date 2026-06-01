/**
 * TypeScript mirror of `sorng_encryption::commands` DTOs.
 *
 * Serde-side rules in effect:
 * - `EncryptionStatus` field names: `#[serde(rename_all = "camelCase")]`
 * - `SetupMethod` / `UnlockResult` / `MasterKeyStorage` variants:
 *   `#[serde(rename_all = "kebab-case")]`
 * - `Argon2Params` field names: `#[serde(rename_all = "camelCase")]`
 *
 * Keep these types in sync by hand — the Rust side is the source of
 * truth. A drift caught at runtime would surface as a `serde_json`
 * deserialize error in the Tauri command bridge.
 */

/** How the master DEK is reconstructed at unlock time. */
export type MasterKeyStorage = "vault" | "password" | "vault-and-password";

/** Outcome of an unlock / setup attempt. */
export type UnlockResult =
  | "unlocked-from-vault"
  | "unlocked-from-password"
  | "already-unlocked"
  | "needs-setup"
  | "password-required"
  | "vault-unavailable"
  | "wrong-password";

/** OWASP-recommended Argon2id parameters. Caller can override; the
 *  Rust side `validate()` enforces floors/ceilings. */
export interface Argon2Params {
  memoryKib: number;
  timeCost: number;
  parallelism: number;
}

export const ARGON2_OWASP: Argon2Params = {
  memoryKib: 65_536,
  timeCost: 3,
  parallelism: 4,
};

/** Discriminated union matching the Rust `SetupMethod` enum. */
export type SetupMethod =
  | "vault"
  | { password: { password: string; argon2?: Argon2Params } }
  | { "vault-and-password": { password: string; argon2?: Argon2Params } };

/** What the Settings → Security panel needs to render its status badge. */
export interface EncryptionStatus {
  schemaVersion: 0 | 2;
  masterKeyStorage: MasterKeyStorage | null;
  unlocked: boolean;
  vaultAvailable: boolean;
  vaultHasMasterDek: boolean;
  vaultBackend: string;
  artifactLabels: string[];
  passwordWrapPresent: boolean;
  settingsEncryptedOnDisk: boolean;
  settingsPlaintextPresent: boolean;
}

/** Report produced by `encryption_migrate_settings`. */
export interface MigrationReport {
  sourcePath: string;
  destinationPath: string;
  backupPath: string;
  bytesIn: number;
  bytesOut: number;
  masterKeyStorage: MasterKeyStorage;
}

/** Snapshot of the password-unlock cool-down counters. Returned by
 *  `encryption_lockout_state`. */
export interface LockoutSnapshot {
  failedAttempts: number;
  lastFailureUnixMs: number;
  remainingCooldownMs: number;
}

/** One audit-log entry. Mirrors the Rust `AuditEntry` struct:
 *  timestamp + kebab-case event tag + free-form metadata flattened
 *  at the root. */
export interface AuditEntry {
  ts: string;
  event: string;
  [key: string]: unknown;
}

/** Human-readable label for each audit event tag. */
export const AUDIT_EVENT_LABELS: Record<string, string> = {
  "setup-completed": "Setup completed",
  "unlock-success": "Unlock succeeded",
  "unlock-failure": "Unlock failed",
  locked: "Locked",
  "key-rotated": "Master key rotated",
  "password-changed": "Password changed",
  "settings-migrated": "Settings encrypted",
  "settings-decrypted": "Settings decrypted",
  "portable-exported": "Portable key exported",
  "portable-imported": "Portable key imported",
};

/** Tauri event names broadcast by the encryption subsystem. */
export const ENCRYPTION_EVENT_UNLOCKED = "encryption:unlocked";
export const ENCRYPTION_EVENT_LOCKED = "encryption:locked";

/** Human-readable label for each artifact kind. Order matches the
 *  Rust `ArtifactKind::all()` slice so the UI can map labels to
 *  Settings hand-side decisions. */
export const ARTIFACT_LABELS: Record<string, string> = {
  "sornG-v1::connections": "Connections database",
  "sornG-v1::settings": "Settings",
  "sornG-v1::recordings-meta": "Recording metadata",
  "sornG-v1::recordings-media": "Recording media files",
  "sornG-v1::backups": "Backups",
  "sornG-v1::logs": "Logs",
  "sornG-v1::macros": "Macros library",
};

/** Concise human description of a `MasterKeyStorage` value. */
export function describeStorage(mode: MasterKeyStorage | null): string {
  switch (mode) {
    case "vault":
      return "OS vault (transparent)";
    case "password":
      return "Password-wrapped (Argon2id)";
    case "vault-and-password":
      return "OS vault + password (hybrid)";
    case null:
    default:
      return "Not set up";
  }
}
