import { getInvoke } from "../tauri/invoke";
import type { StorageData } from "../storage/storage";
import { isDatabaseCipher } from "../../types/encryption/databaseProtection";
import type {
  DatabaseProtectionCapabilities,
  DatabaseProtectionStatus,
  DatabaseProtectionUnlockResult,
  DatabaseProtectionSaveResult,
  DatabaseProtectionChangeResult,
  DatabaseProtectionChangeRequest,
  DatabaseProtectionLockResult,
} from "../../types/encryption/databaseProtection";

async function nativeInvoke() {
  const invoke = await getInvoke();
  if (!invoke)
    throw new Error(
      "Managed database protection requires the desktop app; browser storage cannot use or downgrade this format.",
    );
  return invoke;
}

function record(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function validateCapabilities(
  value: unknown,
): asserts value is DatabaseProtectionCapabilities {
  const invalid = () =>
    new Error(
      "Unsupported or malformed native database protection capabilities; update the desktop app and retry.",
    );
  if (
    !record(value) ||
    value.schemaVersion !== 1 ||
    !Array.isArray(value.ciphers) ||
    !Array.isArray(value.protectors) ||
    !value.ciphers.length
  )
    throw invalid();
  const cipherIds = new Set<string>();
  for (const item of value.ciphers) {
    if (
      !record(item) ||
      !isDatabaseCipher(item.id) ||
      cipherIds.has(item.id) ||
      typeof item.available !== "boolean" ||
      (item.reason !== undefined && typeof item.reason !== "string")
    )
      throw invalid();
    cipherIds.add(item.id);
  }
  const protectorIds = new Set<string>();
  for (const item of value.protectors) {
    if (
      !record(item) ||
      typeof item.id !== "string" ||
      !["password", "os-vault", "webauthn-prf", "biometric"].includes(
        item.id,
      ) ||
      protectorIds.has(item.id) ||
      typeof item.available !== "boolean" ||
      typeof item.deviceBound !== "boolean" ||
      typeof item.requiresUserPresence !== "boolean" ||
      (item.reason !== undefined && typeof item.reason !== "string")
    )
      throw invalid();
    protectorIds.add(item.id);
  }
}

/** Native owns managed keys and envelopes. These adapters never implement a fallback cipher. */
export const databaseProtection = {
  async capabilities() {
    const result = await (
      await nativeInvoke()
    )<unknown>("database_protection_capabilities");
    validateCapabilities(result);
    return result;
  },
  async status(databaseId: string) {
    const result = await (
      await nativeInvoke()
    )<DatabaseProtectionStatus>("database_protection_status", { databaseId });
    if (
      !record(result) ||
      !["none", "legacy-password", "managed"].includes(result.kind) ||
      (result.kind === "managed" && !isDatabaseCipher(result.dataCipher)) ||
      (result.dataCipher !== undefined && !isDatabaseCipher(result.dataCipher))
    ) {
      throw new Error(
        "Unsupported or missing native database cipher; this database cannot be displayed as AES or downgraded. Update the desktop app and retry.",
      );
    }
    return result;
  },
  async unlock(databaseId: string, slotId: string, password?: string) {
    return (await nativeInvoke())<DatabaseProtectionUnlockResult>(
      "database_protection_unlock",
      { databaseId, slotId, ...(password === undefined ? {} : { password }) },
    );
  },
  async lock(databaseId: string) {
    return (await nativeInvoke())<DatabaseProtectionLockResult>(
      "database_protection_lock",
      {
        databaseId,
      },
    );
  },
  async load(
    databaseId: string,
    sessionId: string,
    expectedSecurityRevision: string,
  ) {
    return (await nativeInvoke())<DatabaseProtectionUnlockResult>(
      "database_protection_load",
      { databaseId, sessionId, expectedSecurityRevision },
    );
  },
  async save(
    databaseId: string,
    sessionId: string,
    expectedSecurityRevision: string,
    data: StorageData,
  ) {
    return (await nativeInvoke())<DatabaseProtectionSaveResult>(
      "database_protection_save",
      { databaseId, sessionId, expectedSecurityRevision, data },
    );
  },
  async change(request: DatabaseProtectionChangeRequest) {
    if (request.target && !isDatabaseCipher(request.target.dataCipher)) {
      throw new Error(
        "Unsupported database cipher; no protection change was submitted.",
      );
    }
    return (await nativeInvoke())<DatabaseProtectionChangeResult>(
      "database_protection_change",
      { ...request },
    );
  },
};
