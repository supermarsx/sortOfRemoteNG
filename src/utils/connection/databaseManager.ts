import {
  Connection,
  ConnectionDatabase,
} from "../../types/connection/connection";
import { StorageData } from "../storage/storage";
import { IndexedDbService } from "../storage/indexedDbService";
import { generateId } from "../core/id";
import {
  DatabaseNotFoundError,
  CorruptedDataError,
  InvalidPasswordError,
} from "../core/errors";
import { SettingsManager } from "../settings/settingsManager";
import { PBKDF2_ITERATIONS } from "../../config";
import {
  decryptWithPassword as decryptExportWithPassword,
  encryptWithPassword as encryptExportWithPassword,
  isWebCryptoPayload,
  type PasswordEncryptionOptions,
} from "../crypto/webCryptoAes";

import { getInvoke } from "../tauri/invoke";
import { databaseProtection } from "./databaseProtection";
import { normalizeHttpAutoMfa } from "./httpAutoMfa";
import { stripHttpOptionSecrets } from "./httpOptionSecrets";
import { validateNewPassword } from "../security/passwordPolicy";
import {
  assertNoVaultImport,
  assertPortableCredentialSources,
} from "../security/vaultPortability";
import { normalizeRecycleBin } from "./recycleBin";
import { rebindDatabaseQuickActions } from "./rebindDatabaseQuickActions";
import { stripHttpTrustedRedirectDestinations } from "../protocol/httpTrustedRedirectDestinations";
import { assertNoSynologyRedirectRuntimeContext } from "../protocol/synologyRedirectDefaults";
import {
  stripExportSecrets,
  containsExportSecrets,
} from "../../components/ImportExport/exportSecurity";
import { normalizeDatabaseAutomationLibrary } from "../recording/automationLibraryValidation";
import { normalizeDatabaseDocuments } from "../documents/validation";
import { normalizeDatabaseSettings } from "../documents/documentTypePolicy";
import { verifyDocumentAttachments } from "../documents/documentAttachments";
import {
  buildFullDatabaseArchive,
  encryptFullDatabaseArchive,
  fullDatabaseArchiveData,
  isFullDatabaseArchive,
  normalizeFullDatabaseArchive,
  FullDatabaseArchiveError,
  FullDatabaseRestoreIncompleteError,
  type FullDatabaseArchive,
} from "./fullDatabaseArchive";
import { containsLikelySecretText } from "../storage/appDataJsonStore";
import type {
  DatabaseAccessState,
  DatabaseProtectionUnlockResult,
  DatabaseProtectionTarget,
  DatabaseProtectionChangeResult,
} from "../../types/encryption/databaseProtection";
// Type-only: keeps the trust export document owned by `trustStore.ts` (single
// owner) without creating a runtime import edge. The dependency runs the other
// way — the trust store subscribes to `onCurrentDatabaseChange` below.
import type {
  TrustExportDocument,
  TrustImportMode,
  TrustImportOutcome,
  ReviewedTrustScopeTarget,
} from "../auth/trustStore";

/**
 * Envelope returned by the P1 file-storage commands
 * (`databases_list`, `load_database_data`). `source !== "current"`
 * means the value came from the `.bak` / `.v0.bak` recovery ladder —
 * the user's last save was reconstructed from an older generation.
 */
interface LoadResultEnvelope<T = unknown> {
  value: T;
  source: "current" | "backup" | "v0-migration";
}

export interface DatabaseSecurityOutcome {
  committed: boolean;
  cleanupPending: boolean;
  warnings: string[];
}
export interface LegacyTrustMigrationOutcome {
  databaseId: string;
  status: "migrated" | "already-verified";
  migratedRecords: number;
  preservedRecords: number;
  warnings: string[];
}

/**
 * Surface a recovery via the action log so the user sees that their
 * data was reconstructed from `.bak`. Console-only when the settings
 * manager isn't initialised yet (early boot).
 */
function logRecovery(artifact: string, source: string) {
  const detail = `recovered from ${source === "backup" ? "previous-save backup" : "pre-migration backup"}`;
  console.warn(`Database recovery: ${artifact} ${detail}`);
  try {
    SettingsManager.getInstance().logAction(
      "warn",
      "Database recovered from backup",
      undefined,
      `${artifact}: ${detail}`,
    );
  } catch {
    // SettingsManager may not be initialised yet during boot.
  }
}

// ---------- Web Crypto helpers (replaces CryptoJS) ----------

const getCrypto = (): Crypto => globalThis.crypto as Crypto;

const asBufferSource = (bytes: Uint8Array): BufferSource =>
  bytes as Uint8Array<ArrayBuffer>;

function toBase64(buffer: ArrayBuffer | Uint8Array): string {
  const bytes = buffer instanceof Uint8Array ? buffer : new Uint8Array(buffer);
  if (typeof Buffer !== "undefined") {
    return Buffer.from(bytes).toString("base64");
  }
  let binary = "";
  bytes.forEach((b) => (binary += String.fromCharCode(b)));
  return btoa(binary);
}

function fromBase64(str: string): Uint8Array {
  if (typeof Buffer !== "undefined") {
    return new Uint8Array(Buffer.from(str, "base64"));
  }
  const binary = atob(str);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
  return bytes;
}

async function deriveKey(
  password: string,
  salt: Uint8Array,
): Promise<CryptoKey> {
  const crypto = getCrypto();
  const enc = new TextEncoder();
  const keyMaterial = await crypto.subtle.importKey(
    "raw",
    enc.encode(password),
    "PBKDF2",
    false,
    ["deriveKey"],
  );
  return crypto.subtle.deriveKey(
    {
      name: "PBKDF2",
      salt: asBufferSource(salt),
      iterations: PBKDF2_ITERATIONS,
      hash: "SHA-256",
    },
    keyMaterial,
    { name: "AES-GCM", length: 256 },
    false,
    ["encrypt", "decrypt"],
  );
}

// Reader-only: `salt.iv.ciphertext` was the previous write format
// produced by this module before P3 unified all new writes onto the
// WebCrypto JSON envelope (`encryptExportWithPassword`). Existing
// IndexedDB rows in that format must still load cleanly until P5
// retires the IDB consumer surface.
async function decryptData(payload: string, password: string): Promise<string> {
  const parts = payload.split(".");
  if (parts.length !== 3) {
    throw new InvalidPasswordError("Invalid encrypted data format");
  }
  const [saltB64, ivB64, dataB64] = parts;
  const salt = fromBase64(saltB64);
  const iv = fromBase64(ivB64);
  const data = fromBase64(dataB64);
  const key = await deriveKey(password, salt);
  const crypto = getCrypto();
  try {
    const decrypted = await crypto.subtle.decrypt(
      { name: "AES-GCM", iv: asBufferSource(iv) },
      key,
      asBufferSource(data),
    );
    return new TextDecoder().decode(decrypted);
  } catch {
    throw new InvalidPasswordError();
  }
}

// Legacy decryption for backward compatibility with existing CryptoJS-format
// encrypted collections (AES-256-CBC + MD5 EVP_BytesToKey + "Salted__" header).
// Delegates to the Rust backend via Tauri invoke; no third-party JS crypto.
async function legacyDecrypt(
  ciphertext: string,
  password: string,
): Promise<string | null> {
  const invoke = await getInvoke();
  if (!invoke) return null;
  try {
    const plaintext = (await invoke("crypto_legacy_decrypt_cryptojs", {
      ciphertext,
      password,
    })) as string;
    return plaintext || null;
  } catch {
    return null;
  }
}

function cloneStorageData(data: StorageData): StorageData {
  if (typeof structuredClone === "function") {
    return structuredClone(data);
  }

  return JSON.parse(JSON.stringify(data)) as StorageData;
}

function buildDuplicateDatabaseName(
  sourceName: string,
  collections: ConnectionDatabase[],
  preferredName?: string,
): string {
  const desiredName = (preferredName?.trim() || `${sourceName} (Copy)`).trim();
  const existingNames = new Set(
    collections.map((collection) => collection.name.trim().toLocaleLowerCase()),
  );

  if (!existingNames.has(desiredName.toLocaleLowerCase())) {
    return desiredName;
  }

  let suffix = 2;
  let candidate = `${desiredName} ${suffix}`;
  while (existingNames.has(candidate.toLocaleLowerCase())) {
    suffix += 1;
    candidate = `${desiredName} ${suffix}`;
  }

  return candidate;
}

export interface ExportableDatabaseInfo extends ConnectionDatabase {
  isCurrent: boolean;
  isUnlocked: boolean;
  isExportable: boolean;
  lockedReason?: string;
}

/**
 * Why the current-database pointer moved. `create` is the odd one out: it
 * reports a database that was just added to the index but is *not* active,
 * so `database` still describes whatever was open (usually `null`).
 */
export type CurrentDatabaseChangeReason =
  | "create"
  | "open"
  | "switch"
  | "unlock"
  | "lock"
  | "close"
  | "delete"
  | "security-change";

/**
 * Payload handed to `onCurrentDatabaseChange` subscribers.
 *
 * `database` is always the database that is active *after* the change, so a
 * subscriber can treat `database === null` as "nothing is open". `databaseId`
 * is the database the event is *about* — for `create` / `unlock` / `lock` /
 * `delete` of a non-current database the two differ.
 */
export interface CurrentDatabaseChange {
  reason: CurrentDatabaseChangeReason;
  /** Active database after the change; `null` when none is open. */
  database: ConnectionDatabase | null;
  /**
   * The database this event is about, expressed in the same terms as
   * `database`: the id of the database that is active after the change when
   * the event concerns the active database, and `null` when the change is a
   * close / lock / delete of it. For an event about some *other* database
   * (`create`, or unlocking a database that is not current) this holds that
   * other database's id, which is how a subscriber tells the two apart.
   */
  databaseId: string | null;
  /** Active database id before the change. */
  previousDatabaseId: string | null;
  /** Connection ids of the active database; empty when none is open. */
  connectionIds: string[];
  /**
   * Resolves once the native Trust Center has been re-pointed at
   * `database` (or told that nothing is open). Already-resolved when the
   * event does not move the trust scope.
   *
   * Listeners fire synchronously so UI can react to the transition at once,
   * but anything that *reads* trust data must await this first: hydrating
   * ahead of the activation would read the outgoing database's store, or
   * fail closed against a runtime that has not been told about the new one.
   * Never rejects — activation is best-effort.
   */
  trustActivation: Promise<void>;
}

export type CurrentDatabaseChangeListener = (
  change: CurrentDatabaseChange,
) => void;

/**
 * Module-level, deliberately *not* per-instance: `DatabaseManager` is a
 * singleton that tests reset via `resetInstance()`, and a subscriber
 * registered at module-init time (the trust store does exactly that) must
 * survive that reset.
 */
const currentDatabaseListeners = new Set<CurrentDatabaseChangeListener>();
const databaseAccessListeners = new Set<(state: DatabaseAccessState) => void>();

export function onDatabaseAccessChange(
  listener: (state: DatabaseAccessState) => void,
): () => void {
  databaseAccessListeners.add(listener);
  return () => {
    databaseAccessListeners.delete(listener);
  };
}

/**
 * Subscribe to active-database transitions. Returns an unsubscribe function.
 *
 * A throwing listener is isolated: it never aborts the transition, and never
 * prevents the remaining listeners from running.
 */
export function onCurrentDatabaseChange(
  listener: CurrentDatabaseChangeListener,
): () => void {
  currentDatabaseListeners.add(listener);
  return () => {
    currentDatabaseListeners.delete(listener);
  };
}

/** Test-only: drop every subscriber registered on the module registry. */
export function resetCurrentDatabaseListenersForTests(): void {
  currentDatabaseListeners.clear();
}

function emitCurrentDatabaseChange(change: CurrentDatabaseChange): void {
  for (const listener of Array.from(currentDatabaseListeners)) {
    try {
      listener(change);
    } catch (error) {
      console.warn("A current-database listener threw", error);
    }
  }
}

/**
 * Immutable handle to the database that owned the currently-rendered
 * connection snapshot when the handle was captured.  The closures retain the
 * matching in-memory password so a delayed save can never drift onto whatever
 * database happens to be current later.
 */
export interface DatabaseDataTarget {
  readonly databaseId: string;
  /** Synchronous epoch/lease guard without reading data or exposing credentials. */
  assertAccessible?: () => void;
  /** Verify persisted contents without advancing this writer's CAS baseline. */
  verifyCurrent?: () => Promise<void>;
  /** Lease-checked read without advancing any writer's persisted CAS baseline. */
  readCurrent?: () => Promise<StorageData | null>;
  load: () => Promise<StorageData | null>;
  save: (data: StorageData) => Promise<void>;
}

/** Operation-scoped source lease; contains no data or passwords. */
export interface DatabaseOperationGuard {
  readonly databaseIds: readonly string[];
  /** Check after every await and immediately before writing the selected file. */
  assertCurrent(): void;
  /** Verify exportability and pin/check persisted security revisions before source reads and disclosure, without loading payloads or advancing CAS baselines. */
  verifyCurrent(): Promise<void>;
}

export interface DatabaseExportSnapshot {
  /** Present only on the explicit fullDatabase path; encrypt before disclosure. */
  format?: "sorng-full-database";
  version?: 1;
  timestamp?: number;
  documents?: StorageData["documents"];
  credentialVault?: StorageData["credentialVault"];
  collection: {
    id: string;
    name: string;
    description?: string;
    isEncrypted: boolean;
    exportDate: string;
  };
  connections: Connection[];
  settings: StorageData["settings"];
  tabGroups: StorageData["tabGroups"];
  colorTags: StorageData["colorTags"];
  recycleBin?: StorageData["recycleBin"];
  automationLibrary?: StorageData["automationLibrary"];
  databaseSettings?: StorageData["databaseSettings"];
  /**
   * Trust Center records belonging to the exported database (t62 / D6).
   *
   * Absent when the caller opted out (`includeTrust: false`) or when the
   * native Trust Center is unavailable — an export must never fail because
   * trust records could not be read. Records carry public key material only
   * (fingerprints, PEM), so `redactConnectionSecrets` does not apply.
   */
  trustRecords?: TrustExportDocument;
}

const SECRET_PLACEHOLDER = "***ENCRYPTED***";

function redactConnectionSecrets(connection: Connection): Connection {
  const next = { ...connection } as Connection;
  if (next.httpProxyPolicy !== undefined) {
    next.httpProxyPolicy = stripHttpOptionSecrets(
      "httpproxypolicy",
      next.httpProxyPolicy,
    ) as Connection["httpProxyPolicy"];
  }
  if (next.httpFormAutomation !== undefined) {
    next.httpFormAutomation = stripHttpOptionSecrets(
      "httpformautomation",
      next.httpFormAutomation,
    ) as Connection["httpFormAutomation"];
  }

  if (next.password) next.password = SECRET_PLACEHOLDER;
  if (next.basicAuthPassword) next.basicAuthPassword = SECRET_PLACEHOLDER;
  delete next.privateKey;
  delete next.passphrase;
  delete next.totpSecret;
  // This new field is metadata-only. Malformed imported extension properties
  // must not smuggle secrets into a credential-free database export.
  if (next.httpAutoMfa !== undefined) {
    try {
      next.httpAutoMfa = normalizeHttpAutoMfa(next.httpAutoMfa);
    } catch {
      delete next.httpAutoMfa;
    }
  }
  if (next.totpConfigs) {
    next.totpConfigs = next.totpConfigs.map((config) => {
      const metadata = { ...config };
      Reflect.deleteProperty(metadata, "secret");
      Reflect.deleteProperty(metadata, "backupCodes");
      return metadata;
    });
  }
  delete next.rustdeskPassword;

  if (next.cloudProvider) {
    next.cloudProvider = { ...next.cloudProvider };
    delete next.cloudProvider.apiKey;
    delete next.cloudProvider.accessToken;
    delete next.cloudProvider.clientSecret;
    delete next.cloudProvider.serviceAccountKey;
  }

  return next;
}

/**
 * Handles persistence and encryption of connection collections.
 *
 * Collections metadata lives in IndexedDB under a single key while individual
 * collection contents are stored separately. The manager caches the currently
 * selected collection to minimise lookups and supports optional AES encryption
 * for stored data.
 */
export class DatabaseManager {
  private static instance: DatabaseManager;
  private readonly databasesKey = "mremote-databases";
  private readonly legacyDatabasesKey = "mremote-collections";
  private currentDatabase: ConnectionDatabase | null = null;
  private currentPassword: string | null = null;
  private selectionGeneration = 0;
  private operationSelectionRevision = 0;
  private readonly unlockedDatabasePasswords = new Map<string, string>();
  // Only successful selections count as previously opened. Merely listing,
  // creating, or inspecting an on-disk database must not grant this scope.
  private readonly openedDatabaseIds = new Set<string>();
  // Bound to the credential that actually decrypted this generation, never to
  // metadata refreshed by a different window or an ordinary metadata edit.
  private readonly credentialSecurityRevisions = new Map<string, string>();
  private securityEpoch = 0;
  private readonly databaseSecurityEpochs = new Map<string, number>();
  private readonly managedSessions = new Map<
    string,
    Omit<DatabaseProtectionUnlockResult, "data">
  >();
  private readonly managedAccess = new Map<string, DatabaseAccessState>();
  private readonly managedTimers = new Map<
    string,
    ReturnType<typeof setTimeout>
  >();
  private managedListener: Promise<void> | null = null;
  private managedUnlisten: (() => void) | null = null;
  private disposed = false;

  private emitAccess(state: DatabaseAccessState): void {
    this.managedAccess.set(state.databaseId, state);
    for (const listener of databaseAccessListeners) {
      try {
        listener(state);
      } catch (error) {
        console.warn("Database access listener failed", error);
      }
    }
  }

  private suspendManagedDatabase(
    id: string,
    reason: DatabaseAccessState["reason"],
  ): void {
    const revision =
      this.managedSessions.get(id)?.securityRevision ??
      this.managedAccess.get(id)?.securityRevision ??
      this.currentDatabase?.securityRevision ??
      "";
    this.forgetUnlockedDatabase(id);
    this.emitAccess({
      databaseId: id,
      securityRevision: revision,
      accessEpoch: this.captureDatabaseEpoch(id),
      status: "suspended",
      reason,
    });
  }

  private async ensureManagedListener(): Promise<void> {
    this.managedListener ??= import("@tauri-apps/api/event")
      .then(async ({ listen }) => {
        const unlisten = await listen<{ databaseId: string }>(
          "database-protection:locked",
          ({ payload }) => {
            if (
              typeof payload?.databaseId === "string" &&
              (this.managedAccess.has(payload.databaseId) ||
                this.currentDatabase?.id === payload.databaseId)
            ) {
              this.suspendManagedDatabase(payload.databaseId, "locked");
            }
          },
        );
        if (this.disposed) unlisten();
        else this.managedUnlisten = unlisten;
      })
      .catch((error) => {
        this.managedListener = null;
        throw error;
      });
    await this.managedListener;
  }

  getDatabaseAccessState(id: string): DatabaseAccessState | null {
    const state = this.managedAccess.get(id);
    if (
      state?.status === "ready" &&
      (state.sessionExpiresAt ?? 0) <= Date.now()
    )
      return { ...state, status: "suspended", reason: "expired" };
    if (state) return state;
    return this.currentDatabase?.id === id &&
      this.currentDatabase.protectionFormat === "sorng-db"
      ? {
          databaseId: id,
          securityRevision: this.currentDatabase.securityRevision ?? "",
          accessEpoch: this.captureDatabaseEpoch(id),
          status: "suspended",
          reason: "locked",
        }
      : null;
  }

  async getDatabaseProtectionStatus(id: string) {
    return databaseProtection.status(id);
  }

  async getDatabaseProtectionCapabilities() {
    return databaseProtection.capabilities();
  }

  /** Existing unlock authority only; never opens/switches or prompts for a DB. */
  private async capturedTrustSource(database: ConnectionDatabase): Promise<{
    sourceSessionId?: string;
    expectedData?: unknown;
    connectionIds?: string[];
  }> {
    const id = database.id;
    if (database.protectionFormat === "sorng-db")
      return { sourceSessionId: this.requireManagedSession(id).sessionId };
    if (!database.isEncrypted) return {};
    const password = this.getUnlockedPasswordForDatabase(id);
    if (!password)
      throw new Error(
        "Unlock this database explicitly before changing its trust decisions.",
      );
    const data = await this.loadDatabaseData(
      id,
      password,
      database.securityRevision ?? "",
    );
    if (!data) throw new DatabaseNotFoundError();
    const expectedData = this.loadedRepresentations.get(data);
    if (expectedData === undefined)
      throw new Error(
        "Trust changes require the exact verified database snapshot.",
      );
    return { expectedData, connectionIds: this.connectionIdsOf(data) };
  }

  /** Move selected decisions only inside a currently unlocked database. */
  async reassignTrustScope(
    id: string,
    targets: ReviewedTrustScopeTarget[],
    targetConnectionId: string | null,
  ): Promise<{ updated: number }> {
    if (targets.length === 0 || targets.length > 10000)
      throw new Error("Select a bounded set of trust identities.");
    const reviewed = structuredClone(targets);
    const epoch = this.captureDatabaseEpoch(id);
    const database = await this.getDatabase(id);
    if (!database) throw new DatabaseNotFoundError();
    const invoke = await getInvoke();
    if (!invoke)
      throw new Error("Trust scope changes require the desktop app.");
    const source = await this.capturedTrustSource(database);
    this.assertDatabaseEpoch(id, epoch);
    const result = await invoke<{ updated: number }>(
      "trust_reassign_reviewed_scope",
      {
        databaseId: id,
        targets: reviewed,
        targetConnectionId,
        expectedSecurityRevision: database.securityRevision ?? "",
        ...source,
      },
    );
    if (
      !Number.isSafeInteger(result?.updated) ||
      result.updated < 0 ||
      result.updated > reviewed.length
    )
      throw new Error(
        "Native scope change returned an invalid outcome; refresh before retrying.",
      );
    return result;
  }

  /** Migrate a named database without changing the active database or trust scope. */
  async migrateLegacyTrustDatabase(
    id: string,
  ): Promise<LegacyTrustMigrationOutcome> {
    const epoch = this.captureDatabaseEpoch(id);
    const database = await this.getDatabase(id);
    if (!database) throw new DatabaseNotFoundError();
    const invoke = await getInvoke();
    if (!invoke)
      throw new Error("Legacy trust migration requires the desktop app.");
    const source = await this.capturedTrustSource(database);
    this.assertDatabaseEpoch(id, epoch);
    const result = await invoke<LegacyTrustMigrationOutcome>(
      "trust_migrate_legacy_database",
      {
        databaseId: id,
        expectedSecurityRevision: database.securityRevision ?? "",
        ...source,
      },
    );
    if (
      result?.databaseId !== id ||
      !["migrated", "already-verified"].includes(result.status) ||
      !Number.isSafeInteger(result.migratedRecords) ||
      result.migratedRecords < 0 ||
      !Number.isSafeInteger(result.preservedRecords) ||
      result.preservedRecords < 0 ||
      !Array.isArray(result.warnings) ||
      result.warnings.some((warning) => typeof warning !== "string")
    )
      throw new Error(
        "Migration returned an invalid result. Refresh native verification before deleting any legacy files.",
      );
    return this.captureDatabaseEpoch(id) === epoch
      ? result
      : {
          ...result,
          warnings: [
            ...result.warnings,
            "Migration completed, but database access changed. Refresh verification before cleanup.",
          ],
        };
  }

  /** Caller holds the database mutation queue and durably flushes current edits first. */
  async changeManagedDatabaseProtection(
    id: string,
    target: DatabaseProtectionTarget | null,
    options: {
      currentPassword?: string;
      confirmRemoveProtection?: boolean;
      confirmDeviceBoundOnly?: boolean;
      initializeWithData?: StorageData;
      expectedSecurityRevision?: string;
    } = {},
  ): Promise<DatabaseProtectionChangeResult> {
    const epoch = this.captureDatabaseEpoch(id);
    await this.ensureManagedListener();
    const collection = await this.getDatabase(id);
    if (!collection) throw new DatabaseNotFoundError();
    if (
      options.expectedSecurityRevision !== undefined &&
      (collection.securityRevision ?? "") !== options.expectedSecurityRevision
    )
      throw new Error(
        "Database protection changed since review. Refresh and confirm the new unlock methods before applying.",
      );
    const managed = collection.protectionFormat === "sorng-db";
    const data = await this.loadDatabaseData(id, options.currentPassword);
    if (!data) throw new DatabaseNotFoundError();
    const invoke = await getInvoke();
    if (!invoke)
      throw new Error("Managed protection requires the desktop app.");
    const raw = managed
      ? (
          await invoke<LoadResultEnvelope<object | string>>(
            "load_database_data",
            { databaseId: id },
          )
        ).value
      : this.loadedRepresentations.get(data);
    if (typeof raw !== "string" && (typeof raw !== "object" || raw === null))
      throw new Error("Database has no verified storage representation.");
    this.assertDatabaseEpoch(id, epoch);
    const result = await databaseProtection.change({
      databaseId: id,
      expectedSecurityRevision: collection.securityRevision ?? "",
      expectedData: raw,
      ...(managed
        ? { sourceSessionId: this.requireManagedSession(id).sessionId }
        : { legacyVerifiedData: options.initializeWithData ?? data }),
      target,
      confirmRemoveProtection: options.confirmRemoveProtection,
      confirmDeviceBoundOnly: options.confirmDeviceBoundOnly,
      ...(options.initializeWithData
        ? { initializeEmptyDestination: true }
        : {}),
    });
    if (!result.committed)
      throw new Error("Database protection change was not committed.");
    if (this.captureDatabaseEpoch(id) !== epoch || this.disposed)
      return {
        ...result,
        warnings: [
          ...result.warnings,
          "Protection changed, but database access was locked meanwhile. Unlock again before continuing.",
        ],
      };
    if (target) {
      if (!result.sessionId || !result.sessionExpiresAt) {
        this.suspendManagedDatabase(id, "security-changed");
        return {
          ...result,
          warnings: [
            ...result.warnings,
            "Protection changed; unlock again to obtain a new database session.",
          ],
        };
      }
      this.installManagedSession(id, {
        ...result,
        sessionId: result.sessionId,
        sessionExpiresAt: result.sessionExpiresAt,
        data: options.initializeWithData ?? data,
      });
    } else {
      this.forgetUnlockedDatabase(id);
      this.managedAccess.delete(id);
      this.credentialSecurityRevisions.set(id, result.securityRevision);
      this.latestLoadedRepresentations.set(id, structuredClone(data));
      if (this.currentDatabase?.id === id) {
        this.currentDatabase = {
          ...this.currentDatabase,
          isEncrypted: false,
          protectionFormat: undefined,
          securityRevision: result.securityRevision,
        };
        this.currentPassword = null;
        emitCurrentDatabaseChange({
          reason: "security-change",
          database: this.currentDatabase,
          databaseId: id,
          previousDatabaseId: id,
          connectionIds: this.connectionIdsOf(data),
          trustActivation: Promise.resolve(),
        });
      }
    }
    return result;
  }

  private requireManagedSession(id: string) {
    const session = this.managedSessions.get(id);
    if (!session || session.sessionExpiresAt <= Date.now()) {
      if (session) this.suspendManagedDatabase(id, "expired");
      throw new Error(
        "Database access is locked or expired. Unlock this database again; pending edits are retained.",
      );
    }
    return session;
  }

  private installManagedSession(
    id: string,
    result: DatabaseProtectionUnlockResult,
  ): void {
    if (
      !result.sessionId ||
      !Number.isFinite(result.sessionExpiresAt) ||
      result.sessionExpiresAt <= Date.now() ||
      typeof result.securityRevision !== "string" ||
      !Array.isArray(result.data?.connections)
    )
      throw new Error("Invalid native database session response.");
    this.forgetUnlockedDatabase(id);
    this.latestLoadedRepresentations.set(id, structuredClone(result.data));
    const { sessionId, sessionExpiresAt, securityRevision } = result;
    this.managedSessions.set(id, {
      sessionId,
      sessionExpiresAt,
      securityRevision,
    });
    this.credentialSecurityRevisions.set(id, securityRevision);
    this.managedTimers.set(
      id,
      setTimeout(
        () => this.suspendManagedDatabase(id, "expired"),
        Math.min(sessionExpiresAt - Date.now(), 2147483647),
      ),
    );
    if (this.currentDatabase?.id === id) {
      this.currentPassword = null;
      this.currentDatabase = {
        ...this.currentDatabase,
        isEncrypted: true,
        protectionFormat: "sorng-db",
        securityRevision,
      };
      emitCurrentDatabaseChange({
        reason: "security-change",
        database: this.currentDatabase,
        databaseId: id,
        previousDatabaseId: id,
        connectionIds: this.connectionIdsOf(result.data),
        trustActivation: Promise.resolve(),
      });
    }
    this.emitAccess({
      databaseId: id,
      securityRevision,
      accessEpoch: this.captureDatabaseEpoch(id),
      status: "ready",
      reason: "unlocked",
      sessionExpiresAt,
    });
  }

  async unlockManagedDatabase(
    id: string,
    slotId: string,
    password?: string,
    options: { isCurrent?: () => boolean } = {},
  ): Promise<void> {
    const epoch = this.captureDatabaseEpoch(id);
    await this.ensureManagedListener();
    this.assertDatabaseEpoch(id, epoch);
    if (options.isCurrent?.() === false)
      throw new Error("The database unlock request is no longer active.");
    const result = await databaseProtection.unlock(id, slotId, password);
    try {
      this.assertDatabaseEpoch(id, epoch);
      if (this.disposed) throw new Error("Database manager was disposed.");
      if (options.isCurrent?.() === false)
        throw new Error("The database unlock request is no longer active.");
      this.installManagedSession(id, result);
    } catch (error) {
      // Do not publish the plaintext payload or a ready event for a stale form.
      // Token-scoped cleanup must not lock a newer grant or another window.
      if (typeof result.sessionId === "string" && result.sessionId) {
        try {
          await databaseProtection.releaseSession(id, result.sessionId);
        } catch {
          throw new Error(
            "The abandoned database unlock was not installed, but native session cleanup could not be confirmed. Lock the database before retrying.",
          );
        }
      }
      throw error;
    }
  }

  private async lockManagedDatabase(id: string): Promise<void> {
    const outcome = await databaseProtection.lock(id);
    if (outcome?.locked !== true)
      throw new Error("Native database lock returned no verified completion.");
    this.suspendManagedDatabase(id, "locked");
    if (outcome.notificationPending || outcome.warnings.length) {
      // Mask first. Logging problems must never turn a committed lock into an unlock.
      try {
        SettingsManager.getInstance().logAction(
          "warn",
          "Database locked; other-window notification needs attention",
          undefined,
          outcome.warnings.join(" "),
        );
      } catch {
        /* Native key revocation is already authoritative. */
      }
    }
  }
  private readonly loadedRepresentations = new WeakMap<StorageData, unknown>();
  private readonly latestLoadedRepresentations = new Map<string, unknown>();
  private readonly loadedSecurityRevisions = new WeakMap<StorageData, string>();
  private readonly indexSnapshots = new WeakMap<
    ConnectionDatabase[],
    ConnectionDatabase[]
  >();

  private rememberIndexSnapshot(
    original: ConnectionDatabase[],
    normalized: ConnectionDatabase[],
  ): ConnectionDatabase[] {
    this.indexSnapshots.set(normalized, structuredClone(original));
    return normalized;
  }
  private beforeDatabaseTransition: (() => Promise<void>) | null = null;
  private databaseTransitionQueue: Promise<void> = Promise.resolve();

  static getInstance(): DatabaseManager {
    if (!DatabaseManager.instance) {
      DatabaseManager.instance = new DatabaseManager();
    }
    return DatabaseManager.instance;
  }

  static resetInstance(): void {
    const previous = DatabaseManager.instance;
    if (previous) {
      previous.disposed = true;
      previous.managedUnlisten?.();
      for (const timer of previous.managedTimers.values()) clearTimeout(timer);
      previous.managedSessions.clear();
    }
    (DatabaseManager as any).instance = undefined;
  }

  /** Call after the durable flush, synchronously before global lock's async cleanup. */
  invalidatePendingDatabaseOperations(): void {
    this.selectionGeneration += 1;
    this.securityEpoch += 1;
    this.unlockedDatabasePasswords.clear();
    this.openedDatabaseIds.clear();
    this.credentialSecurityRevisions.clear();
    this.latestLoadedRepresentations.clear();
    this.currentPassword = null;
    for (const id of this.managedAccess.keys())
      this.suspendManagedDatabase(id, "global-lock");
  }

  private captureDatabaseEpoch(id: string): string {
    return `${this.securityEpoch}:${this.databaseSecurityEpochs.get(id) ?? 0}`;
  }

  private assertDatabaseEpoch(id: string, epoch: string): void {
    if (this.captureDatabaseEpoch(id) !== epoch) {
      throw new Error(
        "Database access expired because it was locked or its security changed. Retry after unlocking.",
      );
    }
  }

  private assertSecurityRevision(
    id: string,
    expected: string,
    latest: ConnectionDatabase | null | undefined,
  ): void {
    if (latest && (latest.securityRevision ?? "") === expected) return;
    if (this.credentialSecurityRevisions.get(id) === expected) {
      if (this.managedAccess.has(id))
        this.suspendManagedDatabase(id, "security-changed");
      else this.forgetUnlockedDatabase(id);
      if (this.currentDatabase?.id === id) this.currentPassword = null;
    }
    throw new Error(
      "Database security changed; stale credentials or snapshots were rejected. Unlock again before retrying.",
    );
  }

  private async assertSnapshotCurrent(
    id: string,
    data: StorageData,
  ): Promise<void> {
    const revision = this.loadedSecurityRevisions.get(data);
    if (revision === undefined)
      throw new Error("Database snapshot has no verified security revision.");
    this.assertSecurityRevision(id, revision, await this.getDatabase(id));
  }

  private async assertSecurityRevisionAfterRead(
    id: string,
    revision: string,
    epoch: string,
  ): Promise<void> {
    this.assertSecurityRevision(id, revision, await this.getDatabase(id));
    this.assertDatabaseEpoch(id, epoch);
  }

  /**
   * Subscribe to active-database transitions. Instance-level alias for the
   * module-level {@link onCurrentDatabaseChange} so consumers holding only the
   * singleton do not need a second import.
   */
  onCurrentDatabaseChange(listener: CurrentDatabaseChangeListener): () => void {
    return onCurrentDatabaseChange(listener);
  }
  onDatabaseAccessChange(
    listener: (state: DatabaseAccessState) => void,
  ): () => void {
    return onDatabaseAccessChange(listener);
  }

  /**
   * Announce a transition and, when the *active* database changed, tell the
   * native Trust Center which database's records it should be reading and
   * writing (t62 / D3).
   *
   * Deliberately best-effort: the Trust Center failing to switch must never
   * stop a database from opening. Rust fails closed on its side — a verifier
   * with no active database errors out rather than silently accepting — so a
   * dropped activation degrades to "trust prompts reappear", never to
   * "everything is trusted".
   */
  private announceDatabaseChange(
    change: Omit<CurrentDatabaseChange, "trustActivation">,
  ): void {
    // Only events about the *active* database move the trust scope. Creating,
    // unlocking, locking or deleting some other database leaves the Trust
    // Center pointed exactly where it was.
    const activeId = change.database?.id ?? null;
    const trustActivation =
      change.databaseId === activeId
        ? this.syncActiveTrustDatabase(activeId, change.connectionIds)
        : Promise.resolve();
    emitCurrentDatabaseChange({ ...change, trustActivation });
  }

  private async syncActiveTrustDatabase(
    databaseId: string | null,
    connectionIds: string[],
  ): Promise<void> {
    try {
      const invoke = await getInvoke();
      if (!invoke) return;
      await invoke("trust_set_active_database", {
        databaseId,
        connectionIds: databaseId ? connectionIds : [],
      });
    } catch (error) {
      console.warn(
        "Trust Center: could not switch the active trust database",
        error,
      );
    }
  }

  /**
   * Read a database's trust records. Returns `null` when the caller opted
   * out, when there is no Tauri runtime, or when the native command fails —
   * an export must not break because the Trust Center is unavailable.
   */
  private async readTrustRecords(
    databaseId: string,
    includeTrust: boolean,
  ): Promise<TrustExportDocument | null> {
    if (!includeTrust) return null;
    try {
      const invoke = await getInvoke();
      if (!invoke) return null;
      const document = await invoke<TrustExportDocument>(
        "trust_export_database",
        { databaseId },
      );
      return document ?? null;
    } catch (error) {
      console.warn(
        "Trust Center: could not export trust records for the database",
        error,
      );
      return null;
    }
  }

  /**
   * Apply a trust export document to a database. Best-effort for the same
   * reason as {@link readTrustRecords}: a partial import is better than a
   * failed one, and the outcome is reported so callers can surface it.
   */
  private async applyTrustRecords(
    databaseId: string,
    document: TrustExportDocument | undefined | null,
    includeTrust: boolean,
    mode: TrustImportMode = "merge",
  ): Promise<TrustImportOutcome | null> {
    if (!includeTrust || !document) return null;
    if (!Array.isArray(document.records)) return null;
    try {
      const invoke = await getInvoke();
      if (!invoke) return null;
      return await invoke<TrustImportOutcome>("trust_import_database", {
        databaseId,
        document,
        mode,
      });
    } catch (error) {
      console.warn(
        "Trust Center: could not import trust records into the database",
        error,
      );
      return null;
    }
  }

  private connectionIdsOf(data: StorageData | null | undefined): string[] {
    return (data?.connections ?? [])
      .map((connection) => connection?.id)
      .filter((id): id is string => typeof id === "string" && id.length > 0);
  }

  /**
   * Create and persist a new empty collection.
   *
   * A unique ID is generated and the collection metadata is appended to the
   * list stored in IndexedDB. If `isEncrypted` is true, initial data is saved
   * using AES with the provided password. The method returns the created
   * collection descriptor.
   */
  async createDatabase(
    name: string,
    description?: string,
    isEncrypted: boolean = false,
    password?: string,
  ): Promise<ConnectionDatabase> {
    if (isEncrypted && password)
      await validateNewPassword(password, "database");
    if (isEncrypted && !password) {
      throw new InvalidPasswordError(
        "A password is required before creating an encrypted database.",
      );
    }
    const collection: ConnectionDatabase = {
      id: generateId(),
      name,
      description,
      isEncrypted,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
      lastAccessed: new Date().toISOString(),
    };

    const collections = await this.getAllDatabases();
    const expectedIndex =
      this.indexSnapshots.get(collections) ?? structuredClone(collections);
    collections.push(collection);
    await this.saveDatabases(collections, expectedIndex);

    // Assumes collection count is modest; appending and rewriting the entire
    // array could be expensive if thousands of collections were stored.
    // Initialize empty data for the collection
    if (isEncrypted && password) {
      await this.saveDatabaseData(
        collection.id,
        { connections: [], settings: {}, timestamp: Date.now() },
        password,
        collection.securityRevision ?? "",
        { expectedData: null },
      );
      this.rememberUnlockedDatabase(collection, password);
    } else {
      await this.saveDatabaseData(
        collection.id,
        {
          connections: [],
          settings: {},
          timestamp: Date.now(),
        },
        undefined,
        collection.securityRevision ?? "",
        { expectedData: null },
      );
    }

    // Log collection creation
    SettingsManager.getInstance().logAction(
      "info",
      "Database created",
      undefined,
      `Database "${name}" created${isEncrypted ? " (encrypted)" : ""}`,
    );

    // A freshly created database is not yet the active one, so this is a
    // notification only — no trust activation (see `announceDatabaseChange`).
    this.announceDatabaseChange({
      reason: "create",
      database: this.currentDatabase,
      databaseId: collection.id,
      previousDatabaseId: this.currentDatabase?.id ?? null,
      connectionIds: [],
    });

    return collection;
  }

  async getAllDatabases(): Promise<ConnectionDatabase[]> {
    const selected = this.currentDatabase;
    const generation = this.selectionGeneration;
    const reconcile = (rows: ConnectionDatabase[]): ConnectionDatabase[] => {
      // A successful index reload can discover a deletion in another window.
      // Only invalidate the selection this read actually observed.
      if (
        selected &&
        this.currentDatabase === selected &&
        this.selectionGeneration === generation &&
        !rows.some((row) => row.id === selected.id)
      ) {
        this.selectionGeneration += 1;
        this.currentDatabase = null;
        this.currentPassword = null;
        this.forgetUnlockedDatabase(selected.id);
        this.announceDatabaseChange({
          reason: "delete",
          database: null,
          databaseId: null,
          previousDatabaseId: selected.id,
          connectionIds: [],
        });
      }
      return rows;
    };
    try {
      const invoke = await getInvoke();
      if (invoke) {
        // Primary path (Tauri runtime): the P1 file-storage backend.
        const envelope = await invoke<LoadResultEnvelope<
          ConnectionDatabase[]
        > | null>("databases_list");
        if (envelope == null) return reconcile([]);
        if (envelope.source !== "current") {
          logRecovery("databases index", envelope.source);
        }
        if (!Array.isArray(envelope.value))
          throw new CorruptedDataError(
            "Database index is malformed; no changes were made.",
          );
        const list = envelope.value;
        return reconcile(
          this.rememberIndexSnapshot(
            list,
            list.map((c: any) => ({
              ...c,
              createdAt:
                typeof c.createdAt === "string"
                  ? c.createdAt
                  : new Date(c.createdAt).toISOString(),
              updatedAt:
                typeof c.updatedAt === "string"
                  ? c.updatedAt
                  : new Date(c.updatedAt).toISOString(),
              lastAccessed:
                typeof c.lastAccessed === "string"
                  ? c.lastAccessed
                  : new Date(c.lastAccessed).toISOString(),
            })),
          ),
        );
      }

      // ── Browser / pre-Tauri fallback (P5 will retire this branch). ──
      // No file storage available; fall back to the IndexedDB rows
      // existing tests rely on. Production never reaches this code.
      const collections = await IndexedDbService.transactItemsStrict<
        ConnectionDatabase[] | null
      >([this.databasesKey, this.legacyDatabasesKey], (values) => {
        const current = values[this.databasesKey];
        const legacy = values[this.legacyDatabasesKey];
        const selected = current ?? legacy;
        if (selected !== null && !Array.isArray(selected))
          throw new CorruptedDataError(
            "Database index is malformed; no changes were made.",
          );
        return {
          set:
            current === null && legacy !== null
              ? { [this.databasesKey]: legacy }
              : {},
          remove:
            current === null && legacy !== null
              ? [this.legacyDatabasesKey]
              : [],
          result: selected as ConnectionDatabase[] | null,
        };
      });
      if (collections) {
        if (!Array.isArray(collections))
          throw new CorruptedDataError(
            "Database index is malformed; no changes were made.",
          );
        return reconcile(
          this.rememberIndexSnapshot(
            collections,
            collections.map((c: any) => ({
              ...c,
              createdAt:
                typeof c.createdAt === "string"
                  ? c.createdAt
                  : new Date(c.createdAt).toISOString(),
              updatedAt:
                typeof c.updatedAt === "string"
                  ? c.updatedAt
                  : new Date(c.updatedAt).toISOString(),
              lastAccessed:
                typeof c.lastAccessed === "string"
                  ? c.lastAccessed
                  : new Date(c.lastAccessed).toISOString(),
            })),
          ),
        );
      }
      return reconcile([]);
    } catch (error) {
      console.error("Failed to load databases:", error);
      throw error;
    }
  }

  async getDatabase(id: string): Promise<ConnectionDatabase | null> {
    const collections = await this.getAllDatabases();
    return collections.find((c) => c.id === id) || null;
  }

  /**
   * Register the main connection provider's durable-flush barrier. Database
   * selection is a manager-wide operation, so placing the barrier here also
   * protects callers outside the collection picker (import/restore flows).
   */
  registerBeforeDatabaseTransition(guard: () => Promise<void>): () => void {
    this.beforeDatabaseTransition = guard;
    return () => {
      if (this.beforeDatabaseTransition === guard) {
        this.beforeDatabaseTransition = null;
      }
    };
  }

  async selectDatabase(id: string, password?: string): Promise<void> {
    const generation = this.selectionGeneration;
    const transition = this.databaseTransitionQueue
      .catch(() => undefined)
      .then(() => this.selectDatabaseInner(id, password, generation));
    this.databaseTransitionQueue = transition.then(
      () => undefined,
      () => undefined,
    );
    return transition;
  }

  private async selectDatabaseInner(
    id: string,
    password?: string,
    generation = this.selectionGeneration,
  ): Promise<void> {
    const assertSelectionCurrent = () => {
      if (generation !== this.selectionGeneration)
        throw new Error(
          "Database opening was cancelled because the selection was closed.",
        );
    };
    assertSelectionCurrent();
    const epoch = this.captureDatabaseEpoch(id);
    const previousDatabaseId = this.currentDatabase?.id ?? null;
    const switchingDatabase =
      this.currentDatabase !== null && this.currentDatabase.id !== id;
    if (switchingDatabase) {
      await this.beforeDatabaseTransition?.();
    }

    const collection = await this.getDatabase(id);
    if (!collection) {
      throw new DatabaseNotFoundError();
    }

    const resolvedPassword =
      collection.isEncrypted && collection.protectionFormat !== "sorng-db"
        ? password || this.getUnlockedPasswordForDatabase(collection.id)
        : undefined;

    if (
      collection.isEncrypted &&
      collection.protectionFormat !== "sorng-db" &&
      !resolvedPassword
    ) {
      throw new InvalidPasswordError(
        "Password required for encrypted collection",
      );
    }

    const loaded = await this.loadDatabaseData(id, resolvedPassword);
    // A database load can be slow. Flush edits made to the outgoing UI while
    // it was in flight before advancing the mutable current-database pointer.
    if (switchingDatabase) {
      await this.beforeDatabaseTransition?.();
    }
    this.assertDatabaseEpoch(id, epoch);
    if (loaded) await this.assertSnapshotCurrent(id, loaded);
    // Update last accessed time
    collection.lastAccessed = new Date().toISOString();
    await this.updateDatabase(collection);
    this.assertDatabaseEpoch(id, epoch);
    if (loaded) await this.assertSnapshotCurrent(id, loaded);
    this.assertDatabaseEpoch(id, epoch);
    assertSelectionCurrent();
    // Publish selection only after every asynchronous validation succeeds.
    this.operationSelectionRevision += 1;
    this.currentDatabase = collection;
    this.currentPassword = resolvedPassword || null;
    this.openedDatabaseIds.add(id);

    // Log collection selection/opening
    SettingsManager.getInstance().logAction(
      "info",
      "Database opened",
      undefined,
      `Switched to database "${collection.name}"`,
    );

    // The database is now fully current: point the native Trust Center at
    // `databases/<id>.trust.json` and hand it the connection ids so a legacy
    // seed can scope per-connection records (t62 / D5).
    this.announceDatabaseChange({
      reason: switchingDatabase ? "switch" : "open",
      database: collection,
      databaseId: collection.id,
      previousDatabaseId,
      connectionIds: this.connectionIdsOf(loaded),
    });
  }

  getCurrentDatabase(): ConnectionDatabase | null {
    return this.currentDatabase;
  }

  captureCurrentDatabaseDataTarget(): DatabaseDataTarget | null {
    const current = this.currentDatabase;
    if (!current) return null;
    const databaseId = current.id;
    const epoch = this.captureDatabaseEpoch(databaseId);
    const passwordAtCapture = this.currentPassword || undefined;
    const revisionAtCapture = this.credentialSecurityRevisions.get(databaseId);
    let expectedData = this.latestLoadedRepresentations.get(databaseId);
    const resolvePassword = () => {
      this.assertDatabaseEpoch(databaseId, epoch);
      if (revisionAtCapture === undefined)
        throw new Error(
          "Database access expired. Unlock again before retrying.",
        );
      return passwordAtCapture;
    };
    return {
      databaseId,
      assertAccessible: () => {
        resolvePassword();
        const access = this.getDatabaseAccessState(databaseId);
        if (access && access.status !== "ready")
          throw new Error(
            "Database access is suspended. Unlock before changing its Recycle Bin.",
          );
      },
      load: () =>
        this.loadDatabaseData(
          databaseId,
          resolvePassword(),
          revisionAtCapture,
        ).then((data) => {
          if (data) expectedData = this.loadedRepresentations.get(data);
          return data;
        }),
      verifyCurrent: async () => {
        const baseline = expectedData;
        if (baseline === undefined)
          throw new Error(
            "Database content baseline is unavailable. Reload before running a database action.",
          );
        const data = await this.loadDatabaseData(
          databaseId,
          resolvePassword(),
          revisionAtCapture,
          { preserveBaseline: true },
        );
        resolvePassword();
        if (
          !data ||
          JSON.stringify(this.loadedRepresentations.get(data)) !==
            JSON.stringify(baseline)
        )
          throw new Error(
            "Database contents changed in another window. Reload and review the library before running an action.",
          );
      },
      readCurrent: async () => {
        const currentAccess = this.getDatabaseAccessState(databaseId);
        if (currentAccess && currentAccess.status !== "ready")
          throw new Error("Database access is suspended.");
        const data = await this.loadDatabaseData(
          databaseId,
          resolvePassword(),
          revisionAtCapture,
          { preserveBaseline: true },
        );
        resolvePassword();
        const access = this.getDatabaseAccessState(databaseId);
        if (access && access.status !== "ready")
          throw new Error("Database access is suspended.");
        return data;
      },
      save: (data) => {
        const password = resolvePassword();
        if (expectedData === undefined)
          throw new Error(
            "Database content baseline is unavailable. Reload before saving.",
          );
        return this.saveDatabaseData(
          databaseId,
          data,
          password,
          revisionAtCapture,
          { expectedData },
        ).then(() => {
          expectedData = this.loadedRepresentations.get(data);
        });
      },
    };
  }

  /**
   * Validate the password for an encrypted database and remember it
   * for this session, *without* switching the active database.
   *
   * The Import / Export / Clone pickers use this for inline-unlock:
   * they want to flip a row from locked to selectable so it can be
   * picked as a source or target, but they emphatically do not want
   * to change which database is currently open.
   *
   * Non-encrypted databases short-circuit: there is nothing to
   * unlock, so the method resolves silently. A wrong password
   * surfaces the same `InvalidPasswordError` the select path throws,
   * so callers can reuse their existing prompt-retry logic.
   *
   * The remembered password lives in `unlockedDatabasePasswords` —
   * in-memory only, forgotten on app restart. This matches the
   * existing security model; persistent unlock is a separate
   * feature linked to the OS keychain.
   */
  async unlockDatabase(id: string, password: string): Promise<void> {
    const epoch = this.captureDatabaseEpoch(id);
    const collection = await this.getDatabase(id);
    if (!collection) {
      throw new DatabaseNotFoundError();
    }
    if (collection.protectionFormat === "sorng-db") {
      const status = await this.getDatabaseProtectionStatus(id);
      const slots = status.slots.filter((slot) => slot.type === "password");
      if (slots.length !== 1)
        throw new Error("Choose an unlock method for this managed database.");
      await this.unlockManagedDatabase(id, slots[0].id, password);
      return;
    }
    if (!collection.isEncrypted) {
      // Nothing to unlock. Treat as success so callers don't have
      // to special-case non-encrypted databases.
      return;
    }
    // `loadDatabaseData` is the cheapest path that exercises the
    // password — it throws `InvalidPasswordError` on a bad password
    // (same one `selectDatabase` would have surfaced) without any
    // side effects on `currentDatabase` / `currentPassword`.
    const loaded = await this.loadDatabaseData(id, password);
    this.assertDatabaseEpoch(id, epoch);
    if (loaded) await this.assertSnapshotCurrent(id, loaded);

    // Unlocking does not change which database is active, so the active
    // database in the payload is still `currentDatabase`. Re-activating the
    // trust store matters only when the database that just became readable is
    // the current one — its master-DEK sub-key may only now be derivable.
    this.announceDatabaseChange({
      reason: "unlock",
      database: this.currentDatabase,
      databaseId: id,
      previousDatabaseId: this.currentDatabase?.id ?? null,
      connectionIds:
        this.currentDatabase?.id === id ? this.connectionIdsOf(loaded) : [],
    });
  }

  /**
   * Inverse of `selectDatabase`: deselects the currently open database
   * and forgets its cached password so a subsequent open will prompt
   * again. No-op when nothing is open.
   *
   * Returns the id of the database that was closed, or `null` if there
   * was nothing to close — callers use that to decide whether to clear
   * downstream UI state (connections panel, auto-open-last setting).
   */
  closeCurrentDatabase(
    reason: "close" | "lock" = "close",
  ): string | null | Promise<string | null> {
    // Also cancel queued/in-flight opens when there is not yet a selection.
    this.selectionGeneration += 1;
    const closing = this.currentDatabase;
    if (!closing) return null;
    if (
      closing.protectionFormat === "sorng-db" &&
      this.managedSessions.has(closing.id)
    ) {
      return this.lockManagedDatabase(closing.id).then(() => {
        return this.currentDatabase === closing
          ? this.closeCurrentDatabase(reason)
          : null;
      });
    }
    this.currentDatabase = null;
    this.currentPassword = null;
    // "Close" means "lock too" — the unlock cache exists so the user
    // doesn't get re-prompted while flipping between databases; an
    // explicit close is the user saying they want it locked.
    this.forgetUnlockedDatabase(closing.id);
    SettingsManager.getInstance().logAction(
      "info",
      "Database closed",
      undefined,
      `Closed database "${closing.name}"`,
    );

    // Nothing is open any more: the Trust Center must forget the active
    // database so its verifiers fail closed instead of answering from a
    // store the user just locked (t62 / D3).
    this.announceDatabaseChange({
      reason,
      database: null,
      databaseId: null,
      previousDatabaseId: closing.id,
      connectionIds: [],
    });
    return closing.id;
  }

  /**
   * Inverse of `unlockDatabase`: forgets the cached password for an
   * encrypted database so the next open / export / clone re-prompts.
   * If the locked database happens to be the current one, also closes
   * it (you can't keep a database active while it has no password).
   *
   * Non-encrypted databases short-circuit — there is nothing to lock.
   */
  async lockDatabase(id: string): Promise<void> {
    if (this.currentDatabase?.id === id) {
      await this.closeCurrentDatabase("lock");
      return;
    }
    if (this.managedAccess.has(id)) {
      await this.lockManagedDatabase(id);
      return;
    }
    if (!this.unlockedDatabasePasswords.has(id)) {
      this.forgetUnlockedDatabase(id);
      // A different window may hold a managed lease even when this window has none.
      const collection = await this.getDatabase(id);
      if (collection?.protectionFormat === "sorng-db")
        await this.lockManagedDatabase(id);
      return;
    }
    this.forgetUnlockedDatabase(id);
    SettingsManager.getInstance().logAction(
      "info",
      "Database locked",
      undefined,
      `Locked database ${id}`,
    );
    // A non-current database was locked: the active trust scope is unchanged,
    // so this is a notification only.
    this.announceDatabaseChange({
      reason: "lock",
      database: this.currentDatabase,
      databaseId: id,
      previousDatabaseId: this.currentDatabase?.id ?? null,
      connectionIds: [],
    });
  }

  isDatabaseUnlocked(databaseId: string): boolean {
    if (
      this.managedAccess.has(databaseId) ||
      (this.currentDatabase?.id === databaseId &&
        this.currentDatabase.protectionFormat === "sorng-db")
    ) {
      const session = this.managedSessions.get(databaseId);
      return Boolean(session && session.sessionExpiresAt > Date.now());
    }
    if (this.unlockedDatabasePasswords.has(databaseId)) {
      return true;
    }

    if (this.currentDatabase?.id !== databaseId) {
      return false;
    }

    return !this.currentDatabase.isEncrypted || Boolean(this.currentPassword);
  }

  getUnlockedDatabaseIds(): string[] {
    const unlockedIds = new Set(this.unlockedDatabasePasswords.keys());
    for (const id of this.managedSessions.keys())
      if (this.isDatabaseUnlocked(id)) unlockedIds.add(id);
    if (
      this.currentDatabase &&
      this.isDatabaseUnlocked(this.currentDatabase.id)
    ) {
      unlockedIds.add(this.currentDatabase.id);
    }
    return Array.from(unlockedIds);
  }

  async getExportableDatabases(): Promise<ExportableDatabaseInfo[]> {
    const collections = await this.getAllDatabases();
    const currentId = this.currentDatabase?.id;

    return collections.map((collection) => {
      const isCurrent = collection.id === currentId;
      const isUnlocked = collection.isEncrypted
        ? this.isDatabaseUnlocked(collection.id)
        : true;
      const isExportable = !collection.isEncrypted || isUnlocked;

      return {
        ...collection,
        isCurrent,
        isUnlocked,
        isExportable,
        lockedReason: isExportable
          ? undefined
          : "Encrypted database is locked. Unlock it before exporting.",
      };
    });
  }

  /** Previously opened sources whose content baseline and access still live here. */
  async getMemoryResidentDatabases(): Promise<ExportableDatabaseInfo[]> {
    const databases = await this.getExportableDatabases();
    return databases.filter((database) => {
      try {
        this.assertMemoryResidentDatabase(database.id);
        this.assertSecurityRevision(
          database.id,
          this.credentialSecurityRevisions.get(database.id) ?? "",
          database,
        );
        return database.isExportable && database.isUnlocked;
      } catch {
        return false;
      }
    });
  }

  private assertMemoryResidentDatabase(id: string): void {
    const access = this.getDatabaseAccessState(id);
    if (
      this.disposed ||
      !this.openedDatabaseIds.has(id) ||
      !this.latestLoadedRepresentations.has(id) ||
      !this.credentialSecurityRevisions.has(id) ||
      (access && access.status !== "ready")
    ) {
      throw new Error(
        "Database is no longer available in memory. Open and unlock it explicitly before importing or exporting.",
      );
    }
  }

  captureDatabaseOperationGuard(
    databaseIds: readonly string[],
  ): DatabaseOperationGuard {
    const ids = Object.freeze([...new Set(databaseIds)]);
    const securityEpoch = this.securityEpoch;
    const currentId = this.currentDatabase?.id;
    const currentEpoch = currentId
      ? this.captureDatabaseEpoch(currentId)
      : undefined;
    const selectionGeneration = this.selectionGeneration;
    const selectionRevision = this.operationSelectionRevision;
    const requireResidency = currentId === undefined;
    const captured = ids.map((id) => {
      if (requireResidency) this.assertMemoryResidentDatabase(id);
      return {
        id,
        epoch: this.captureDatabaseEpoch(id),
        revision: this.credentialSecurityRevisions.get(id),
        isEncrypted: undefined as boolean | undefined,
      };
    });
    const assertCurrent = () => {
      if (
        this.disposed ||
        this.securityEpoch !== securityEpoch ||
        this.selectionGeneration !== selectionGeneration ||
        this.operationSelectionRevision !== selectionRevision ||
        this.currentDatabase?.id !== currentId
      )
        throw new Error(
          "Database operation expired. Review the sources and retry.",
        );
      if (currentId && currentEpoch)
        this.assertDatabaseEpoch(currentId, currentEpoch);
      for (const source of captured) {
        this.assertDatabaseEpoch(source.id, source.epoch);
        if (requireResidency) this.assertMemoryResidentDatabase(source.id);
        const access = this.getDatabaseAccessState(source.id);
        if (
          (access && access.status !== "ready") ||
          (source.isEncrypted && !this.isDatabaseUnlocked(source.id))
        )
          throw new Error(
            "Database source is locked. Unlock it before exporting.",
          );
        const cachedRevision = this.credentialSecurityRevisions.get(source.id);
        // A source read can establish the first verified revision for an
        // unopened plaintext source. Metadata-only checks never install a
        // credential or a writer's payload/CAS baseline.
        source.revision ??= cachedRevision;
        if (cachedRevision !== undefined && cachedRevision !== source.revision)
          throw new Error(
            "Database access changed. Review the sources and retry.",
          );
      }
    };
    return Object.freeze({
      databaseIds: ids,
      assertCurrent,
      verifyCurrent: async () => {
        assertCurrent();
        for (const source of captured) {
          const latest = await this.getDatabase(source.id);
          assertCurrent();
          if (
            !latest ||
            (latest.isEncrypted && !this.isDatabaseUnlocked(source.id))
          )
            throw new Error(
              "Database source is unavailable or locked. Review the sources and retry.",
            );
          source.isEncrypted = latest.isEncrypted;
          source.revision ??= latest.securityRevision ?? "";
          this.assertSecurityRevision(source.id, source.revision, latest);
        }
        assertCurrent();
      },
    });
  }

  async readMemoryResidentDatabaseSnapshot(
    ...args: Parameters<DatabaseManager["readExportableDatabaseSnapshot"]>
  ): Promise<DatabaseExportSnapshot> {
    const id = args[0];
    const epoch = this.captureDatabaseEpoch(id);
    this.assertMemoryResidentDatabase(id);
    // Do not accept a new credential to turn an evicted source into an open one.
    if (args[2]?.collectionPassword !== undefined)
      throw new Error(
        "Memory-only export uses existing unlocked access, not a new password.",
      );
    const snapshot = await this.readExportableDatabaseSnapshot(...args);
    this.assertDatabaseEpoch(id, epoch);
    this.assertMemoryResidentDatabase(id);
    return snapshot;
  }

  async appendConnectionsToMemoryResidentDatabase(
    ...args: Parameters<DatabaseManager["appendConnectionsToDatabase"]>
  ): Promise<void> {
    this.assertMemoryResidentDatabase(args[0]);
    await this.appendConnectionsToDatabase(...args);
  }

  private rememberUnlockedDatabase(
    collection: ConnectionDatabase | null,
    password?: string,
  ): void {
    if (collection)
      this.credentialSecurityRevisions.set(
        collection.id,
        collection.securityRevision ?? "",
      );
    if (collection?.isEncrypted && password) {
      this.unlockedDatabasePasswords.set(collection.id, password);
    } else if (collection) {
      this.unlockedDatabasePasswords.delete(collection.id);
    }
    if (collection && this.currentDatabase?.id === collection.id) {
      // Refresh both halves together when this window verifies credentials
      // installed by another window. Never pair an old currentPassword with
      // the newly verified revision, including after password removal.
      this.currentPassword = collection.isEncrypted ? (password ?? null) : null;
      this.currentDatabase = {
        ...this.currentDatabase,
        isEncrypted: collection.isEncrypted,
        securityRevision: collection.securityRevision,
      };
    }
  }

  private forgetUnlockedDatabase(databaseId: string): void {
    this.openedDatabaseIds.delete(databaseId);
    this.latestLoadedRepresentations.delete(databaseId);
    clearTimeout(this.managedTimers.get(databaseId));
    this.managedTimers.delete(databaseId);
    this.managedSessions.delete(databaseId);
    this.databaseSecurityEpochs.set(
      databaseId,
      (this.databaseSecurityEpochs.get(databaseId) ?? 0) + 1,
    );
    this.unlockedDatabasePasswords.delete(databaseId);
    this.credentialSecurityRevisions.delete(databaseId);
  }

  private getUnlockedPasswordForDatabase(
    databaseId: string,
  ): string | undefined {
    if (this.currentDatabase?.id === databaseId && this.currentPassword) {
      return this.currentPassword;
    }

    return this.unlockedDatabasePasswords.get(databaseId);
  }

  private resolveExportPasswordForDatabase(
    collection: ConnectionDatabase,
    providedPassword?: string,
  ): string | undefined {
    if (collection.protectionFormat === "sorng-db") {
      this.requireManagedSession(collection.id);
      return undefined;
    }
    if (!collection.isEncrypted) {
      return undefined;
    }

    const password =
      providedPassword || this.getUnlockedPasswordForDatabase(collection.id);
    if (!password) {
      throw new InvalidPasswordError(
        "Encrypted database must be unlocked before it can be exported",
      );
    }

    return password;
  }

  private buildExportSnapshot(
    collection: ConnectionDatabase,
    data: StorageData,
    includePasswords: boolean,
    trustRecords?: TrustExportDocument | null,
  ): DatabaseExportSnapshot {
    // Generic database JSON cannot carry the vault's dependency closure. Do not
    // emit orphan credential IDs (or activate ignored local credentials by
    // dropping them); the reviewed encrypted vault archive owns this workflow.
    assertNoVaultImport(data);
    const automationLibrary =
      data.automationLibrary === undefined
        ? undefined
        : normalizeDatabaseAutomationLibrary(data.automationLibrary);
    if (
      automationLibrary &&
      !includePasswords &&
      (containsExportSecrets(automationLibrary) ||
        containsLikelySecretText(JSON.stringify(automationLibrary)))
    )
      throw new Error(
        "The database automation library contains possible literal credentials. Review it or use an explicitly credential-including protected export; no partial library was exported.",
      );
    return {
      ...(trustRecords ? { trustRecords } : {}),
      collection: {
        id: collection.id,
        name: collection.name,
        description: collection.description,
        isEncrypted: collection.isEncrypted,
        exportDate: new Date().toISOString(),
      },
      connections: data.connections.map((connection) =>
        stripHttpTrustedRedirectDestinations(
          includePasswords ? connection : redactConnectionSecrets(connection),
        ),
      ),
      settings: data.settings ?? {},
      ...(data.databaseSettings === undefined
        ? {}
        : {
            databaseSettings: normalizeDatabaseSettings(data.databaseSettings),
          }),
      tabGroups: data.tabGroups ?? [],
      colorTags: data.colorTags ?? {},
      ...(automationLibrary ? { automationLibrary } : {}),
      ...(data.recycleBin
        ? {
            recycleBin: {
              ...normalizeRecycleBin(data.recycleBin),
              entries: data.recycleBin.entries.map((entry) => ({
                ...entry,
                connection: stripHttpTrustedRedirectDestinations(
                  includePasswords
                    ? entry.connection
                    : this.redactArchivedConnection(entry.connection),
                ),
              })),
            },
          }
        : {}),
    };
  }

  private redactArchivedConnection(connection: Connection): Connection {
    const safe = stripExportSecrets(redactConnectionSecrets(connection));
    if (!safe?.id || !safe.protocol)
      throw new Error(
        "An archived connection has sensitive identity fields and cannot be exported without credentials.",
      );
    // Secret-like display names are scrubbed too, but a portable archive must
    // still have a valid connection shape. Never restore the sensitive name.
    return { ...safe, name: safe.name ?? "[Redacted connection]" };
  }

  async updateDatabase(collection: ConnectionDatabase): Promise<void> {
    const collections = await this.getAllDatabases();
    const expectedIndex =
      this.indexSnapshots.get(collections) ?? structuredClone(collections);
    const index = collections.findIndex((c) => c.id === collection.id);
    if (index >= 0) {
      if (collections[index].isEncrypted !== collection.isEncrypted) {
        throw new Error(
          "Database encryption changes require the dedicated security transaction.",
        );
      }
      collections[index] = {
        ...collection,
        securityRevision: collections[index].securityRevision,
        updatedAt: new Date().toISOString(),
      };
      await this.saveDatabases(collections, expectedIndex);
      if (this.currentDatabase?.id === collection.id) {
        this.currentDatabase = { ...collections[index] };
      }
    }
  }

  async deleteDatabase(id: string): Promise<void> {
    const collection = await this.getDatabase(id);

    // Remove collection data. The Tauri command unlinks both the
    // canonical file and its `.bak`; the IDB branch is the
    // browser-fallback we drop in P5.
    const invoke = await getInvoke();
    if (invoke) {
      await invoke("delete_database_data", { databaseId: id });
    } else {
      await IndexedDbService.transactItemsStrict(
        [this.databasesKey],
        (values) => {
          const rows = values[this.databasesKey];
          if (!Array.isArray(rows))
            throw new CorruptedDataError("Database index is malformed.");
          return {
            set: {
              [this.databasesKey]: rows.filter(
                (row: ConnectionDatabase) => row.id !== id,
              ),
            },
            remove: [`mremote-database-${id}`, `mremote-collection-${id}`],
            result: undefined,
          };
        },
      );
    }

    // Log collection deletion
    SettingsManager.getInstance().logAction(
      "info",
      "Database deleted",
      undefined,
      `Database "${collection?.name || id}" deleted`,
    );

    const wasCurrent = this.currentDatabase?.id === id;
    if (wasCurrent) {
      this.selectionGeneration += 1;
      this.currentDatabase = null;
      this.currentPassword = null;
    }
    this.forgetUnlockedDatabase(id);

    // `delete_database_data` already unlinked `<id>.trust.json` on the Rust
    // side, so there is nothing to clean up here — but if the deleted
    // database was the open one, the Trust Center must stop pointing at it.
    this.announceDatabaseChange({
      reason: "delete",
      database: this.currentDatabase,
      databaseId: wasCurrent ? null : id,
      previousDatabaseId: wasCurrent ? id : (this.currentDatabase?.id ?? null),
      connectionIds: [],
    });
  }

  async duplicateDatabase(
    collectionId: string,
    options?: {
      password?: string;
      name?: string;
      protectionTarget?: DatabaseProtectionTarget;
      confirmDeviceBoundOnly?: boolean;
      /** Copy the source database's trust records into the clone (t62 / D6). */
      includeTrust?: boolean;
    },
  ): Promise<ConnectionDatabase> {
    const epoch = this.captureDatabaseEpoch(collectionId);
    const sourceCollection = await this.getDatabase(collectionId);
    if (!sourceCollection) {
      throw new DatabaseNotFoundError();
    }
    if (
      sourceCollection.protectionFormat === "sorng-db" ||
      options?.protectionTarget
    ) {
      if (!options?.protectionTarget)
        throw new Error(
          "Managed database cloning requires new destination unlock methods. Source passwords and OS-vault references cannot be copied.",
        );
      const source = await this.loadDatabaseData(
        collectionId,
        options.password,
      );
      if (!source) throw new DatabaseNotFoundError();
      this.assertDatabaseEpoch(collectionId, epoch);
      await this.assertSnapshotCurrent(collectionId, source);
      const rows = await this.getAllDatabases();
      this.assertDatabaseEpoch(collectionId, epoch);
      const created = await this.createManagedDatabase(
        buildDuplicateDatabaseName(sourceCollection.name, rows, options.name),
        options.protectionTarget,
        {
          description: sourceCollection.description,
          data: source,
          sourceDatabaseId: collectionId,
          confirmDeviceBoundOnly: options.confirmDeviceBoundOnly,
        },
      );
      try {
        this.assertDatabaseEpoch(collectionId, epoch);
        await this.applyTrustRecords(
          created.id,
          await this.readTrustRecords(
            collectionId,
            options.includeTrust !== false,
          ),
          options.includeTrust !== false,
          "replace",
        );
      } catch {
        throw new Error(
          `Protected clone "${created.name}" (${created.id}) was committed, but trust copying did not finish. Review the created database before retrying.`,
        );
      }
      return created;
    }

    const duplicatePassword = sourceCollection.isEncrypted
      ? (options?.password ?? this.getUnlockedPasswordForDatabase(collectionId))
      : undefined;

    if (sourceCollection.isEncrypted && !duplicatePassword) {
      throw new InvalidPasswordError(
        "Password required for encrypted collection",
      );
    }

    const sourceData = await this.loadDatabaseData(
      collectionId,
      duplicatePassword,
    );
    if (!sourceData) {
      throw new DatabaseNotFoundError();
    }

    const collections = await this.getAllDatabases();
    this.assertDatabaseEpoch(collectionId, epoch);
    const sourceIndex = collections.findIndex(
      (collection) => collection.id === collectionId,
    );
    if (sourceIndex < 0) {
      throw new DatabaseNotFoundError();
    }
    this.assertSecurityRevision(
      collectionId,
      this.loadedSecurityRevisions.get(sourceData)!,
      collections[sourceIndex],
    );

    const now = new Date().toISOString();
    const duplicatedCollection: ConnectionDatabase = {
      id: generateId(),
      name: buildDuplicateDatabaseName(
        sourceCollection.name,
        collections,
        options?.name,
      ),
      description: sourceCollection.description,
      isEncrypted: sourceCollection.isEncrypted,
      createdAt: now,
      updatedAt: now,
      lastAccessed: now,
    };

    const nextCollections = [...collections];
    nextCollections.splice(sourceIndex + 1, 0, duplicatedCollection);
    await this.saveDatabases(
      nextCollections,
      this.indexSnapshots.get(collections) ?? collections,
    );
    try {
      this.assertDatabaseEpoch(collectionId, epoch);
      await this.saveDatabaseData(
        duplicatedCollection.id,
        rebindDatabaseQuickActions(
          cloneStorageData(sourceData),
          collectionId,
          duplicatedCollection.id,
        ),
        sourceCollection.isEncrypted ? duplicatePassword : undefined,
        duplicatedCollection.securityRevision ?? "",
        { expectedData: null },
      );
      this.assertDatabaseEpoch(collectionId, epoch);
      await this.assertSnapshotCurrent(collectionId, sourceData);

      // A clone is a copy of the whole database, trust included — otherwise the
      // duplicate would re-prompt for every host the original already trusted.
      const includeTrust = options?.includeTrust !== false;
      await this.applyTrustRecords(
        duplicatedCollection.id,
        await this.readTrustRecords(collectionId, includeTrust),
        includeTrust,
        "replace",
      );
      this.assertDatabaseEpoch(collectionId, epoch);

      SettingsManager.getInstance().logAction(
        "info",
        "Database cloned",
        undefined,
        `Database "${sourceCollection.name}" cloned to "${duplicatedCollection.name}"`,
      );

      await this.assertSnapshotCurrent(collectionId, sourceData);
      this.assertDatabaseEpoch(collectionId, epoch);
      return duplicatedCollection;
    } catch {
      // Once published, another window can edit the clone. An unconditional
      // rollback would delete that newer work; report the exact partial output
      // instead of hiding it behind a generic rejection or claiming success.
      throw new Error(
        `Cloning did not finish. Partial database "${duplicatedCollection.name}" (${duplicatedCollection.id}) was created and may contain copied data. Review it before retrying.`,
      );
    }
  }

  private async saveDatabases(
    collections: ConnectionDatabase[],
    expectedList: ConnectionDatabase[],
  ): Promise<void> {
    const invoke = await getInvoke();
    if (invoke) {
      // Primary path: persist the index via the P1 safe writer.
      await invoke("databases_save_index", { list: collections, expectedList });
      return;
    }
    // Browser / pre-Tauri fallback (P5 will retire this branch).
    await IndexedDbService.transactItemsStrict(
      [this.databasesKey],
      (values) => {
        if (
          JSON.stringify(values[this.databasesKey] ?? []) !==
          JSON.stringify(expectedList)
        )
          throw new Error("Database index changed; reload before retrying.");
        return { set: { [this.databasesKey]: collections }, result: undefined };
      },
    );
  }

  // Collection data management
  async saveDatabaseData(
    collectionId: string,
    data: StorageData,
    password?: string,
    expectedSecurityRevision?: string,
    contentExpectation?: { expectedData: unknown },
  ): Promise<void> {
    assertNoSynologyRedirectRuntimeContext(data);
    if (data.databaseSettings !== undefined)
      normalizeDatabaseSettings(data.databaseSettings);
    // Capture before ANY await; a later read must not bless an older writer.
    const expectedData = contentExpectation
      ? contentExpectation.expectedData
      : (this.loadedRepresentations.get(data) ??
        this.latestLoadedRepresentations.get(collectionId));
    const epoch = this.captureDatabaseEpoch(collectionId);
    let revision =
      expectedSecurityRevision ??
      (!password ||
      this.getUnlockedPasswordForDatabase(collectionId) === password
        ? this.credentialSecurityRevisions.get(collectionId)
        : undefined);
    const collection = await this.getDatabase(collectionId);
    if (revision !== undefined)
      this.assertSecurityRevision(collectionId, revision, collection);
    if (!collection) throw new DatabaseNotFoundError();
    if (collection.protectionFormat === "sorng-db") {
      this.assertDatabaseEpoch(collectionId, epoch);
      const session = this.requireManagedSession(collectionId);
      if (expectedData === undefined)
        throw new Error(
          "Database content baseline is unavailable. Reload before saving; no data was overwritten.",
        );
      let outcome;
      try {
        outcome = await databaseProtection.save(
          collectionId,
          session.sessionId,
          session.securityRevision,
          data,
          expectedData,
        );
      } catch (error) {
        // A missed cross-window notification must not leave revoked access visible.
        if (this.captureDatabaseEpoch(collectionId) === epoch)
          this.suspendManagedDatabase(collectionId, "security-changed");
        throw error;
      }
      this.assertDatabaseEpoch(collectionId, epoch);
      if (!outcome.committed) {
        this.suspendManagedDatabase(collectionId, "security-changed");
        throw new Error("Native database save was not committed.");
      }
      if (outcome.securityRevision !== session.securityRevision) {
        this.suspendManagedDatabase(collectionId, "security-changed");
        throw new Error(
          "Native save returned an unexpected security revision.",
        );
      }
      if (outcome.cleanupPending || outcome.warnings.length) {
        try {
          SettingsManager.getInstance().logAction(
            "warn",
            "Database saved; recovery cleanup needs attention",
            undefined,
            outcome.warnings.join(" "),
          );
        } catch {
          /* The save is committed even if the notification fails. */
        }
      }
      this.loadedRepresentations.set(data, structuredClone(data));
      this.latestLoadedRepresentations.set(collectionId, structuredClone(data));
      return;
    }
    if (collection?.isEncrypted && !password) {
      throw new InvalidPasswordError(
        "A password is required to save an encrypted database; plaintext overwrite was blocked.",
      );
    }
    if (collection.isEncrypted !== Boolean(password))
      throw new Error(
        "Database security changed; stale password-bearing save was rejected.",
      );
    if (expectedData === undefined)
      throw new Error(
        "Database content baseline is unavailable. Reload before saving; no data was overwritten.",
      );
    // An explicitly supplied, previously unverified password must decrypt the
    // current generation before it can authorize replacing it. Initial creation
    // supplies its new generation explicitly because no payload exists yet.
    if (revision === undefined && password) {
      const verified = await this.loadDatabaseData(collectionId, password);
      if (!verified) throw new DatabaseNotFoundError();
      revision = this.loadedSecurityRevisions.get(verified);
    }
    revision ??= collection.securityRevision ?? "";
    // Encrypt up front when a password is set — the IPC layer (and
    // the IndexedDB fallback below) are bytes-in / bytes-out and
    // know nothing about per-DB passwords. The payload becomes
    // a WebCrypto envelope string instead of the raw object.
    const payload: unknown = password
      ? await encryptExportWithPassword(JSON.stringify(data), password)
      : data;

    const invoke = await getInvoke();
    this.assertDatabaseEpoch(collectionId, epoch);
    if (invoke) {
      // Primary path: persist via the P1 safe writer.
      try {
        await invoke("save_database_data", {
          databaseId: collectionId,
          data: payload,
          expectedData,
          expectedSecurityRevision: revision,
        });
      } catch (error) {
        // A remote-window commit can win while encryption/IPC is pending.
        // Retire the old credential when the native CAS rejects its revision.
        this.assertSecurityRevision(
          collectionId,
          revision,
          await this.getDatabase(collectionId),
        );
        throw error;
      }
      this.assertDatabaseEpoch(collectionId, epoch);
      this.loadedRepresentations.set(data, structuredClone(payload));
      this.latestLoadedRepresentations.set(
        collectionId,
        structuredClone(payload),
      );
      return;
    }

    if (data.databaseSettings !== undefined)
      throw new Error(
        "Database-owned settings require native database storage. No browser fallback was written.",
      );
    // ── Browser / pre-Tauri fallback (P5 will retire this branch). ──
    const key = `mremote-database-${collectionId}`;
    const legacyKey = `mremote-collection-${collectionId}`;
    await IndexedDbService.transactItemsStrict(
      [this.databasesKey, key, legacyKey],
      (values) => {
        this.assertDatabaseEpoch(collectionId, epoch);
        const rows = values[this.databasesKey];
        const latest = Array.isArray(rows)
          ? rows.find((row: ConnectionDatabase) => row.id === collectionId)
          : undefined;
        this.assertSecurityRevision(collectionId, revision!, latest);
        if (
          JSON.stringify(values[key] ?? values[legacyKey] ?? null) !==
          JSON.stringify(expectedData)
        )
          throw new Error("Database contents changed; reload before saving.");
        if (latest.isEncrypted !== Boolean(password)) {
          throw new Error(
            "Database security changed; stale password-bearing save was rejected.",
          );
        }
        return {
          set: { [key]: payload },
          remove: [legacyKey],
          result: undefined,
        };
      },
    );
    this.assertDatabaseEpoch(collectionId, epoch);
    this.loadedRepresentations.set(data, structuredClone(payload));
    this.latestLoadedRepresentations.set(
      collectionId,
      structuredClone(payload),
    );
  }

  async loadDatabaseData(
    collectionId: string,
    password?: string,
    expectedSecurityRevision?: string,
    options?: { preserveBaseline?: boolean },
  ): Promise<StorageData | null> {
    const epoch = this.captureDatabaseEpoch(collectionId);
    const key = `mremote-database-${collectionId}`;
    const legacyKey = `mremote-collection-${collectionId}`;
    const credentialRevision =
      expectedSecurityRevision ??
      (!password ||
      this.getUnlockedPasswordForDatabase(collectionId) === password
        ? this.credentialSecurityRevisions.get(collectionId)
        : undefined);
    const collection = await this.getDatabase(collectionId);
    const revision = credentialRevision ?? collection?.securityRevision ?? "";
    this.assertSecurityRevision(collectionId, revision, collection);
    if (collection?.protectionFormat === "sorng-db") {
      this.assertDatabaseEpoch(collectionId, epoch);
      const session = this.requireManagedSession(collectionId);
      let result;
      try {
        result = await databaseProtection.load(
          collectionId,
          session.sessionId,
          session.securityRevision,
        );
      } catch (error) {
        if (this.captureDatabaseEpoch(collectionId) === epoch)
          this.suspendManagedDatabase(collectionId, "security-changed");
        throw error;
      }
      this.assertDatabaseEpoch(collectionId, epoch);
      if (
        result.sessionId !== session.sessionId ||
        result.securityRevision !== session.securityRevision ||
        result.sessionExpiresAt !== session.sessionExpiresAt ||
        !Array.isArray(result.data?.connections)
      ) {
        this.suspendManagedDatabase(collectionId, "security-changed");
        throw new Error("Native database load returned an invalid session.");
      }
      this.requireManagedSession(collectionId);
      this.loadedSecurityRevisions.set(result.data, result.securityRevision);
      this.loadedRepresentations.set(result.data, structuredClone(result.data));
      if (!options?.preserveBaseline)
        this.latestLoadedRepresentations.set(
          collectionId,
          structuredClone(result.data),
        );
      return result.data;
    }
    let stored: any = null;

    if (collection?.isEncrypted && !password) {
      throw new InvalidPasswordError(
        "Password required for encrypted collection",
      );
    }

    const invoke = await getInvoke();
    if (invoke) {
      // Primary path: read via the P1 safe reader. The envelope tells
      // us whether the value came off `.bak`/`.v0.bak` — surface that
      // through the action log so the user knows the recovery ladder
      // fired, then unwrap into the same `stored` shape the legacy
      // path produces.
      const envelope = await invoke<LoadResultEnvelope<unknown> | null>(
        "load_database_data",
        { databaseId: collectionId },
      );
      if (envelope) {
        if (envelope.source !== "current") {
          logRecovery(`database ${collectionId}`, envelope.source);
        }
        stored = envelope.value;
      }
    } else {
      // ── Browser / pre-Tauri fallback (P5 will retire this branch). ──
      stored = await IndexedDbService.transactItemsStrict(
        [this.databasesKey, key, legacyKey],
        (values) => {
          this.assertDatabaseEpoch(collectionId, epoch);
          const rows = values[this.databasesKey];
          const latest = Array.isArray(rows)
            ? rows.find((row: ConnectionDatabase) => row.id === collectionId)
            : undefined;
          this.assertSecurityRevision(collectionId, revision, latest);
          const canonical = values[key];
          const legacy = values[legacyKey];
          // Read, canonical-absent check and legacy move share one transaction;
          // no captured legacy value can overwrite another window's commit.
          const migrate =
            !options?.preserveBaseline && canonical === null && legacy !== null;
          return {
            set: migrate ? { [key]: legacy } : {},
            remove: migrate ? [legacyKey] : [],
            result: canonical ?? legacy,
          };
        },
      );
    }

    if (!stored) {
      throw new DatabaseNotFoundError();
    }
    this.assertDatabaseEpoch(collectionId, epoch);

    try {
      if (password) {
        let decrypted: string | null = null;

        // Try export WebCrypto envelopes first, then legacy salt.iv.ciphertext.
        if (typeof stored === "string" && isWebCryptoPayload(stored)) {
          try {
            decrypted = await decryptExportWithPassword(stored, password);
          } catch {
            // Not new format or wrong password — fall through to legacy
          }
        }

        if (
          !decrypted &&
          typeof stored === "string" &&
          stored.split(".").length === 3
        ) {
          try {
            decrypted = await decryptData(stored, password);
          } catch {
            // Not legacy WebCrypto format or wrong password — fall through
          }
        }

        // Fallback: try legacy CryptoJS decryption for backward compatibility
        if (!decrypted && typeof stored === "string") {
          decrypted = await legacyDecrypt(stored, password);
        }

        if (!decrypted) {
          throw new InvalidPasswordError();
        }
        try {
          const parsed = JSON.parse(decrypted) as StorageData;
          this.assertDatabaseEpoch(collectionId, epoch);
          if (
            !parsed ||
            typeof parsed !== "object" ||
            !Array.isArray(parsed.connections)
          ) {
            throw new CorruptedDataError(
              "Decrypted database payload has an invalid shape.",
            );
          }
          await this.assertSecurityRevisionAfterRead(
            collectionId,
            revision,
            epoch,
          );
          if (!options?.preserveBaseline)
            this.rememberUnlockedDatabase(collection, password);
          this.loadedRepresentations.set(parsed, stored);
          if (!options?.preserveBaseline)
            this.latestLoadedRepresentations.set(
              collectionId,
              structuredClone(stored),
            );
          this.loadedSecurityRevisions.set(parsed, revision);
          return parsed;
        } catch (error) {
          if (error instanceof SyntaxError) {
            const trimmed = decrypted.trim();
            if (trimmed.startsWith("{") || trimmed.startsWith("[")) {
              throw new CorruptedDataError("Corrupted collection data");
            }
            throw new InvalidPasswordError();
          }
          throw error;
        }
      } else {
        if (
          typeof stored !== "object" ||
          Array.isArray(stored) ||
          !Array.isArray(stored.connections)
        ) {
          throw new CorruptedDataError(
            "Database metadata and payload disagree; plaintext loading was blocked.",
          );
        }
        await this.assertSecurityRevisionAfterRead(
          collectionId,
          revision,
          epoch,
        );
        if (!options?.preserveBaseline)
          this.rememberUnlockedDatabase(collection);
        this.loadedRepresentations.set(
          stored as StorageData,
          structuredClone(stored),
        );
        this.loadedSecurityRevisions.set(stored as StorageData, revision);
        if (!options?.preserveBaseline)
          this.latestLoadedRepresentations.set(
            collectionId,
            structuredClone(stored),
          );
        return stored as StorageData;
      }
    } catch (error) {
      if (error instanceof InvalidPasswordError) {
        throw error;
      }
      if (error instanceof SyntaxError) {
        throw new CorruptedDataError("Corrupted collection data");
      }
      if (error instanceof Error && error.message === "Malformed UTF-8 data") {
        throw new InvalidPasswordError();
      }
      throw error;
    }
  }

  // Current collection data access
  async saveCurrentDatabaseData(data: StorageData): Promise<void> {
    if (!this.currentDatabase) {
      throw new Error("No collection selected");
    }
    const revision = this.credentialSecurityRevisions.get(
      this.currentDatabase.id,
    );
    if (revision === undefined)
      throw new Error("Database access expired. Unlock again before retrying.");
    await this.saveDatabaseData(
      this.currentDatabase.id,
      data,
      this.currentPassword || undefined,
      revision,
    );
  }

  async loadCurrentDatabaseData(): Promise<StorageData | null> {
    if (!this.currentDatabase) {
      throw new Error("No collection selected");
    }
    const revision = this.credentialSecurityRevisions.get(
      this.currentDatabase.id,
    );
    if (revision === undefined)
      throw new Error("Database access expired. Unlock again before retrying.");
    return this.loadDatabaseData(
      this.currentDatabase.id,
      this.currentPassword || undefined,
      revision,
    );
  }

  // Export collection with encryption
  async exportDatabase(
    collectionId: string,
    includePasswords: boolean = false,
    exportPassword?: string,
    collectionPassword?: string,
    exportEncryptionOptions?: PasswordEncryptionOptions,
    options?: { fullDatabase?: boolean },
  ): Promise<string> {
    if (options?.fullDatabase) {
      if (!includePasswords || !exportPassword)
        throw new FullDatabaseArchiveError("password");
      return this.exportFullDatabaseArchive(collectionId, exportPassword, {
        collectionPassword,
        encryptionOptions: exportEncryptionOptions,
      });
    }
    const exportData = await this.readExportableDatabaseSnapshot(
      collectionId,
      includePasswords,
      { collectionPassword },
    );

    const jsonData = JSON.stringify(exportData, null, 2);

    if (exportPassword) {
      await validateNewPassword(exportPassword, "export");
      return encryptExportWithPassword(
        jsonData,
        exportPassword,
        exportEncryptionOptions,
      );
    }

    return jsonData;
  }

  /** In-memory only. The full archive owns all references and private sections. */
  async readFullDatabaseArchive(
    collectionId: string,
    options?: { collectionPassword?: string },
  ): Promise<FullDatabaseArchive> {
    return this.readExportableDatabaseSnapshot(collectionId, true, {
      ...options,
      fullDatabase: true,
    }) as Promise<FullDatabaseArchive>;
  }

  async exportFullDatabaseArchive(
    collectionId: string,
    exportPassword: string,
    options?: {
      collectionPassword?: string;
      encryptionOptions?: PasswordEncryptionOptions;
    },
  ): Promise<string> {
    if (
      typeof exportPassword !== "string" ||
      exportPassword.length < 12 ||
      exportPassword.length > 1024
    )
      throw new FullDatabaseArchiveError("password");
    const epoch = this.captureDatabaseEpoch(collectionId);
    const archive = await this.readFullDatabaseArchive(collectionId, options);
    this.assertDatabaseEpoch(collectionId, epoch);
    const encrypted = await encryptFullDatabaseArchive(
      archive,
      exportPassword,
      options?.encryptionOptions,
    );
    this.assertDatabaseEpoch(collectionId, epoch);
    return encrypted;
  }

  async readExportableDatabaseSnapshot(
    collectionId: string,
    includePasswords: boolean = false,
    options?: {
      collectionPassword?: string;
      /** Explicit private whole-database archive; passwords and trust must be included. */
      fullDatabase?: boolean;
      /**
       * Carry the database's Trust Center records in the snapshot (t62 / D6).
       * Defaults to `true`; the Export / Clone tabs expose it as the
       * "Trusted hosts & certificates" inclusion toggle.
       */
      includeTrust?: boolean;
    },
  ): Promise<DatabaseExportSnapshot> {
    if (
      options?.fullDatabase &&
      (!includePasswords || options.includeTrust === false)
    )
      throw new FullDatabaseArchiveError("protection");
    const epoch = this.captureDatabaseEpoch(collectionId);
    const collection = await this.getDatabase(collectionId);
    this.assertDatabaseEpoch(collectionId, epoch);
    if (!collection) {
      throw new Error("Collection not found");
    }

    const password = this.resolveExportPasswordForDatabase(
      collection,
      options?.collectionPassword,
    );
    const data = await this.loadDatabaseData(collectionId, password);
    if (!data) {
      throw new Error("Failed to load collection data");
    }

    this.assertDatabaseEpoch(collectionId, epoch);
    if (options?.fullDatabase) {
      // Unlike legacy exports, a full backup must never silently omit trust or
      // log a backend error that could contain private archive values.
      const invoke = await getInvoke();
      this.assertDatabaseEpoch(collectionId, epoch);
      if (!invoke) throw new FullDatabaseArchiveError("trust");
      let trustRecords: TrustExportDocument;
      try {
        trustRecords = await invoke<TrustExportDocument>(
          "trust_export_database",
          { databaseId: collectionId },
        );
      } catch {
        throw new FullDatabaseArchiveError("trust");
      }
      this.assertDatabaseEpoch(collectionId, epoch);
      const archive = await buildFullDatabaseArchive(
        collection,
        data,
        trustRecords,
      );
      this.assertDatabaseEpoch(collectionId, epoch);
      await this.assertSnapshotCurrent(collectionId, data);
      this.assertDatabaseEpoch(collectionId, epoch);
      return archive;
    }
    const trustRecords = await this.readTrustRecords(
      collectionId,
      options?.includeTrust !== false,
    );
    this.assertDatabaseEpoch(collectionId, epoch);
    await this.assertSnapshotCurrent(collectionId, data);
    this.assertDatabaseEpoch(collectionId, epoch);
    return this.buildExportSnapshot(
      collection,
      data,
      includePasswords,
      trustRecords,
    );
  }

  async appendConnectionsToDatabase(
    collectionId: string,
    connections: Connection[],
    options?: {
      /** Trust records to merge into the target database (t62 / D6). */
      trustRecords?: TrustExportDocument | null;
      /** Defaults to `true`; ignored when `trustRecords` is absent. */
      includeTrust?: boolean;
    },
  ): Promise<void> {
    const epoch = this.captureDatabaseEpoch(collectionId);
    assertPortableCredentialSources(connections);
    const collection = await this.getDatabase(collectionId);
    this.assertDatabaseEpoch(collectionId, epoch);
    if (!collection) {
      throw new DatabaseNotFoundError();
    }

    const password = this.resolveExportPasswordForDatabase(collection);
    const data = await this.loadDatabaseData(collectionId, password);
    this.assertDatabaseEpoch(collectionId, epoch);
    if (!data) {
      throw new DatabaseNotFoundError();
    }

    await this.saveDatabaseData(
      collectionId,
      {
        ...data,
        connections: [
          ...(data.connections ?? []),
          ...connections.map(stripHttpTrustedRedirectDestinations),
        ],
        settings: data.settings ?? {},
        timestamp: Date.now(),
        tabGroups: data.tabGroups ?? [],
        colorTags: data.colorTags ?? {},
      },
      password,
      this.loadedSecurityRevisions.get(data),
    );

    // Appending connections into an existing database also merges whatever
    // trust the source carried. Merge never downgrades: an unrevoked import
    // cannot overwrite a revoked record (enforced Rust-side).
    this.assertDatabaseEpoch(collectionId, epoch);
    await this.applyTrustRecords(
      collectionId,
      options?.trustRecords,
      options?.includeTrust !== false,
    );
  }

  async removePasswordFromDatabase(
    collectionId: string,
    password: string,
  ): Promise<DatabaseSecurityOutcome> {
    return this.commitDatabaseSecurity(collectionId, password, undefined);
  }

  async changeDatabasePassword(
    collectionId: string,
    currentPassword: string | undefined,
    newPassword: string,
  ): Promise<DatabaseSecurityOutcome> {
    await validateNewPassword(newPassword, "database");
    if (!newPassword)
      throw new InvalidPasswordError(
        "A non-empty new database password is required.",
      );
    return this.commitDatabaseSecurity(
      collectionId,
      currentPassword,
      newPassword,
    );
  }

  private async commitDatabaseSecurity(
    collectionId: string,
    currentPassword: string | undefined,
    newPassword: string | undefined,
  ): Promise<DatabaseSecurityOutcome> {
    const epoch = this.captureDatabaseEpoch(collectionId);
    const collection = await this.getDatabase(collectionId);
    if (!collection) throw new Error("Collection not found");
    if (collection.protectionFormat === "sorng-db")
      throw new Error(
        "Use managed database protection to review and replace unlock methods.",
      );

    const data = collection.isEncrypted
      ? await this.loadDatabaseData(collectionId, currentPassword)
      : await this.loadDatabaseData(collectionId);

    if (data === null) {
      throw new Error("Invalid password");
    }

    const expectedData = this.loadedRepresentations.get(data);
    if (expectedData === undefined)
      throw new Error(
        "Database snapshot has no verified storage representation.",
      );
    const payload = newPassword
      ? await encryptExportWithPassword(JSON.stringify(data), newPassword)
      : data;
    const securityRevision = generateId();
    const updatedAt = new Date().toISOString();
    const updated = {
      ...collection,
      isEncrypted: Boolean(newPassword),
      securityRevision,
      updatedAt,
    };
    const invoke = await getInvoke();
    this.assertDatabaseEpoch(collectionId, epoch);
    let outcome: DatabaseSecurityOutcome;
    if (invoke) {
      outcome = await invoke<DatabaseSecurityOutcome>(
        "change_database_security",
        {
          databaseId: collectionId,
          data: payload,
          expectedData,
          isEncrypted: Boolean(newPassword),
          expectedSecurityRevision: collection.securityRevision ?? "",
          securityRevision,
          updatedAt,
        },
      );
    } else {
      const key = `mremote-database-${collectionId}`;
      outcome = await IndexedDbService.transactItemsStrict(
        [this.databasesKey, key],
        (values) => {
          this.assertDatabaseEpoch(collectionId, epoch);
          const rows = values[this.databasesKey];
          if (!Array.isArray(rows))
            throw new CorruptedDataError("Database index is malformed.");
          const latest = rows.find(
            (row: ConnectionDatabase) => row.id === collectionId,
          );
          if (
            !latest ||
            (latest.securityRevision ?? "") !==
              (collection.securityRevision ?? "") ||
            JSON.stringify(values[key]) !== JSON.stringify(expectedData)
          ) {
            throw new Error(
              "Database contents or security changed during password preparation; reload before retrying.",
            );
          }
          return {
            set: {
              [this.databasesKey]: rows.map((row: ConnectionDatabase) =>
                row.id === collectionId
                  ? {
                      ...row,
                      isEncrypted: updated.isEncrypted,
                      securityRevision,
                      updatedAt,
                    }
                  : row,
              ),
              [key]: payload,
            },
            remove: [`mremote-collection-${collectionId}`],
            result: { committed: true, cleanupPending: false, warnings: [] },
          };
        },
      );
    }
    if (!outcome?.committed)
      throw new Error("Database security transaction did not commit.");
    // A durable commit is authoritative even if old-generation cleanup needs retry.
    // Never reattach a credential after a lock that happened while IPC was pending.
    if (this.captureDatabaseEpoch(collectionId) !== epoch) {
      return {
        ...outcome,
        warnings: [
          ...outcome.warnings,
          "The security change committed, but access was locked while it completed. Unlock with the new credentials before reopening.",
        ],
      };
    }
    this.forgetUnlockedDatabase(collectionId);
    if (this.currentDatabase?.id === collectionId) {
      this.currentPassword = newPassword ?? null;
      this.currentDatabase = updated;
    }
    this.rememberUnlockedDatabase(updated, newPassword);
    this.latestLoadedRepresentations.set(
      collectionId,
      structuredClone(payload),
    );
    if (this.currentDatabase?.id === collectionId) {
      emitCurrentDatabaseChange({
        reason: "security-change",
        database: updated,
        databaseId: collectionId,
        previousDatabaseId: collectionId,
        connectionIds: data.connections.map((connection) => connection.id),
        trustActivation: Promise.resolve(),
      });
    }
    return outcome;
  }

  async createManagedDatabase(
    name: string,
    target: DatabaseProtectionTarget,
    options: {
      description?: string;
      data?: StorageData;
      /** Internal whole-database import ownership; never infer from a connection ID. */
      sourceDatabaseId?: string;
      confirmDeviceBoundOnly?: boolean;
    } = {},
  ): Promise<ConnectionDatabase> {
    if (target.keepSlotIds.length || !target.newSlots.length)
      throw new Error(
        "A new database requires newly enrolled unlock methods; existing slot references cannot be copied.",
      );
    // Capability/listener failure must occur before publishing even an empty row.
    await databaseProtection.capabilities();
    await this.ensureManagedListener();
    const created = await this.createDatabase(name, options.description);
    try {
      const result = await this.changeManagedDatabaseProtection(
        created.id,
        target,
        {
          initializeWithData: options.data
            ? rebindDatabaseQuickActions(
                options.data,
                options.sourceDatabaseId,
                created.id,
              )
            : undefined,
          confirmDeviceBoundOnly: options.confirmDeviceBoundOnly,
        },
      );
      return {
        ...created,
        isEncrypted: true,
        protectionFormat: "sorng-db",
        securityRevision: result.securityRevision,
      };
    } catch (error) {
      // No unconditional delete: another window may have changed the indexed row.
      throw new Error(
        `Database "${created.name}" (${created.id}) was created, but managed initialization did not finish. It may be empty or already protected; inspect it before retrying. ${error instanceof Error ? error.message : String(error)}`,
      );
    }
  }

  async importDatabase(
    content: string,
    options?: {
      importPassword?: string;
      collectionName?: string;
      encryptPassword?: string;
      protectionTarget?: DatabaseProtectionTarget;
      confirmDeviceBoundOnly?: boolean;
      /**
       * Apply the export's `trustRecords` to the new database (t62 / D6).
       * Defaults to `true`. Exports written before t62 simply have no
       * `trustRecords`, so an old file imports exactly as it always did.
       */
      includeTrust?: boolean;
    },
  ): Promise<ConnectionDatabase> {
    let parsed: any;
    let authenticatedCurrentEnvelope = false;
    try {
      if (isWebCryptoPayload(content)) {
        if (!options?.importPassword) {
          throw new InvalidPasswordError(
            "Password required for encrypted export",
          );
        }
        parsed = JSON.parse(
          await decryptExportWithPassword(content, options.importPassword),
        );
        // isWebCryptoPayload also recognizes legacy dotted data. Full archives
        // require the current authenticated, versioned password envelope.
        if (content.trimStart().startsWith("{")) {
          const envelope = JSON.parse(content);
          authenticatedCurrentEnvelope =
            envelope.version === 2 && envelope.algorithm === "AES-256-GCM";
        }
      } else {
        parsed = JSON.parse(content);
      }
    } catch (error) {
      if (error instanceof InvalidPasswordError) {
        throw error;
      }
      if (!options?.importPassword) {
        throw new InvalidPasswordError(
          "Password required for encrypted export",
        );
      }

      let decrypted: string | null = null;

      // Try new Web Crypto format first
      if (isWebCryptoPayload(content)) {
        try {
          decrypted = await decryptExportWithPassword(
            content,
            options.importPassword,
          );
        } catch {
          // Not new format — fall through to legacy
        }
      }

      // Fallback to legacy CryptoJS
      if (!decrypted) {
        decrypted = await legacyDecrypt(content, options.importPassword);
      }

      if (!decrypted) {
        throw new InvalidPasswordError();
      }
      parsed = JSON.parse(decrypted);
    }

    if (isFullDatabaseArchive(parsed)) {
      if (
        !authenticatedCurrentEnvelope ||
        !options?.protectionTarget ||
        options.encryptPassword ||
        options.includeTrust === false
      )
        throw new FullDatabaseArchiveError("protection");
      const archive = await normalizeFullDatabaseArchive(parsed);
      const invoke = await getInvoke();
      if (!invoke) throw new FullDatabaseArchiveError("protection");
      const created = await this.createManagedDatabase(
        options.collectionName || archive.collection.name,
        options.protectionTarget,
        {
          description: archive.collection.description,
          data: fullDatabaseArchiveData(archive),
          sourceDatabaseId: archive.collection.id,
          confirmDeviceBoundOnly: options.confirmDeviceBoundOnly,
        },
      );
      const epoch = this.captureDatabaseEpoch(created.id);
      try {
        // New database: replace also restores the archive's global trust policy.
        // Native validation/persistence owns identities; do not use best-effort merge.
        const outcome = await invoke<TrustImportOutcome>(
          "trust_import_database",
          {
            databaseId: created.id,
            document: archive.trustRecords,
            mode: "replace",
          },
        );
        this.assertDatabaseEpoch(created.id, epoch);
        if (
          !outcome ||
          outcome.skipped !== 0 ||
          outcome.imported !== archive.trustRecords.records.length
        )
          throw new FullDatabaseArchiveError("trust");
      } catch {
        // The managed data transaction may already have committed. Do not
        // claim success, delete it, or publish backend error/secret contents.
        throw new FullDatabaseRestoreIncompleteError(created.id);
      }
      return created;
    }
    assertNoVaultImport(parsed);
    const collectionName = options?.collectionName || parsed?.collection?.name;
    if (!collectionName) {
      throw new Error("Collection name missing in import");
    }
    const documents =
      parsed?.documents === undefined
        ? undefined
        : normalizeDatabaseDocuments(parsed.documents);
    if (documents) {
      if (!options?.protectionTarget || !isWebCryptoPayload(content))
        throw new Error(
          "Document archives require an encrypted source and a new managed protected database destination. No unprotected document copy was created.",
        );
      await verifyDocumentAttachments(documents);
    }

    const connections = (parsed?.connections ?? []).map((conn: any) => ({
      ...stripHttpTrustedRedirectDestinations(conn),
      password: conn.password === "***ENCRYPTED***" ? undefined : conn.password,
      basicAuthPassword:
        conn.basicAuthPassword === "***ENCRYPTED***"
          ? undefined
          : conn.basicAuthPassword,
    }));

    const importedData: StorageData = {
      connections,
      settings: parsed?.settings ?? {},
      ...(parsed?.databaseSettings === undefined
        ? {}
        : {
            databaseSettings: normalizeDatabaseSettings(
              parsed.databaseSettings,
            ),
          }),
      timestamp: Date.now(),
      ...(parsed?.automationLibrary === undefined
        ? {}
        : {
            automationLibrary: normalizeDatabaseAutomationLibrary(
              parsed.automationLibrary,
            ),
          }),
      ...(documents ? { documents } : {}),
      ...(parsed?.recycleBin !== undefined
        ? { recycleBin: normalizeRecycleBin(parsed.recycleBin) }
        : {}),
      tabGroups: Array.isArray(parsed?.tabGroups) ? parsed.tabGroups : [],
      colorTags:
        parsed?.colorTags && typeof parsed.colorTags === "object"
          ? parsed.colorTags
          : {},
    };
    if (options?.protectionTarget) {
      if (options.encryptPassword)
        throw new Error(
          "Choose managed protection or a legacy database password, not both.",
        );
      const created = await this.createManagedDatabase(
        collectionName,
        options.protectionTarget,
        {
          description: parsed?.collection?.description,
          data: importedData,
          sourceDatabaseId: parsed?.collection?.id,
          confirmDeviceBoundOnly: options.confirmDeviceBoundOnly,
        },
      );
      await this.applyTrustRecords(
        created.id,
        parsed?.trustRecords as TrustExportDocument | undefined,
        options.includeTrust !== false,
      );
      return created;
    }
    const collection = await this.createDatabase(
      collectionName,
      parsed?.collection?.description,
      Boolean(options?.encryptPassword),
      options?.encryptPassword,
    );

    await this.saveDatabaseData(
      collection.id,
      rebindDatabaseQuickActions(
        importedData,
        parsed?.collection?.id,
        collection.id,
      ),
      options?.encryptPassword,
    );

    await this.applyTrustRecords(
      collection.id,
      parsed?.trustRecords as TrustExportDocument | undefined,
      options?.includeTrust !== false,
    );

    return collection;
  }

  // Generate export filename
  generateExportFilename(): string {
    const now = new Date();
    const datetime = now.toISOString().replace(/[:.]/g, "-").slice(0, -5);
    const randomHex = Math.random().toString(16).substring(2, 8);
    return `sortofremoteng-exports-${datetime}-${randomHex}.json`;
  }
}
