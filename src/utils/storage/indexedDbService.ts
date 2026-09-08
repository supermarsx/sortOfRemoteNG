import { openDB, unwrap, DBSchema, IDBPDatabase } from "idb";

interface KeyValDB extends DBSchema {
  keyval: {
    key: string;
    value: string;
  };
}

const DB_NAME = "mremote-keyval";
const STORE_NAME = "keyval";

export class IndexedDbService {
  private static dbPromise: Promise<IDBPDatabase<KeyValDB>> | null = null;

  private static getDB(): Promise<IDBPDatabase<KeyValDB>> {
    if (!this.dbPromise) {
      this.dbPromise = openDB<KeyValDB>(DB_NAME, 1, {
        upgrade(db) {
          if (!db.objectStoreNames.contains(STORE_NAME)) {
            db.createObjectStore(STORE_NAME);
          }
        },
      });
    }
    return this.dbPromise;
  }

  static async init(): Promise<void> {
    await this.getDB();
    await this.migrateFromLocalStorage();
  }

  private static async migrateFromLocalStorage(): Promise<void> {
    if (typeof localStorage === "undefined") return;

    const keys: string[] = [];
    for (let i = 0; i < localStorage.length; i++) {
      const key = localStorage.key(i);
      if (key && key.startsWith("mremote-")) {
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
      return await this.getItemStrict<T>(key);
    } catch (error) {
      console.error(`Failed to parse IndexedDB key "${key}":`, error);
      return null;
    }
  }

  static async getItemStrict<T>(key: string): Promise<T | null> {
    const db = await this.getDB();
    const raw = await db.get(STORE_NAME, key);
    return raw === undefined ? null : (JSON.parse(raw) as T);
  }

  static async setItem<T>(key: string, value: T): Promise<void> {
    try {
      await this.setItemStrict(key, value);
    } catch (error) {
      console.error(`Failed to set IndexedDB key "${key}":`, error);
    }
  }

  static async setItemStrict<T>(key: string, value: T): Promise<void> {
    const db = await this.getDB();
    const serialized = JSON.stringify(value);
    await db.put(STORE_NAME, serialized, key);
  }

  static async removeItem(key: string): Promise<void> {
    try {
      await this.removeItemStrict(key);
    } catch (error) {
      console.error(`Failed to remove IndexedDB key "${key}":`, error);
    }
  }

  static async removeItemStrict(key: string): Promise<void> {
    const db = await this.getDB();
    await db.delete(STORE_NAME, key);
  }

  /** Atomically read/compare/update related records; transform must stay synchronous. */
  static async transactItemsStrict<T>(
    keys: readonly string[],
    transform: (values: Readonly<Record<string, unknown>>) => {
      set: Readonly<Record<string, unknown>>;
      remove?: readonly string[];
      result: T;
    },
  ): Promise<T> {
    const db = await this.getDB();
    // Perform dependent writes inside the final native request's success event.
    // Awaiting request promises can leave a transaction inactive in WebKit and
    // event-loop/fake-timer environments before the next write is submitted.
    return new Promise<T>((resolve, reject) => {
      const transaction = unwrap(db).transaction(STORE_NAME, "readwrite");
      const store = transaction.objectStore(STORE_NAME);
      const values: Record<string, unknown> = {};
      let remaining = keys.length;
      let result: T;
      let failure: unknown;
      const abort = (error: unknown) => {
        failure = error;
        try {
          transaction.abort();
        } catch {
          reject(error);
        }
      };
      transaction.onabort = () =>
        reject(
          failure ??
            transaction.error ??
            new Error("IndexedDB transaction aborted."),
        );
      transaction.onerror = () => {
        failure ??= transaction.error;
      };
      transaction.oncomplete = () => resolve(result);
      const apply = () => {
        try {
          const changes = transform(values);
          for (const [key, value] of Object.entries(changes.set))
            store.put(JSON.stringify(value), key);
          for (const key of changes.remove ?? []) store.delete(key);
          result = changes.result;
        } catch (error) {
          abort(error);
        }
      };
      if (remaining === 0) apply();
      for (const key of keys) {
        const request = store.get(key);
        request.onsuccess = () => {
          try {
            values[key] =
              request.result === undefined ? null : JSON.parse(request.result);
            remaining -= 1;
            if (remaining === 0) apply();
          } catch (error) {
            abort(error);
          }
        };
      }
    });
  }
}
