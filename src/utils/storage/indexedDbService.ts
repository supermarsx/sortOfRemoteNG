import { openDB, DBSchema, IDBPDatabase } from 'idb';

interface KeyValDB extends DBSchema {
  keyval: {
    key: string;
    value: string;
  };
}

const DB_NAME = 'mremote-keyval';
const STORE_NAME = 'keyval';

export class IndexedDbService {
  private static dbPromise: Promise<IDBPDatabase<KeyValDB>> | null = null;

  private static getDB(): Promise<IDBPDatabase<KeyValDB>> {
    if (!this.dbPromise) {
      this.dbPromise = openDB<KeyValDB>(DB_NAME, 1, {
        upgrade(db) {
          if (!db.objectStoreNames.contains(STORE_NAME)) {
            db.createObjectStore(STORE_NAME);
          }
        }
      });
    }
    return this.dbPromise;
  }

  static async init(): Promise<void> {
    await this.getDB();
    await this.migrateFromLocalStorage();
  }

  private static async migrateFromLocalStorage(): Promise<void> {
    if (typeof localStorage === 'undefined') return;

    const keys: string[] = [];
    for (let i = 0; i < localStorage.length; i++) {
      const key = localStorage.key(i);
      if (key && key.startsWith('mremote-')) {
        keys.push(key);
      }
    }

    for (const key of keys) {
      try {
        const existing = await this.getItem(key);
        if (existing !== null) {
          localStorage.removeItem(key);
          continue;
        }
        const raw = localStorage.getItem(key);
        if (raw === null) continue;
        const value = JSON.parse(raw);
        await this.setItem(key, value);
        localStorage.removeItem(key);
      } catch (error) {
        console.error(`Failed to migrate localStorage key "${key}":`, error);
      }
    }
  }

  static async getItem<T>(key: string): Promise<T | null> {
    try {
      const db = await this.getDB();
      const raw = await db.get(STORE_NAME, key);
      return raw ? (JSON.parse(raw) as T) : null;
    } catch (error) {
      console.error(`Failed to parse IndexedDB key "${key}":`, error);
      return null;
    }
  }

  static async setItem<T>(key: string, value: T): Promise<void> {
    try {
      const db = await this.getDB();
      const serialized = JSON.stringify(value);
      await db.put(STORE_NAME, serialized, key);
    } catch (error) {
      console.error(`Failed to set IndexedDB key "${key}":`, error);
    }
  }

  static async removeItem(key: string): Promise<void> {
    try {
      const db = await this.getDB();
      await db.delete(STORE_NAME, key);
    } catch (error) {
      console.error(`Failed to remove IndexedDB key "${key}":`, error);
    }
  }
}
