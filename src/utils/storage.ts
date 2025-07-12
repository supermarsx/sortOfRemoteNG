import CryptoJS from 'crypto-js';
import { IndexedDbService } from './indexedDbService';

const STORAGE_KEY = 'mremote-connections';
const STORAGE_META_KEY = 'mremote-storage-meta';
const OLD_STORAGE_META_KEY = 'mremote-settings';

import { Connection } from '../types/connection';

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
    const oldData = await IndexedDbService.getItem<string>(OLD_STORAGE_META_KEY);
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
      return settings.isEncrypted === true;
    }
    return false;
  }

  static async saveData(data: StorageData, usePassword: boolean = false): Promise<void> {
    try {
      const dataToStore = JSON.stringify(data);

      if (usePassword && this.password) {
        const encrypted = CryptoJS.AES.encrypt(dataToStore, this.password).toString();
        await this.migrateMetaKey();
        await IndexedDbService.setItem(STORAGE_KEY, encrypted);
        await IndexedDbService.setItem(STORAGE_META_KEY, {
          isEncrypted: true,
          hasPassword: true,
          timestamp: Date.now()
        });
      } else {
        await this.migrateMetaKey();
        await IndexedDbService.setItem(STORAGE_KEY, dataToStore);
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
      const storedData = await IndexedDbService.getItem<string>(STORAGE_KEY);
      const settings = await IndexedDbService.getItem<any>(STORAGE_META_KEY);
      
      if (!storedData) return null;

      if (settings) {
        if (settings.isEncrypted && this.password) {
          const decrypted = CryptoJS.AES.decrypt(storedData, this.password).toString(CryptoJS.enc.Utf8);
          if (!decrypted) {
            throw new Error('Invalid password');
          }
          return JSON.parse(decrypted);
        }
      }

      return typeof storedData === 'string' ? JSON.parse(storedData) : storedData;
    } catch {
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
