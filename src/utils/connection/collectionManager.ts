import { ConnectionCollection } from "../../types/connection/connection";
import { StorageData } from "../storage/storage";
import { IndexedDbService } from "../storage/indexedDbService";
import { generateId } from "../core/id";
import {
  CollectionNotFoundError,
  CorruptedDataError,
  InvalidPasswordError,
} from "../core/errors";
import { SettingsManager } from "../settings/settingsManager";
import { PBKDF2_ITERATIONS } from "../../config";

const invoke = (globalThis as any).__TAURI__?.core?.invoke;

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

async function encryptData(plaintext: string, password: string): Promise<string> {
  const crypto = getCrypto();
  const salt = crypto.getRandomValues(new Uint8Array(16));
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const key = await deriveKey(password, salt);
  const enc = new TextEncoder();
  const ciphertext = await crypto.subtle.encrypt(
    { name: "AES-GCM", iv: asBufferSource(iv) },
    key,
    asBufferSource(enc.encode(plaintext)),
  );
  // Format: base64(salt) + "." + base64(iv) + "." + base64(ciphertext)
  return `${toBase64(salt)}.${toBase64(iv)}.${toBase64(ciphertext)}`;
}

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

function buildDuplicateCollectionName(
  sourceName: string,
  collections: ConnectionCollection[],
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

/**
 * Handles persistence and encryption of connection collections.
 *
 * Collections metadata lives in IndexedDB under a single key while individual
 * collection contents are stored separately. The manager caches the currently
 * selected collection to minimise lookups and supports optional AES encryption
 * for stored data.
 */
export class CollectionManager {
  private static instance: CollectionManager;
  private readonly collectionsKey = "mremote-collections";
  private currentCollection: ConnectionCollection | null = null;
  private currentPassword: string | null = null;

  static getInstance(): CollectionManager {
    if (!CollectionManager.instance) {
      CollectionManager.instance = new CollectionManager();
    }
    return CollectionManager.instance;
  }

  static resetInstance(): void {
    (CollectionManager as any).instance = undefined;
  }

  /**
   * Create and persist a new empty collection.
   *
   * A unique ID is generated and the collection metadata is appended to the
   * list stored in IndexedDB. If `isEncrypted` is true, initial data is saved
   * using AES with the provided password. The method returns the created
   * collection descriptor.
   */
  async createCollection(
    name: string,
    description?: string,
    isEncrypted: boolean = false,
    password?: string,
  ): Promise<ConnectionCollection> {
    const collection: ConnectionCollection = {
      id: generateId(),
      name,
      description,
      isEncrypted,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
      lastAccessed: new Date().toISOString(),
    };

    const collections = await this.getAllCollections();
    collections.push(collection);
    await this.saveCollections(collections);

    // Assumes collection count is modest; appending and rewriting the entire
    // array could be expensive if thousands of collections were stored.
    // Initialize empty data for the collection
    if (isEncrypted && password) {
      await this.saveCollectionData(
        collection.id,
        { connections: [], settings: {}, timestamp: Date.now() },
        password,
      );
    } else {
      await this.saveCollectionData(collection.id, {
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

  async getAllCollections(): Promise<ConnectionCollection[]> {
    try {
      const collections = await IndexedDbService.getItem<
        ConnectionCollection[]
      >(this.collectionsKey);
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
      console.error("Failed to load collections:", error);
      return [];
    }
  }

  async getCollection(id: string): Promise<ConnectionCollection | null> {
    const collections = await this.getAllCollections();
    return collections.find((c) => c.id === id) || null;
  }

  async selectCollection(id: string, password?: string): Promise<void> {
    const collection = await this.getCollection(id);
    if (!collection) {
      throw new CollectionNotFoundError();
    }

    if (collection.isEncrypted && !password) {
      throw new InvalidPasswordError(
        "Password required for encrypted collection",
      );
    }

    await this.loadCollectionData(id, password);
    this.currentCollection = collection;
    this.currentPassword = password || null;

    // Update last accessed time
    collection.lastAccessed = new Date().toISOString();
    await this.updateCollection(collection);
    
    // Log collection selection/opening
    SettingsManager.getInstance().logAction(
      'info',
      'Database opened',
      undefined,
      `Switched to database "${collection.name}"`
    );
  }

  getCurrentCollection(): ConnectionCollection | null {
    return this.currentCollection;
  }

  async updateCollection(collection: ConnectionCollection): Promise<void> {
    const collections = await this.getAllCollections();
    const index = collections.findIndex((c) => c.id === collection.id);
    if (index >= 0) {
      collections[index] = { ...collection, updatedAt: new Date().toISOString() };
      await this.saveCollections(collections);
      if (this.currentCollection?.id === collection.id) {
        this.currentCollection = { ...collections[index] };
      }
    }
  }

  async deleteCollection(id: string): Promise<void> {
    const collection = await this.getCollection(id);
    const collections = await this.getAllCollections();
    const filteredCollections = collections.filter((c) => c.id !== id);
    await this.saveCollections(filteredCollections);

    // Remove collection data
    await IndexedDbService.removeItem(`mremote-collection-${id}`);

    // Log collection deletion
    SettingsManager.getInstance().logAction(
      'info',
      'Database deleted',
      undefined,
      `Database "${collection?.name || id}" deleted`
    );

    if (this.currentCollection?.id === id) {
      this.currentCollection = null;
      this.currentPassword = null;
    }
  }

  async duplicateCollection(
    collectionId: string,
    options?: {
      password?: string;
      name?: string;
    },
  ): Promise<ConnectionCollection> {
    const sourceCollection = await this.getCollection(collectionId);
    if (!sourceCollection) {
      throw new CollectionNotFoundError();
    }

    const duplicatePassword = sourceCollection.isEncrypted
      ? options?.password ??
        (this.currentCollection?.id === collectionId
          ? this.currentPassword || undefined
          : undefined)
      : undefined;

    if (sourceCollection.isEncrypted && !duplicatePassword) {
      throw new InvalidPasswordError(
        "Password required for encrypted collection",
      );
    }

    const sourceData = await this.loadCollectionData(
      collectionId,
      duplicatePassword,
    );
    if (!sourceData) {
      throw new CollectionNotFoundError();
    }

    const collections = await this.getAllCollections();
    const sourceIndex = collections.findIndex(
      (collection) => collection.id === collectionId,
    );
    if (sourceIndex < 0) {
      throw new CollectionNotFoundError();
    }

    const now = new Date().toISOString();
    const duplicatedCollection: ConnectionCollection = {
      id: generateId(),
      name: buildDuplicateCollectionName(
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
    await this.saveCollections(nextCollections);
    await this.saveCollectionData(
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

  private async saveCollections(
    collections: ConnectionCollection[],
  ): Promise<void> {
    await IndexedDbService.setItem(this.collectionsKey, collections);
  }

  // Collection data management
  async saveCollectionData(
    collectionId: string,
    data: StorageData,
    password?: string,
  ): Promise<void> {
    const key = `mremote-collection-${collectionId}`;

    if (invoke) {
      try {
        await invoke("save_collection_data", { collectionId, data, password });
        return;
      } catch (error) {
        console.error("Failed to save collection via IPC:", error);
      }
    }

    if (password) {
      const encrypted = await encryptData(JSON.stringify(data), password);
      await IndexedDbService.setItem(key, encrypted);
    } else {
      await IndexedDbService.setItem(key, data);
    }
  }

  async loadCollectionData(
    collectionId: string,
    password?: string,
  ): Promise<StorageData | null> {
    const key = `mremote-collection-${collectionId}`;
    let stored: any = null;

    if (invoke) {
      try {
        stored = await invoke("load_collection_data", { collectionId });
      } catch (error) {
        console.error("Failed to load collection via IPC:", error);
      }
    }

    if (!stored) {
      stored = await IndexedDbService.getItem<any>(key);
    }

    if (!stored) {
      throw new CollectionNotFoundError();
    }

    try {
      if (password) {
        let decrypted: string | null = null;

        // Try new Web Crypto format first (salt.iv.ciphertext)
        if (typeof stored === 'string' && stored.split('.').length === 3) {
          try {
            decrypted = await decryptData(stored, password);
          } catch {
            // Not new format or wrong password — fall through to legacy
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
          return JSON.parse(decrypted);
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
  async saveCurrentCollectionData(data: StorageData): Promise<void> {
    if (!this.currentCollection) {
      throw new Error("No collection selected");
    }
    await this.saveCollectionData(
      this.currentCollection.id,
      data,
      this.currentPassword || undefined,
    );
  }

  async loadCurrentCollectionData(): Promise<StorageData | null> {
    if (!this.currentCollection) {
      throw new Error("No collection selected");
    }
    return this.loadCollectionData(
      this.currentCollection.id,
      this.currentPassword || undefined,
    );
  }

  // Export collection with encryption
  async exportCollection(
    collectionId: string,
    includePasswords: boolean = false,
    exportPassword?: string,
    collectionPassword?: string,
  ): Promise<string> {
    const collection = await this.getCollection(collectionId);
    if (!collection) {
      throw new Error("Collection not found");
    }

    const data = await this.loadCollectionData(
      collectionId,
      collectionPassword || this.currentPassword || undefined,
    );
    if (!data) {
      throw new Error("Failed to load collection data");
    }

    const exportData = {
      collection: {
        name: collection.name,
        description: collection.description,
        exportDate: new Date().toISOString(),
      },
      connections: includePasswords
        ? data.connections
        : data.connections.map((conn: any) => ({
            ...conn,
            password: conn.password ? "***ENCRYPTED***" : undefined,
            basicAuthPassword: conn.basicAuthPassword
              ? "***ENCRYPTED***"
              : undefined,
          })),
      settings: data.settings,
    };

    const jsonData = JSON.stringify(exportData, null, 2);

    if (exportPassword) {
      return encryptData(jsonData, exportPassword);
    }

    return jsonData;
  }

  async removePasswordFromCollection(
    collectionId: string,
    password: string,
  ): Promise<void> {
    const collection = await this.getCollection(collectionId);
    if (!collection) throw new Error("Collection not found");

    const data = await this.loadCollectionData(collectionId, password);
    if (data === null) throw new Error("Invalid password");

    await this.saveCollectionData(collectionId, data);
    collection.isEncrypted = false;
    await this.updateCollection(collection);

    if (this.currentCollection?.id === collectionId) {
      this.currentPassword = null;
      this.currentCollection = { ...collection };
    }
  }

  async changeCollectionPassword(
    collectionId: string,
    currentPassword: string | undefined,
    newPassword: string,
  ): Promise<void> {
    const collection = await this.getCollection(collectionId);
    if (!collection) throw new Error("Collection not found");

    const data = collection.isEncrypted
      ? await this.loadCollectionData(collectionId, currentPassword)
      : await this.loadCollectionData(collectionId);

    if (data === null) {
      throw new Error("Invalid password");
    }

    await this.saveCollectionData(collectionId, data, newPassword);
    collection.isEncrypted = true;
    await this.updateCollection(collection);

    if (this.currentCollection?.id === collectionId) {
      this.currentPassword = newPassword;
      this.currentCollection = { ...collection };
    }
  }

  async importCollection(
    content: string,
    options?: {
      importPassword?: string;
      collectionName?: string;
      encryptPassword?: string;
    },
  ): Promise<ConnectionCollection> {
    let parsed: any;
    try {
      parsed = JSON.parse(content);
    } catch (error) {
      if (!options?.importPassword) {
        throw new InvalidPasswordError("Password required for encrypted export");
      }

      let decrypted: string | null = null;

      // Try new Web Crypto format first
      if (content.split('.').length === 3) {
        try {
          decrypted = await decryptData(content, options.importPassword);
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

    const collection = await this.createCollection(
      collectionName,
      parsed?.collection?.description,
      Boolean(options?.encryptPassword),
      options?.encryptPassword,
    );

    await this.saveCollectionData(
      collection.id,
      {
        connections,
        settings: parsed?.settings ?? {},
        timestamp: Date.now(),
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
