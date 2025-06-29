import CryptoJS from 'crypto-js';

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
  private static migrateMetaKey(): void {
    const oldData = localStorage.getItem(OLD_STORAGE_META_KEY);
    if (oldData && !localStorage.getItem(STORAGE_META_KEY)) {
      localStorage.setItem(STORAGE_META_KEY, oldData);
      localStorage.removeItem(OLD_STORAGE_META_KEY);
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

  static isStorageUnlocked(): boolean {
    return this.isUnlocked;
  }

  static hasStoredData(): boolean {
    return localStorage.getItem(STORAGE_KEY) !== null;
  }

  static isStorageEncrypted(): boolean {
    this.migrateMetaKey();
    const settings = localStorage.getItem(STORAGE_META_KEY);
    if (settings) {
      try {
        const parsed = JSON.parse(settings);
        return parsed.isEncrypted === true;
      } catch {
        return false;
      }
    }
    return false;
  }

  static async saveData(data: StorageData, usePassword: boolean = false): Promise<void> {
    try {
      const dataToStore = JSON.stringify(data);
      
      if (usePassword && this.password) {
        const encrypted = CryptoJS.AES.encrypt(dataToStore, this.password).toString();
        this.migrateMetaKey();
        localStorage.setItem(STORAGE_KEY, encrypted);
        localStorage.setItem(STORAGE_META_KEY, JSON.stringify({
          isEncrypted: true, 
          hasPassword: true,
          timestamp: Date.now()
        }));
      } else {
        this.migrateMetaKey();
        localStorage.setItem(STORAGE_KEY, dataToStore);
        localStorage.setItem(STORAGE_META_KEY, JSON.stringify({
          isEncrypted: false, 
          hasPassword: false,
          timestamp: Date.now()
        }));
      }
    } catch {
      throw new Error('Failed to save data');
    }
  }

  static async loadData(): Promise<StorageData | null> {
    try {
      this.migrateMetaKey();
      const storedData = localStorage.getItem(STORAGE_KEY);
      const settings = localStorage.getItem(STORAGE_META_KEY);
      
      if (!storedData) return null;

      if (settings) {
        const parsedSettings = JSON.parse(settings);
        if (parsedSettings.isEncrypted && this.password) {
          const decrypted = CryptoJS.AES.decrypt(storedData, this.password).toString(CryptoJS.enc.Utf8);
          if (!decrypted) {
            throw new Error('Invalid password');
          }
          return JSON.parse(decrypted);
        }
      }

      return JSON.parse(storedData);
    } catch {
      throw new Error('Failed to load data or invalid password');
    }
  }

  static clearStorage(): void {
    this.migrateMetaKey();
    localStorage.removeItem(STORAGE_KEY);
    localStorage.removeItem(STORAGE_META_KEY);
    this.clearPassword();
  }
}
