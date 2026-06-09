import { Connection, ConnectionDatabase } from "../../types/connection/connection";
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

async function deriveKey(password: string, salt: Uint8Array): Promise<CryptoKey> {
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
    { name: "PBKDF2", salt: asBufferSource(salt), iterations: PBKDF2_ITERATIONS, hash: "SHA-256" },
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
async function legacyDecrypt(ciphertext: string, password: string): Promise<string | null> {
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

export interface DatabaseExportSnapshot {
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
}

const SECRET_PLACEHOLDER = "***ENCRYPTED***";

function redactConnectionSecrets(connection: Connection): Connection {
  const next = { ...connection } as Connection;

  if (next.password) next.password = SECRET_PLACEHOLDER;
  if (next.basicAuthPassword) next.basicAuthPassword = SECRET_PLACEHOLDER;
  delete next.privateKey;
  delete next.passphrase;
  delete next.totpSecret;
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
  private readonly unlockedDatabasePasswords = new Map<string, string>();

  static getInstance(): DatabaseManager {
    if (!DatabaseManager.instance) {
      DatabaseManager.instance = new DatabaseManager();
    }
    return DatabaseManager.instance;
  }

  static resetInstance(): void {
    (DatabaseManager as any).instance = undefined;
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
    collections.push(collection);
    await this.saveDatabases(collections);

    // Assumes collection count is modest; appending and rewriting the entire
    // array could be expensive if thousands of collections were stored.
    // Initialize empty data for the collection
    if (isEncrypted && password) {
      await this.saveDatabaseData(
        collection.id,
        { connections: [], settings: {}, timestamp: Date.now() },
        password,
      );
      this.rememberUnlockedDatabase(collection, password);
    } else {
      await this.saveDatabaseData(collection.id, {
        connections: [],
        settings: {},
        timestamp: Date.now(),
      });
    }

    // Log collection creation
    SettingsManager.getInstance().logAction(
      'info',
      'Database created',
      undefined,
      `Database "${name}" created${isEncrypted ? ' (encrypted)' : ''}`
    );

    return collection;
  }

  async getAllDatabases(): Promise<ConnectionDatabase[]> {
    try {
      const invoke = await getInvoke();
      if (invoke) {
        // Primary path (Tauri runtime): the P1 file-storage backend.
        const envelope = await invoke<LoadResultEnvelope<ConnectionDatabase[]> | null>(
          "databases_list",
        );
        if (envelope == null) return [];
        if (envelope.source !== "current") {
          logRecovery("databases index", envelope.source);
        }
        const list = Array.isArray(envelope.value) ? envelope.value : [];
        return list.map((c: any) => ({
          ...c,
          createdAt: typeof c.createdAt === 'string' ? c.createdAt : new Date(c.createdAt).toISOString(),
          updatedAt: typeof c.updatedAt === 'string' ? c.updatedAt : new Date(c.updatedAt).toISOString(),
          lastAccessed: typeof c.lastAccessed === 'string' ? c.lastAccessed : new Date(c.lastAccessed).toISOString(),
        }));
      }

      // ── Browser / pre-Tauri fallback (P5 will retire this branch). ──
      // No file storage available; fall back to the IndexedDB rows
      // existing tests rely on. Production never reaches this code.
      let collections = await IndexedDbService.getItem<ConnectionDatabase[]>(
        this.databasesKey,
      );
      if (!collections) {
        const legacy = await IndexedDbService.getItem<ConnectionDatabase[]>(
          this.legacyDatabasesKey,
        );
        if (legacy) {
          await IndexedDbService.setItem(this.databasesKey, legacy);
          try {
            await IndexedDbService.removeItem(this.legacyDatabasesKey);
          } catch {
            // best-effort
          }
          collections = legacy;
        }
      }
      if (collections) {
        return collections.map((c: any) => ({
          ...c,
          createdAt: typeof c.createdAt === 'string' ? c.createdAt : new Date(c.createdAt).toISOString(),
          updatedAt: typeof c.updatedAt === 'string' ? c.updatedAt : new Date(c.updatedAt).toISOString(),
          lastAccessed: typeof c.lastAccessed === 'string' ? c.lastAccessed : new Date(c.lastAccessed).toISOString(),
        }));
      }
      return [];
    } catch (error) {
      console.error("Failed to load databases:", error);
      return [];
    }
  }

  async getDatabase(id: string): Promise<ConnectionDatabase | null> {
    const collections = await this.getAllDatabases();
    return collections.find((c) => c.id === id) || null;
  }

  async selectDatabase(id: string, password?: string): Promise<void> {
    const collection = await this.getDatabase(id);
    if (!collection) {
      throw new DatabaseNotFoundError();
    }

    const resolvedPassword = collection.isEncrypted
      ? password || this.getUnlockedPasswordForDatabase(collection.id)
      : undefined;

    if (collection.isEncrypted && !resolvedPassword) {
      throw new InvalidPasswordError(
        "Password required for encrypted collection",
      );
    }

    await this.loadDatabaseData(id, resolvedPassword);
    this.currentDatabase = collection;
    this.currentPassword = resolvedPassword || null;
    this.rememberUnlockedDatabase(collection, resolvedPassword);

    // Update last accessed time
    collection.lastAccessed = new Date().toISOString();
    await this.updateDatabase(collection);
    
    // Log collection selection/opening
    SettingsManager.getInstance().logAction(
      'info',
      'Database opened',
      undefined,
      `Switched to database "${collection.name}"`
    );
  }

  getCurrentDatabase(): ConnectionDatabase | null {
    return this.currentDatabase;
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
    const collection = await this.getDatabase(id);
    if (!collection) {
      throw new DatabaseNotFoundError();
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
    await this.loadDatabaseData(id, password);
    this.rememberUnlockedDatabase(collection, password);
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
  closeCurrentDatabase(): string | null {
    const closing = this.currentDatabase;
    if (!closing) return null;
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
  lockDatabase(id: string): void {
    if (this.currentDatabase?.id === id) {
      this.closeCurrentDatabase();
      return;
    }
    if (!this.unlockedDatabasePasswords.has(id)) return;
    this.forgetUnlockedDatabase(id);
    SettingsManager.getInstance().logAction(
      "info",
      "Database locked",
      undefined,
      `Locked database ${id}`,
    );
  }

  isDatabaseUnlocked(databaseId: string): boolean {
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
    if (this.currentDatabase && this.isDatabaseUnlocked(this.currentDatabase.id)) {
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
        ? Boolean(this.getUnlockedPasswordForDatabase(collection.id))
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

  private rememberUnlockedDatabase(
    collection: ConnectionDatabase | null,
    password?: string,
  ): void {
    if (collection?.isEncrypted && password) {
      this.unlockedDatabasePasswords.set(collection.id, password);
    }
  }

  private forgetUnlockedDatabase(databaseId: string): void {
    this.unlockedDatabasePasswords.delete(databaseId);
  }

  private getUnlockedPasswordForDatabase(databaseId: string): string | undefined {
    if (this.currentDatabase?.id === databaseId && this.currentPassword) {
      return this.currentPassword;
    }

    return this.unlockedDatabasePasswords.get(databaseId);
  }

  private resolveExportPasswordForDatabase(
    collection: ConnectionDatabase,
    providedPassword?: string,
  ): string | undefined {
    if (!collection.isEncrypted) {
      return undefined;
    }

    const password = providedPassword || this.getUnlockedPasswordForDatabase(collection.id);
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
  ): DatabaseExportSnapshot {
    return {
      collection: {
        id: collection.id,
        name: collection.name,
        description: collection.description,
        isEncrypted: collection.isEncrypted,
        exportDate: new Date().toISOString(),
      },
      connections: includePasswords
        ? data.connections
        : data.connections.map(redactConnectionSecrets),
      settings: data.settings ?? {},
      tabGroups: data.tabGroups ?? [],
      colorTags: data.colorTags ?? {},
    };
  }

  async updateDatabase(collection: ConnectionDatabase): Promise<void> {
    const collections = await this.getAllDatabases();
    const index = collections.findIndex((c) => c.id === collection.id);
    if (index >= 0) {
      collections[index] = { ...collection, updatedAt: new Date().toISOString() };
      await this.saveDatabases(collections);
      if (this.currentDatabase?.id === collection.id) {
        this.currentDatabase = { ...collections[index] };
      }
    }
  }

  async deleteDatabase(id: string): Promise<void> {
    const collection = await this.getDatabase(id);
    const collections = await this.getAllDatabases();
    const filteredCollections = collections.filter((c) => c.id !== id);
    await this.saveDatabases(filteredCollections);

    // Remove collection data. The Tauri command unlinks both the
    // canonical file and its `.bak`; the IDB branch is the
    // browser-fallback we drop in P5.
    const invoke = await getInvoke();
    if (invoke) {
      await invoke("delete_database_data", { databaseId: id });
    } else {
      await IndexedDbService.removeItem(`mremote-database-${id}`);
      await IndexedDbService.removeItem(`mremote-collection-${id}`);
    }

    // Log collection deletion
    SettingsManager.getInstance().logAction(
      'info',
      'Database deleted',
      undefined,
      `Database "${collection?.name || id}" deleted`
    );

    if (this.currentDatabase?.id === id) {
      this.currentDatabase = null;
      this.currentPassword = null;
    }
    this.forgetUnlockedDatabase(id);
  }

  async duplicateDatabase(
    collectionId: string,
    options?: {
      password?: string;
      name?: string;
    },
  ): Promise<ConnectionDatabase> {
    const sourceCollection = await this.getDatabase(collectionId);
    if (!sourceCollection) {
      throw new DatabaseNotFoundError();
    }

    const duplicatePassword = sourceCollection.isEncrypted
      ? options?.password ??
        this.getUnlockedPasswordForDatabase(collectionId)
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
    const sourceIndex = collections.findIndex(
      (collection) => collection.id === collectionId,
    );
    if (sourceIndex < 0) {
      throw new DatabaseNotFoundError();
    }

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
    await this.saveDatabases(nextCollections);
    await this.saveDatabaseData(
      duplicatedCollection.id,
      cloneStorageData(sourceData),
      sourceCollection.isEncrypted ? duplicatePassword : undefined,
    );

    SettingsManager.getInstance().logAction(
      "info",
      "Database cloned",
      undefined,
      `Database "${sourceCollection.name}" cloned to "${duplicatedCollection.name}"`,
    );

    return duplicatedCollection;
  }

  private async saveDatabases(
    collections: ConnectionDatabase[],
  ): Promise<void> {
    const invoke = await getInvoke();
    if (invoke) {
      // Primary path: persist the index via the P1 safe writer.
      await invoke("databases_save_index", { list: collections });
      return;
    }
    // Browser / pre-Tauri fallback (P5 will retire this branch).
    await IndexedDbService.setItem(this.databasesKey, collections);
  }

  // Collection data management
  async saveDatabaseData(
    collectionId: string,
    data: StorageData,
    password?: string,
  ): Promise<void> {
    // Encrypt up front when a password is set — the IPC layer (and
    // the IndexedDB fallback below) are bytes-in / bytes-out and
    // know nothing about per-DB passwords. The payload becomes
    // a WebCrypto envelope string instead of the raw object.
    const payload: unknown = password
      ? await encryptExportWithPassword(JSON.stringify(data), password)
      : data;

    const invoke = await getInvoke();
    if (invoke) {
      // Primary path: persist via the P1 safe writer.
      await invoke("save_database_data", {
        databaseId: collectionId,
        data: payload,
      });
      return;
    }

    // ── Browser / pre-Tauri fallback (P5 will retire this branch). ──
    const key = `mremote-database-${collectionId}`;
    const legacyKey = `mremote-collection-${collectionId}`;
    await IndexedDbService.setItem(key, payload);
    try {
      await IndexedDbService.removeItem(legacyKey);
    } catch {
      // best-effort
    }
  }

  async loadDatabaseData(
    collectionId: string,
    password?: string,
  ): Promise<StorageData | null> {
    const key = `mremote-database-${collectionId}`;
    const legacyKey = `mremote-collection-${collectionId}`;
    const collection = await this.getDatabase(collectionId);
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
      stored = await IndexedDbService.getItem<any>(key);

      if (!stored) {
        // One-shot migration: read from the old key and rewrite to the
        // new one so subsequent loads avoid the fallback path.
        stored = await IndexedDbService.getItem<any>(legacyKey);
        if (stored) {
          try {
            await IndexedDbService.setItem(key, stored);
            await IndexedDbService.removeItem(legacyKey);
          } catch {
            // best-effort; falling through to use `stored` as-is
          }
        }
      }
    }

    if (!stored) {
      throw new DatabaseNotFoundError();
    }

    try {
      if (password) {
        let decrypted: string | null = null;

        // Try export WebCrypto envelopes first, then legacy salt.iv.ciphertext.
        if (typeof stored === 'string' && isWebCryptoPayload(stored)) {
          try {
            decrypted = await decryptExportWithPassword(stored, password);
          } catch {
            // Not new format or wrong password — fall through to legacy
          }
        }

        if (!decrypted && typeof stored === 'string' && stored.split('.').length === 3) {
          try {
            decrypted = await decryptData(stored, password);
          } catch {
            // Not legacy WebCrypto format or wrong password — fall through
          }
        }

        // Fallback: try legacy CryptoJS decryption for backward compatibility
        if (!decrypted && typeof stored === 'string') {
          decrypted = await legacyDecrypt(stored, password);
        }

        if (!decrypted) {
          throw new InvalidPasswordError();
        }
        try {
          const parsed = JSON.parse(decrypted) as StorageData;
          this.rememberUnlockedDatabase(collection, password);
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
    await this.saveDatabaseData(
      this.currentDatabase.id,
      data,
      this.currentPassword || undefined,
    );
  }

  async loadCurrentDatabaseData(): Promise<StorageData | null> {
    if (!this.currentDatabase) {
      throw new Error("No collection selected");
    }
    return this.loadDatabaseData(
      this.currentDatabase.id,
      this.currentPassword || undefined,
    );
  }

  // Export collection with encryption
  async exportDatabase(
    collectionId: string,
    includePasswords: boolean = false,
    exportPassword?: string,
    collectionPassword?: string,
    exportEncryptionOptions?: PasswordEncryptionOptions,
  ): Promise<string> {
    const exportData = await this.readExportableDatabaseSnapshot(
      collectionId,
      includePasswords,
      { collectionPassword },
    );

    const jsonData = JSON.stringify(exportData, null, 2);

    if (exportPassword) {
      return encryptExportWithPassword(
        jsonData,
        exportPassword,
        exportEncryptionOptions,
      );
    }

    return jsonData;
  }

  async readExportableDatabaseSnapshot(
    collectionId: string,
    includePasswords: boolean = false,
    options?: {
      collectionPassword?: string;
    },
  ): Promise<DatabaseExportSnapshot> {
    const collection = await this.getDatabase(collectionId);
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

    this.rememberUnlockedDatabase(collection, password);
    return this.buildExportSnapshot(collection, data, includePasswords);
  }

  async appendConnectionsToDatabase(
    collectionId: string,
    connections: Connection[],
  ): Promise<void> {
    const collection = await this.getDatabase(collectionId);
    if (!collection) {
      throw new DatabaseNotFoundError();
    }

    const password = this.resolveExportPasswordForDatabase(collection);
    const data = await this.loadDatabaseData(collectionId, password);
    if (!data) {
      throw new DatabaseNotFoundError();
    }

    await this.saveDatabaseData(
      collectionId,
      {
        ...data,
        connections: [...(data.connections ?? []), ...connections],
        settings: data.settings ?? {},
        timestamp: Date.now(),
        tabGroups: data.tabGroups ?? [],
        colorTags: data.colorTags ?? {},
      },
      password,
    );

    this.rememberUnlockedDatabase(collection, password);
  }

  async removePasswordFromDatabase(
    collectionId: string,
    password: string,
  ): Promise<void> {
    const collection = await this.getDatabase(collectionId);
    if (!collection) throw new Error("Collection not found");

    const data = await this.loadDatabaseData(collectionId, password);
    if (data === null) throw new Error("Invalid password");

    await this.saveDatabaseData(collectionId, data);
    collection.isEncrypted = false;
    await this.updateDatabase(collection);

    if (this.currentDatabase?.id === collectionId) {
      this.currentPassword = null;
      this.currentDatabase = { ...collection };
    }
    this.forgetUnlockedDatabase(collectionId);
  }

  async changeDatabasePassword(
    collectionId: string,
    currentPassword: string | undefined,
    newPassword: string,
  ): Promise<void> {
    const collection = await this.getDatabase(collectionId);
    if (!collection) throw new Error("Collection not found");

    const data = collection.isEncrypted
      ? await this.loadDatabaseData(collectionId, currentPassword)
      : await this.loadDatabaseData(collectionId);

    if (data === null) {
      throw new Error("Invalid password");
    }

    await this.saveDatabaseData(collectionId, data, newPassword);
    collection.isEncrypted = true;
    await this.updateDatabase(collection);

    if (this.currentDatabase?.id === collectionId) {
      this.currentPassword = newPassword;
      this.currentDatabase = { ...collection };
    }
    this.rememberUnlockedDatabase(collection, newPassword);
  }

  async importDatabase(
    content: string,
    options?: {
      importPassword?: string;
      collectionName?: string;
      encryptPassword?: string;
    },
  ): Promise<ConnectionDatabase> {
    let parsed: any;
    try {
      if (isWebCryptoPayload(content)) {
        if (!options?.importPassword) {
          throw new InvalidPasswordError("Password required for encrypted export");
        }
        parsed = JSON.parse(
          await decryptExportWithPassword(content, options.importPassword),
        );
      } else {
        parsed = JSON.parse(content);
      }
    } catch (error) {
      if (error instanceof InvalidPasswordError) {
        throw error;
      }
      if (!options?.importPassword) {
        throw new InvalidPasswordError("Password required for encrypted export");
      }

      let decrypted: string | null = null;

      // Try new Web Crypto format first
      if (isWebCryptoPayload(content)) {
        try {
          decrypted = await decryptExportWithPassword(content, options.importPassword);
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

    const collectionName = options?.collectionName || parsed?.collection?.name;
    if (!collectionName) {
      throw new Error("Collection name missing in import");
    }

    const connections = (parsed?.connections ?? []).map((conn: any) => ({
      ...conn,
      password: conn.password === "***ENCRYPTED***" ? undefined : conn.password,
      basicAuthPassword:
        conn.basicAuthPassword === "***ENCRYPTED***"
          ? undefined
          : conn.basicAuthPassword,
    }));

    const collection = await this.createDatabase(
      collectionName,
      parsed?.collection?.description,
      Boolean(options?.encryptPassword),
      options?.encryptPassword,
    );

    await this.saveDatabaseData(
      collection.id,
      {
        connections,
        settings: parsed?.settings ?? {},
        timestamp: Date.now(),
        tabGroups: Array.isArray(parsed?.tabGroups) ? parsed.tabGroups : [],
        colorTags:
          parsed?.colorTags && typeof parsed.colorTags === "object"
            ? parsed.colorTags
            : {},
      },
      options?.encryptPassword,
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
