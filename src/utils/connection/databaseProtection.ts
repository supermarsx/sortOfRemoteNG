import { getInvoke } from "../tauri/invoke";
import type { StorageData } from "../storage/storage";
import { assertPublicDatabaseData } from "../storage/nativePrivateData";
import type {
  BrowserSessionsDescriptor,
  BrowserSessionsTransfer,
} from "../../types/security/browserSessions";
import {
  normalizeBrowserSessions,
  normalizeBrowserSessionsTransfer,
  invalidBrowserSessions,
  normalizeBrowserSessionDeletions,
  assertBrowserSessionTransferPassword,
} from "../security/browserSessions";
import { snapshotRecordPayload } from "../storage/recordLedger";
import { isDatabaseCipher } from "../../types/encryption/databaseProtection";
import type {
  DatabaseProtectionCapabilities,
  DatabaseProtectionStatus,
  DatabaseProtectionUnlockResult,
  DatabaseProtectionSaveResult,
  DatabaseProtectionChangeResult,
  DatabaseProtectionChangeRequest,
  DatabaseProtectionLockResult,
  DatabaseProtectionReleaseSessionResult,
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
  /** Native public projection only; never a cookie/key load or an unlock fallback. */
  async describeBrowserSessions(
    databaseId: string,
    sessionId: string,
    expectedSecurityRevision: string,
  ): Promise<BrowserSessionsDescriptor> {
    try {
      return normalizeBrowserSessions(
        await (
          await nativeInvoke()
        )<unknown>("database_browser_sessions_describe", {
          databaseId,
          sessionId,
          expectedSecurityRevision,
        }),
      );
    } catch {
      return invalidBrowserSessions();
    }
  },
  /** Explicit native export only; database unlock credentials are not transfer passwords. */
  async exportBrowserSessions(
    databaseId: string,
    sessionId: string,
    expectedSecurityRevision: string,
    selected: BrowserSessionsDescriptor,
    password: string,
    deletedConnectionIds?: string[],
  ) {
    const selection = normalizeBrowserSessions(selected);
    const deleted = normalizeBrowserSessionDeletions(
      deletedConnectionIds ?? [],
      selection,
    );
    assertBrowserSessionTransferPassword(password);
    try {
      const result = await (
        await nativeInvoke()
      )<unknown>("database_browser_sessions_export", {
        databaseId,
        sessionId,
        expectedSecurityRevision,
        selected: selection,
        password,
        ...(deletedConnectionIds === undefined
          ? {}
          : { deletedConnectionIds: deleted }),
      });
      return normalizeBrowserSessionsTransfer(result);
    } catch {
      // Native errors must not echo source paths, credentials, cookies or keys.
      return invalidBrowserSessions();
    }
  },
  /** One native CAS transaction authenticates the capsule and commits body + sessions. */
  async importBrowserSessions(request: {
    databaseId: string;
    sessionId: string;
    expectedSecurityRevision: string;
    expected: BrowserSessionsDescriptor;
    selected: BrowserSessionsDescriptor;
    deletedConnectionIds?: string[];
    data: StorageData;
    expectedData: unknown;
    transfer: BrowserSessionsTransfer;
    password: string;
  }): Promise<DatabaseProtectionSaveResult> {
    const selected = normalizeBrowserSessions(request.selected);
    const expected = normalizeBrowserSessions(request.expected);
    const deleted = normalizeBrowserSessionDeletions(
      request.deletedConnectionIds ?? [],
      selected,
    );
    const affected = new Set([
      ...selected.records.map((row) => row.connectionId),
      ...deleted,
    ]);
    if (expected.records.some((row) => !affected.has(row.connectionId)))
      return invalidBrowserSessions();
    assertBrowserSessionTransferPassword(request.password);
    if (!record(request.expectedData)) return invalidBrowserSessions();
    const args = {
      databaseId: request.databaseId,
      sessionId: request.sessionId,
      expectedSecurityRevision: request.expectedSecurityRevision,
      expected,
      selected,
      deletedConnectionIds: deleted,
      data: snapshotRecordPayload(request.data),
      expectedData: snapshotRecordPayload(request.expectedData),
      transfer: normalizeBrowserSessionsTransfer(request.transfer),
      password: request.password,
    };
    try {
      const result = await (
        await nativeInvoke()
      )<DatabaseProtectionSaveResult>("database_browser_sessions_import", args);
      if (
        !record(result) ||
        result.committed !== true ||
        typeof result.cleanupPending !== "boolean" ||
        result.securityRevision !== args.expectedSecurityRevision ||
        !Array.isArray(result.warnings) ||
        result.warnings.some((warning) => typeof warning !== "string")
      )
        throw new Error("Unconfirmed transfer");
      return {
        committed: true,
        cleanupPending: result.cleanupPending,
        securityRevision: result.securityRevision,
        // Do not expose arbitrary backend diagnostics on this secret-bearing path.
        warnings: result.warnings.length
          ? [
              "Browser session import committed; native cleanup needs attention.",
            ]
          : [],
      };
    } catch {
      // A lost response can follow a successful commit. Never claim nothing changed.
      throw Object.assign(
        new Error(
          "Browser session import could not be confirmed. Reload the destination before retrying; this is not a confirmed restore.",
        ),
        { kind: "partial" as const },
      );
    }
  },
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
      (result.globalEncryptionProtected !== undefined &&
        typeof result.globalEncryptionProtected !== "boolean") ||
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
    const result = await (
      await nativeInvoke()
    )<DatabaseProtectionUnlockResult>("database_protection_unlock", {
      databaseId,
      slotId,
      ...(password === undefined ? {} : { password }),
    });
    assertPublicDatabaseData(result?.data);
    return result;
  },
  async lock(databaseId: string) {
    return (await nativeInvoke())<DatabaseProtectionLockResult>(
      "database_protection_lock",
      {
        databaseId,
      },
    );
  },
  async releaseSession(databaseId: string, sessionId: string) {
    const result = await (
      await nativeInvoke()
    )<DatabaseProtectionReleaseSessionResult>(
      "database_protection_release_session",
      { databaseId, sessionId },
    );
    if (!record(result) || typeof result.released !== "boolean")
      throw new Error(
        "Native database session cleanup returned no verified result.",
      );
    return result;
  },
  async load(
    databaseId: string,
    sessionId: string,
    expectedSecurityRevision: string,
  ) {
    const result = await (
      await nativeInvoke()
    )<DatabaseProtectionUnlockResult>("database_protection_load", {
      databaseId,
      sessionId,
      expectedSecurityRevision,
    });
    assertPublicDatabaseData(result?.data);
    return result;
  },
  async save(
    databaseId: string,
    sessionId: string,
    expectedSecurityRevision: string,
    data: StorageData,
    expectedData: unknown,
  ) {
    assertPublicDatabaseData(data);
    assertPublicDatabaseData(expectedData);
    return (await nativeInvoke())<DatabaseProtectionSaveResult>(
      "database_protection_save",
      { databaseId, sessionId, expectedSecurityRevision, data, expectedData },
    );
  },
  async change(request: DatabaseProtectionChangeRequest) {
    assertPublicDatabaseData(request.legacyVerifiedData);
    assertPublicDatabaseData(request.expectedData);
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
