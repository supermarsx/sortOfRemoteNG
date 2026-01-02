import { invoke } from '@tauri-apps/api/core';

const STORAGE_KEY = "mremote-connections";
const STORAGE_META_KEY = "mremote-storage-meta";
const OLD_STORAGE_META_KEY = "mremote-settings";

import { Connection } from "../types/connection";
import { IndexedDbService } from "./indexedDbService";
import { PBKDF2_ITERATIONS } from "../config";

const getCrypto = (): Crypto => globalThis.crypto as Crypto;

const toBase64 = (buffer: ArrayBuffer | Uint8Array): string => {
  const bytes = buffer instanceof Uint8Array ? buffer : new Uint8Array(buffer);
  if (typeof Buffer !== "undefined") {
    return Buffer.from(bytes).toString("base64");
  }
  let binary = "";
  bytes.forEach((b) => (binary += String.fromCharCode(b)));
  return btoa(binary);
};

const fromBase64 = (str: string): Uint8Array => {
  if (typeof Buffer !== "undefined") {
    return new Uint8Array(Buffer.from(str, "base64"));
  }
  const binary = atob(str);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
  return bytes;
};

export interface StorageData {
  connections: Connection[];
  settings: Record<string, unknown>;
  timestamp: number;
}

/**
 * Provides secure storage of connection data.
 * Uses Tauri backend if available, otherwise falls back to IndexedDB.
 */
export class SecureStorage {
  private static password: string | null = null;
  private static useTauri: boolean = typeof window !== 'undefined' && (window as any).__TAURI__;
  private static isUnlocked: boolean = false;

  /**
   * Derive an AES-GCM key from a user password.
   *
   * @param password - Plain-text password provided by the user.
   * @param salt - Random salt used for PBKDF2.
   * @returns A 256-bit AES-GCM {@link CryptoKey}.
   * @throws {DOMException} If the underlying crypto operations fail.
   * @remarks Side-effect free; only uses the Web Crypto API.
   */
  private static async deriveKey(
    password: string,
    salt: Uint8Array,
  ): Promise<CryptoKey> {
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
      {
        name: "PBKDF2",
        salt,
        iterations: PBKDF2_ITERATIONS, // Number of PBKDF2 iterations from config
        hash: "SHA-256",
      },
      keyMaterial,
      { name: "AES-GCM", length: 256 },
      false,
      ["encrypt", "decrypt"],
    );
  }

  /**
   * Migrate legacy storage metadata to the current key.
   *
   * @remarks Removes the old metadata entry after copying it to the new key.
   * @throws {Error} Propagates errors thrown by {@link IndexedDbService}.
   * @sideEffect Reads and writes to IndexedDB via {@link IndexedDbService}.
   */
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
    if (this.useTauri) {
      return await invoke('has_stored_data');
    } else {
      return (await IndexedDbService.getItem(STORAGE_KEY)) !== null;
    }
  }

  static async isStorageEncrypted(): Promise<boolean> {
    if (this.useTauri) {
      return await invoke('is_storage_encrypted');
    } else {
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
  }

  /**
   * Persist data to IndexedDB, encrypting it when requested.
   *
   * @param data - Connection and settings data to store.
   * @param usePassword - When `true`, encrypts using the current password.
   * @throws {Error} If encryption or storage operations fail.
   * @sideEffect Overwrites existing storage and metadata in IndexedDB.
   */
  static async saveData(
    data: StorageData,
    usePassword: boolean = false,
  ): Promise<void> {
    if (this.useTauri) {
      try {
        if (usePassword && this.password) {
          await invoke('set_storage_password', { password: this.password });
        } else {
          await invoke('set_storage_password', { password: null });
        }
        await invoke('save_data', { data, usePassword });
      } catch (err) {
        console.error("Failed to save data via Tauri:", err);
        const message = err instanceof Error ? err.message : String(err);
        throw new Error(`Failed to save data: ${message}`);
      }
    } else {
      try {
        await this.migrateMetaKey();

        if (usePassword && this.password) {
          const crypto = getCrypto();
          const serialized = JSON.stringify(data);
          const encoder = new TextEncoder();
          const salt = crypto.getRandomValues(new Uint8Array(16)); // Random salt for PBKDF2 key derivation
          const iv = crypto.getRandomValues(new Uint8Array(12)); // Initialization vector for AES-GCM
          const key = await this.deriveKey(this.password, salt); // Derive 256-bit AES key from password
          const encryptedBuffer = await crypto.subtle.encrypt(
            { name: "AES-GCM", iv },
            key,
            encoder.encode(serialized),
          );
          const encrypted = toBase64(encryptedBuffer);
          await IndexedDbService.setItem(STORAGE_KEY, encrypted);
          await IndexedDbService.setItem(STORAGE_META_KEY, {
            isEncrypted: true,
            hasPassword: true,
            timestamp: Date.now(),
            salt: toBase64(salt),
            iv: toBase64(iv),
          });
        } else {
          await IndexedDbService.setItem(STORAGE_KEY, data);
          await IndexedDbService.setItem(STORAGE_META_KEY, {
            isEncrypted: false,
            hasPassword: false,
            timestamp: Date.now(),
          });
        }
      } catch (err) {
        console.error("Failed to save data:", err);
        const message = err instanceof Error ? err.message : String(err);
        throw new Error(`Failed to save data: ${message}`);
      }
    }
  }

  /**
   * Retrieve and decrypt stored data from IndexedDB.
   *
   * @returns The {@link StorageData} if present, otherwise `null`.
   * @throws {Error} If a password is required or incorrect, or if data cannot be read.
   * @sideEffect Reads from IndexedDB and may log errors to the console.
   */
  static async loadData(): Promise<StorageData | null> {
    if (this.useTauri) {
      try {
        const result = await invoke('load_data') as StorageData | null;
        return result;
      } catch (err) {
        console.error("Failed to load data via Tauri:", err);
        const message = err instanceof Error ? err.message : String(err);
        throw new Error(`Failed to load data: ${message}`);
      }
    } else {
      try {
        await this.migrateMetaKey();
        const storedData = await IndexedDbService.getItem<any>(STORAGE_KEY);
        const settings = await IndexedDbService.getItem<any>(STORAGE_META_KEY);

        if (!storedData) return null;

        if (settings) {
          const parsedSettings = settings;
          if (parsedSettings.isEncrypted && !this.password) {
            throw new Error("Password is required to load encrypted data");
          }
          if (parsedSettings.isEncrypted) {
            try {
              const crypto = getCrypto();
              const salt = fromBase64(parsedSettings.salt); // Retrieve salt used during encryption
              const iv = fromBase64(parsedSettings.iv); // Retrieve IV for AES-GCM
              const key = await this.deriveKey(this.password as string, salt); // Re-create key using stored salt and password
              const decryptedBuffer = await crypto.subtle.decrypt(
                { name: "AES-GCM", iv },
                key,
                fromBase64(storedData as string),
              );
              const decoded = new TextDecoder().decode(decryptedBuffer);
              return JSON.parse(decoded);
            } catch (err) {
              console.error("Failed to decrypt data:", err);
              const message = err instanceof Error ? err.message : String(err);
              throw new Error(`Invalid password: ${message}`);
            }
          }
        }

        return storedData as StorageData;
      } catch (err) {
        console.error("Failed to load data:", err);
        const message = err instanceof Error ? err.message : String(err);
        throw new Error(`Failed to load data: ${message}`);
      }
    }
  }

  static async clearStorage(): Promise<void> {
    if (this.useTauri) {
      try {
        await invoke('clear_storage');
        this.clearPassword();
      } catch (err) {
        console.error("Failed to clear storage via Tauri:", err);
        const message = err instanceof Error ? err.message : String(err);
        throw new Error(`Failed to clear storage: ${message}`);
      }
    } else {
      await this.migrateMetaKey();
      await IndexedDbService.removeItem(STORAGE_KEY);
      await IndexedDbService.removeItem(STORAGE_META_KEY);
      this.clearPassword();
    }
  }
}
