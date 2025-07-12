import CryptoJS from 'crypto-js';

const STORAGE_KEY = 'mremote-connections';
const STORAGE_META_KEY = 'mremote-storage-meta';
const OLD_STORAGE_META_KEY = 'mremote-settings';

import { Connection } from '../types/connection';
import { LocalStorageService } from './localStorageService';

export interface StorageData {
  connections: Connection[];
  settings: Record<string, unknown>;
  timestamp: number;
}

export class SecureStorage {
  private static password: string | null = null;
  private static isUnlocked: boolean = false;

  // Migrate old metadata key to the new one if needed
  private static migrateMetaKey(): void {
    const oldData = LocalStorageService.getItem<any>(OLD_STORAGE_META_KEY);
    if (oldData && !LocalStorageService.getItem(STORAGE_META_KEY)) {
      LocalStorageService.setItem(STORAGE_META_KEY, oldData);
      LocalStorageService.removeItem(OLD_STORAGE_META_KEY);
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

  static hasStoredData(): boolean {
    return LocalStorageService.getItem(STORAGE_KEY) !== null;
  }

  static isStorageEncrypted(): boolean {
    this.migrateMetaKey();
    const settings = LocalStorageService.getItem<any>(STORAGE_META_KEY);
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
      const serialized = JSON.stringify(data);

      if (usePassword && this.password) {
        const encrypted = CryptoJS.AES.encrypt(serialized, this.password).toString();
        this.migrateMetaKey();
        LocalStorageService.setItem(STORAGE_KEY, encrypted);
        LocalStorageService.setItem(STORAGE_META_KEY, {
          isEncrypted: true,
          hasPassword: true,
          timestamp: Date.now()
        });
      } else {
        this.migrateMetaKey();
        LocalStorageService.setItem(STORAGE_KEY, data);
        LocalStorageService.setItem(STORAGE_META_KEY, {
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
      this.migrateMetaKey();
      const storedData = LocalStorageService.getItem<any>(STORAGE_KEY);
      const settings = LocalStorageService.getItem<any>(STORAGE_META_KEY);
      
      if (!storedData) return null;

      if (settings) {
        const parsedSettings = settings;
        if (parsedSettings.isEncrypted && this.password) {
          const decrypted = CryptoJS.AES.decrypt(storedData as string, this.password).toString(CryptoJS.enc.Utf8);
          if (!decrypted) {
            throw new Error('Invalid password');
          }
          return JSON.parse(decrypted);
        }
      }

      return storedData as StorageData;
    } catch {
      throw new Error('Failed to load data or invalid password');
    }
  }

  static clearStorage(): void {
    this.migrateMetaKey();
    LocalStorageService.removeItem(STORAGE_KEY);
    LocalStorageService.removeItem(STORAGE_META_KEY);
    this.clearPassword();
  }
}
