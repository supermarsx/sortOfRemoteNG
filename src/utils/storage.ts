import CryptoJS from 'crypto-js';

const STORAGE_KEY = 'mremote-connections';
const STORAGE_META_KEY = 'mremote-storage-meta';
const OLD_STORAGE_META_KEY = 'mremote-settings';

import { Connection } from '../types/connection';
import { IndexedDbService } from './indexedDbService';

export interface StorageData {
  connections: Connection[];
  settings: Record<string, unknown>;
  timestamp: number;
}

export class SecureStorage {
  private static password: string | null = null;
  private static isUnlocked: boolean = false;

  // Migrate old metadata key to the new one if needed
  private static async migrateMetaKey(): Promise<void> {
    const oldData = await IndexedDbService.getItem<any>(OLD_STORAGE_META_KEY);
    if (oldData && !(await IndexedDbService.getItem(STORAGE_META_KEY))) {
      await IndexedDbService.setItem(STORAGE_META_KEY, oldData);
      await IndexedDbService.removeItem(OLD_STORAGE_META_KEY);
    }
  }

  static setPassword(password: string): void {
    this.password = password;
    this.isUnlocked = true;
  }

  static clearPassword(): void {
    this.password = null;
    this.isUnlocked = false;
  }

  static verifyPassword(password: string): boolean {
    return this.password === password;
  }

  static isStorageUnlocked(): boolean {
    return this.isUnlocked;
  }

  static async hasStoredData(): Promise<boolean> {
    return (await IndexedDbService.getItem(STORAGE_KEY)) !== null;
  }

  static async isStorageEncrypted(): Promise<boolean> {
    await this.migrateMetaKey();
    const settings = await IndexedDbService.getItem<any>(STORAGE_META_KEY);
    if (settings) {
      try {
        return settings.isEncrypted === true;
      } catch {
        return false;
      }
    }
    return false;
  }

  static async saveData(data: StorageData, usePassword: boolean = false): Promise<void> {
    try {
      await this.migrateMetaKey();

      if (usePassword && this.password) {
        const serialized = JSON.stringify(data);
        const encrypted = CryptoJS.AES.encrypt(serialized, this.password).toString();
        await IndexedDbService.setItem(STORAGE_KEY, encrypted);
        await IndexedDbService.setItem(STORAGE_META_KEY, {
          isEncrypted: true,
          hasPassword: true,
          timestamp: Date.now()
        });
      } else {
        await IndexedDbService.setItem(STORAGE_KEY, data);
        await IndexedDbService.setItem(STORAGE_META_KEY, {
          isEncrypted: false,
          hasPassword: false,
          timestamp: Date.now()
        });
      }
    } catch {
      throw new Error('Failed to save data');
    }
  }

  static async loadData(): Promise<StorageData | null> {
    try {
      await this.migrateMetaKey();
      const storedData = await IndexedDbService.getItem<any>(STORAGE_KEY);
      const settings = await IndexedDbService.getItem<any>(STORAGE_META_KEY);
      
      if (!storedData) return null;

      if (settings) {
        const parsedSettings = settings;
        if (parsedSettings.isEncrypted) {
          if (!this.password) {
            throw new Error('Password is required');
          }
          const decrypted = CryptoJS.AES.decrypt(storedData as string, this.password).toString(CryptoJS.enc.Utf8);
          if (!decrypted) {
            throw new Error('Invalid password');
          }
          return JSON.parse(decrypted);
        }
      }

      return storedData as StorageData;
    } catch (error) {
      if (error instanceof Error) {
        throw error;
      }
      throw new Error('Failed to load data or invalid password');
    }
  }

  static async clearStorage(): Promise<void> {
    await this.migrateMetaKey();
    await IndexedDbService.removeItem(STORAGE_KEY);
    await IndexedDbService.removeItem(STORAGE_META_KEY);
    this.clearPassword();
  }
}
