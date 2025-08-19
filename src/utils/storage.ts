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

export class SecureStorage {
  private static password: string | null = null;
  private static isUnlocked: boolean = false;

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
      ["deriveBits"],
    );
    const derivedBits = await crypto.subtle.deriveBits(
      {
        name: "PBKDF2",
        salt,
        iterations: PBKDF2_ITERATIONS,
        hash: "SHA-256",
      },
      keyMaterial,
      256,
    );
    return crypto.subtle.importKey(
      "raw",
      derivedBits,
      { name: "AES-GCM" },
      false,
      ["encrypt", "decrypt"],
    );
  }

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

  static async saveData(
    data: StorageData,
    usePassword: boolean = false,
  ): Promise<void> {
    try {
      await this.migrateMetaKey();

      if (usePassword && this.password) {
        const crypto = getCrypto();
        const serialized = JSON.stringify(data);
        const encoder = new TextEncoder();
        const salt = crypto.getRandomValues(new Uint8Array(16));
        const iv = crypto.getRandomValues(new Uint8Array(12));
        const key = await this.deriveKey(this.password, salt);
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

  static async loadData(): Promise<StorageData | null> {
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
            const salt = fromBase64(parsedSettings.salt);
            const iv = fromBase64(parsedSettings.iv);
            const key = await this.deriveKey(this.password as string, salt);
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

  static async clearStorage(): Promise<void> {
    await this.migrateMetaKey();
    await IndexedDbService.removeItem(STORAGE_KEY);
    await IndexedDbService.removeItem(STORAGE_META_KEY);
    this.clearPassword();
  }
}
