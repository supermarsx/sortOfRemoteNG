import CryptoJS from 'crypto-js';
import { ConnectionCollection } from '../types/connection';
import { StorageData } from './storage';

export class CollectionManager {
  private static instance: CollectionManager;
  private readonly collectionsKey = 'mremote-collections';
  private currentCollection: ConnectionCollection | null = null;
  private currentPassword: string | null = null;

  static getInstance(): CollectionManager {
    if (!CollectionManager.instance) {
      CollectionManager.instance = new CollectionManager();
    }
    return CollectionManager.instance;
  }

  async createCollection(
    name: string,
    description?: string,
    isEncrypted: boolean = false,
    password?: string
  ): Promise<ConnectionCollection> {
    const collection: ConnectionCollection = {
      id: crypto.randomUUID(),
      name,
      description,
      isEncrypted,
      createdAt: new Date(),
      updatedAt: new Date(),
      lastAccessed: new Date(),
    };

    const collections = this.getAllCollections();
    collections.push(collection);
    this.saveCollections(collections);

    // Initialize empty data for the collection
    if (isEncrypted && password) {
      await this.saveCollectionData(collection.id, { connections: [], settings: {}, timestamp: Date.now() }, password);
    } else {
      await this.saveCollectionData(collection.id, { connections: [], settings: {}, timestamp: Date.now() });
    }

    return collection;
  }

  getAllCollections(): ConnectionCollection[] {
    try {
      const stored = localStorage.getItem(this.collectionsKey);
      if (stored) {
        const collections = JSON.parse(stored);
        return collections.map((c: any) => ({
          ...c,
          createdAt: new Date(c.createdAt),
          updatedAt: new Date(c.updatedAt),
          lastAccessed: new Date(c.lastAccessed),
        }));
      }
      return [];
    } catch (error) {
      console.error('Failed to load collections:', error);
      return [];
    }
  }

  getCollection(id: string): ConnectionCollection | null {
    const collections = this.getAllCollections();
    return collections.find(c => c.id === id) || null;
  }

  async selectCollection(id: string, password?: string): Promise<void> {
    const collection = this.getCollection(id);
    if (!collection) {
      throw new Error('Collection not found');
    }

    if (collection.isEncrypted && !password) {
      throw new Error('Password required for encrypted collection');
    }

    // Test access to the collection data
    try {
      await this.loadCollectionData(id, password);
      this.currentCollection = collection;
      this.currentPassword = password || null;
      
      // Update last accessed time
      collection.lastAccessed = new Date();
      this.updateCollection(collection);
    } catch (error) {
      throw new Error('Invalid password or corrupted collection data');
    }
  }

  getCurrentCollection(): ConnectionCollection | null {
    return this.currentCollection;
  }

  updateCollection(collection: ConnectionCollection): void {
    const collections = this.getAllCollections();
    const index = collections.findIndex(c => c.id === collection.id);
    if (index >= 0) {
      collections[index] = { ...collection, updatedAt: new Date() };
      this.saveCollections(collections);
      if (this.currentCollection?.id === collection.id) {
        this.currentCollection = { ...collections[index] };
      }
    }
  }

  async deleteCollection(id: string): Promise<void> {
    const collections = this.getAllCollections();
    const filteredCollections = collections.filter(c => c.id !== id);
    this.saveCollections(filteredCollections);

    // Remove collection data
    localStorage.removeItem(`mremote-collection-${id}`);

    if (this.currentCollection?.id === id) {
      this.currentCollection = null;
      this.currentPassword = null;
    }
  }

  private saveCollections(collections: ConnectionCollection[]): void {
    localStorage.setItem(this.collectionsKey, JSON.stringify(collections));
  }

  // Collection data management
  async saveCollectionData(collectionId: string, data: StorageData, password?: string): Promise<void> {
    const key = `mremote-collection-${collectionId}`;
    const dataToStore = JSON.stringify(data);

    if (password) {
      const encrypted = CryptoJS.AES.encrypt(dataToStore, password).toString();
      localStorage.setItem(key, encrypted);
    } else {
      localStorage.setItem(key, dataToStore);
    }
  }

  async loadCollectionData(collectionId: string, password?: string): Promise<StorageData | null> {
    const key = `mremote-collection-${collectionId}`;
    const stored = localStorage.getItem(key);

    if (!stored) return null;

    try {
      if (password) {
        const decrypted = CryptoJS.AES.decrypt(stored, password).toString(CryptoJS.enc.Utf8);
        if (!decrypted) {
          throw new Error('Invalid password');
        }
        return JSON.parse(decrypted);
      } else {
        return JSON.parse(stored);
      }
    } catch (error) {
      throw new Error('Failed to load collection data or invalid password');
    }
  }

  // Current collection data access
  async saveCurrentCollectionData(data: StorageData): Promise<void> {
    if (!this.currentCollection) {
      throw new Error('No collection selected');
    }
    await this.saveCollectionData(this.currentCollection.id, data, this.currentPassword || undefined);
  }

  async loadCurrentCollectionData(): Promise<StorageData | null> {
    if (!this.currentCollection) {
      throw new Error('No collection selected');
    }
    return this.loadCollectionData(this.currentCollection.id, this.currentPassword || undefined);
  }

  // Export collection with encryption
  async exportCollection(collectionId: string, includePasswords: boolean = false, exportPassword?: string): Promise<string> {
    const collection = this.getCollection(collectionId);
    if (!collection) {
      throw new Error('Collection not found');
    }

    const data = await this.loadCollectionData(collectionId, this.currentPassword || undefined);
    if (!data) {
      throw new Error('Failed to load collection data');
    }

    const exportData = {
      collection: {
        name: collection.name,
        description: collection.description,
        exportDate: new Date().toISOString(),
      },
      connections: includePasswords ? data.connections : data.connections.map((conn: any) => ({
        ...conn,
        password: conn.password ? '***ENCRYPTED***' : undefined,
        basicAuthPassword: conn.basicAuthPassword ? '***ENCRYPTED***' : undefined,
      })),
      settings: data.settings,
    };

    const jsonData = JSON.stringify(exportData, null, 2);

    if (exportPassword) {
      return CryptoJS.AES.encrypt(jsonData, exportPassword).toString();
    }

    return jsonData;
  }

  // Generate export filename
  generateExportFilename(): string {
    const now = new Date();
    const datetime = now.toISOString().replace(/[:.]/g, '-').slice(0, -5);
    const randomHex = Math.random().toString(16).substring(2, 8);
    return `sortofremoteng-exports-${datetime}-${randomHex}.json`;
  }
}