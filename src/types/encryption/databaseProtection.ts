import type { StorageData } from "../../utils/storage/storage";

export const DATABASE_CIPHER_LABELS = {
  "aes-256-gcm": "AES-256-GCM (recommended)",
  "chacha20-poly1305": "ChaCha20-Poly1305 (portable software option)",
  "twofish-256-eax": "Twofish-256-EAX (advanced)",
  "serpent-256-eax": "Serpent-256-EAX (advanced)",
} as const;
export type DatabaseCipher = keyof typeof DATABASE_CIPHER_LABELS;
export function isDatabaseCipher(value: unknown): value is DatabaseCipher {
  return (
    typeof value === "string" &&
    Object.prototype.hasOwnProperty.call(DATABASE_CIPHER_LABELS, value)
  );
}
export type DatabaseProtector =
  "password" | "os-vault" | "webauthn-prf" | "biometric";
export interface DatabaseProtectionCapabilities {
  schemaVersion: 1;
  ciphers: Array<{ id: DatabaseCipher; available: boolean; reason?: string }>;
  protectors: Array<{
    id: DatabaseProtector;
    available: boolean;
    deviceBound: boolean;
    requiresUserPresence: boolean;
    reason?: string;
  }>;
}
export interface DatabaseProtectionSlot {
  id: string;
  type: DatabaseProtector;
  label: string;
  deviceBound: boolean;
}
export interface DatabaseProtectionStatus {
  kind: "none" | "legacy-password" | "managed";
  version?: 1;
  dataCipher?: DatabaseCipher;
  securityRevision: string;
  slots: DatabaseProtectionSlot[];
  unlocked: boolean;
  sessionExpiresAt?: number;
}
export type NewDatabaseProtectionSlot =
  | {
      type: "password";
      label: string;
      password: string;
      argon2?: { memoryKib: number; timeCost: number; parallelism: number };
    }
  | { type: "os-vault"; label: string };
export interface DatabaseProtectionTarget {
  dataCipher: DatabaseCipher;
  keepSlotIds: string[];
  newSlots: NewDatabaseProtectionSlot[];
}
export interface DatabaseProtectionUnlockResult {
  sessionId: string;
  sessionExpiresAt: number;
  securityRevision: string;
  data: StorageData;
}
export interface DatabaseProtectionSaveResult {
  committed: boolean;
  cleanupPending: boolean;
  warnings: string[];
  securityRevision: string;
}
export interface DatabaseProtectionLockResult {
  locked: true;
  notificationPending: boolean;
  warnings: string[];
}
export interface DatabaseProtectionChangeResult extends DatabaseProtectionSaveResult {
  sessionId?: string;
  sessionExpiresAt?: number;
}
export interface DatabaseProtectionChangeRequest {
  databaseId: string;
  expectedSecurityRevision: string;
  expectedData: object | string;
  sourceSessionId?: string;
  legacyVerifiedData?: StorageData;
  target: DatabaseProtectionTarget | null;
  confirmRemoveProtection?: boolean;
  confirmDeviceBoundOnly?: boolean;
  initializeEmptyDestination?: boolean;
}

/** Public access state contains no key material, session token or decrypted data. */
export interface DatabaseAccessState {
  databaseId: string;
  securityRevision: string;
  accessEpoch: string;
  status: "suspended" | "ready";
  reason:
    "expired" | "locked" | "security-changed" | "global-lock" | "unlocked";
  sessionExpiresAt?: number;
}
