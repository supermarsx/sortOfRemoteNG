import { getInvoke } from "../tauri/invoke";
import type { StorageData } from "../storage/storage";
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

/** Native owns managed keys and envelopes. These adapters never implement a fallback cipher. */
export const databaseProtection = {
  async capabilities() {
    return (await nativeInvoke())<DatabaseProtectionCapabilities>(
      "database_protection_capabilities",
    );
  },
  async status(databaseId: string) {
    return (await nativeInvoke())<DatabaseProtectionStatus>(
      "database_protection_status",
      { databaseId },
    );
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
    return (await nativeInvoke())<DatabaseProtectionChangeResult>(
      "database_protection_change",
      { ...request },
    );
  },
};
