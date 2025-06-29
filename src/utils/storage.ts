import CryptoJS from 'crypto-js';

const STORAGE_KEY = 'mremote-connections';
const SETTINGS_KEY = 'mremote-settings';

import { Connection } from '../types/connection';

export interface StorageData {
  connections: Connection[];
  settings: Record<string, unknown>;
  timestamp: number;
}

export class SecureStorage {
  private static password: string | null = null;
  private static isUnlocked: boolean = false;

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
    const settings = localStorage.getItem(SETTINGS_KEY);
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
        localStorage.setItem(STORAGE_KEY, encrypted);
        localStorage.setItem(SETTINGS_KEY, JSON.stringify({ 
          isEncrypted: true, 
          hasPassword: true,
          timestamp: Date.now()
        }));
      } else {
        localStorage.setItem(STORAGE_KEY, dataToStore);
        localStorage.setItem(SETTINGS_KEY, JSON.stringify({ 
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
      const storedData = localStorage.getItem(STORAGE_KEY);
      const settings = localStorage.getItem(SETTINGS_KEY);
      
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
    localStorage.removeItem(STORAGE_KEY);
    localStorage.removeItem(SETTINGS_KEY);
    this.clearPassword();
  }
}