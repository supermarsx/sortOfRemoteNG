import CryptoJS from "crypto-js";
import { ConnectionCollection } from "../types/connection";
import { StorageData } from "./storage";
import { IndexedDbService } from "./indexedDbService";
import { generateId } from "./id";
import {
  CollectionNotFoundError,
  CorruptedDataError,
  InvalidPasswordError,
} from "./errors";

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
      createdAt: new Date(),
      updatedAt: new Date(),
      lastAccessed: new Date(),
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
          createdAt: new Date(c.createdAt),
          updatedAt: new Date(c.updatedAt),
          lastAccessed: new Date(c.lastAccessed),
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
    collection.lastAccessed = new Date();
    await this.updateCollection(collection);
  }

  getCurrentCollection(): ConnectionCollection | null {
    return this.currentCollection;
  }

  async updateCollection(collection: ConnectionCollection): Promise<void> {
    const collections = await this.getAllCollections();
    const index = collections.findIndex((c) => c.id === collection.id);
    if (index >= 0) {
      collections[index] = { ...collection, updatedAt: new Date() };
      await this.saveCollections(collections);
      if (this.currentCollection?.id === collection.id) {
        this.currentCollection = { ...collections[index] };
      }
    }
  }

  async deleteCollection(id: string): Promise<void> {
    const collections = await this.getAllCollections();
    const filteredCollections = collections.filter((c) => c.id !== id);
    await this.saveCollections(filteredCollections);

    // Remove collection data
    await IndexedDbService.removeItem(`mremote-collection-${id}`);

    if (this.currentCollection?.id === id) {
      this.currentCollection = null;
      this.currentPassword = null;
    }
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

    if (password) {
      const encrypted = CryptoJS.AES.encrypt(
        JSON.stringify(data),
        password,
      ).toString();
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
    const stored = await IndexedDbService.getItem<any>(key);

    if (!stored) {
      throw new CollectionNotFoundError();
    }

    try {
      if (password) {
        const decrypted = CryptoJS.AES.decrypt(stored, password).toString(
          CryptoJS.enc.Utf8,
        );
        if (!decrypted) {
          throw new InvalidPasswordError();
        }
        return JSON.parse(decrypted);
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
  ): Promise<string> {
    const collection = await this.getCollection(collectionId);
    if (!collection) {
      throw new Error("Collection not found");
    }

    const data = await this.loadCollectionData(
      collectionId,
      this.currentPassword || undefined,
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
      return CryptoJS.AES.encrypt(jsonData, exportPassword).toString();
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

  // Generate export filename
  generateExportFilename(): string {
    const now = new Date();
    const datetime = now.toISOString().replace(/[:.]/g, "-").slice(0, -5);
    const randomHex = Math.random().toString(16).substring(2, 8);
    return `sortofremoteng-exports-${datetime}-${randomHex}.json`;
  }
}
