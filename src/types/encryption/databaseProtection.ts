import type { StorageData } from "../../utils/storage/storage";

export type DatabaseCipher = "aes-256-gcm" | "chacha20-poly1305";
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
