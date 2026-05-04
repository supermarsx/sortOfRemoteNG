const invoke = (globalThis as any).__TAURI__?.core?.invoke;

const STORAGE_KEY = "mremote-connections";
const STORAGE_META_KEY = "mremote-storage-meta";
const OLD_STORAGE_META_KEY = "mremote-settings";

import { Connection } from "../../types/connection/connection";
import { IndexedDbService } from "./indexedDbService";
import { PBKDF2_ITERATIONS } from "../../config";

const getCrypto = (): Crypto => globalThis.crypto as Crypto;

const asBufferSource = (bytes: Uint8Array): BufferSource =>
  bytes as Uint8Array<ArrayBuffer>;

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
        salt: asBufferSource(salt),
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
    if (!this.password) return false;
    // Constant-time comparison to prevent timing attacks
    const a = new TextEncoder().encode(this.password);
    const b = new TextEncoder().encode(password);
    if (a.length !== b.length) return false;
    let diff = 0;
    for (let i = 0; i < a.length; i++) {
      diff |= a[i] ^ b[i];
    }
    return diff === 0;
  }

  static isStorageUnlocked(): boolean {
    return this.isUnlocked;
  }

  static async hasStoredData(): Promise<boolean> {
    if (this.useTauri && invoke) {
      return await invoke('has_stored_data');
    } else {
      return (await IndexedDbService.getItem(STORAGE_KEY)) !== null;
    }
  }

  static async isStorageEncrypted(): Promise<boolean> {
    if (this.useTauri && invoke) {
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
    if (this.useTauri && invoke) {
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
            { name: "AES-GCM", iv: asBufferSource(iv) },
            key,
            asBufferSource(encoder.encode(serialized)),
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
    if (this.useTauri && invoke) {
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
                { name: "AES-GCM", iv: asBufferSource(iv) },
                key,
                asBufferSource(fromBase64(storedData as string)),
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
    if (this.useTauri && invoke) {
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

  // ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
  //  Vault integration (native OS keychain / biometrics)
  // ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

  /**
   * Check if the native OS vault is available.
   * Returns `false` when running in a browser (no Tauri).
   */
  static async isVaultAvailable(): Promise<boolean> {
    if (!this.useTauri || !invoke) return false;
    try {
      return await invoke('vault_is_available') as boolean;
    } catch {
      return false;
    }
  }

  /**
   * Get the vault backend name (e.g. "Windows Credential Manager + DPAPI").
   */
  static async getVaultBackendName(): Promise<string> {
    if (!this.useTauri || !invoke) return 'none';
    try {
      return await invoke('vault_backend_name') as string;
    } catch {
      return 'none';
    }
  }

  /**
   * Check if biometric authentication is available.
   */
  static async isBiometricAvailable(): Promise<boolean> {
    if (!this.useTauri || !invoke) return false;
    try {
      return await invoke('biometric_is_available') as boolean;
    } catch {
      return false;
    }
  }

  /**
   * Get detailed biometric status (hardware, enrollment, kinds).
   */
  static async getBiometricStatus(): Promise<Record<string, unknown> | null> {
    if (!this.useTauri || !invoke) return null;
    try {
      return await invoke('biometric_check_availability') as Record<string, unknown>;
    } catch {
      return null;
    }
  }

  /**
   * Prompt the user for biometric verification.
   * @param reason - Message shown to the user during the biometric prompt.
   * @returns `true` if verification succeeded.
   */
  static async biometricVerify(reason: string): Promise<boolean> {
    if (!this.useTauri || !invoke) throw new Error('Biometrics not available');
    return await invoke('biometric_verify', { reason }) as boolean;
  }

  /**
   * Check whether legacy storage needs migration to vault-backed storage.
   */
  static async needsVaultMigration(storagePath: string): Promise<boolean> {
    if (!this.useTauri || !invoke) return false;
    try {
      return await invoke('vault_needs_migration', { storagePath }) as boolean;
    } catch {
      return false;
    }
  }

  /**
   * Migrate legacy plain-JSON storage to vault-backed encrypted storage.
   * The DEK (data encryption key) is stored in the OS vault.
   */
  static async migrateToVault(
    storagePath: string,
    oldPassword?: string,
  ): Promise<{ success: boolean; message: string; backupPath?: string }> {
    if (!this.useTauri || !invoke) {
      throw new Error('Vault migration requires Tauri');
    }
    return await invoke('vault_migrate', {
      storagePath,
      oldPassword: oldPassword ?? null,
    }) as { success: boolean; message: string; backupPath?: string };
  }

  /**
   * Save data using vault-backed encryption (DEK stored in OS keychain).
   */
  static async saveDataVault(
    storagePath: string,
    data: StorageData,
  ): Promise<void> {
    if (!this.useTauri || !invoke) {
      throw new Error('Vault storage requires Tauri');
    }
    const jsonData = JSON.stringify(data);
    await invoke('vault_save_storage', { storagePath, jsonData });
  }

  /**
   * Load data from vault-backed encrypted storage (DEK from OS keychain).
   */
  static async loadDataVault(storagePath: string): Promise<StorageData | null> {
    if (!this.useTauri || !invoke) return null;
    try {
      const json = await invoke('vault_load_storage', { storagePath }) as string;
      return JSON.parse(json) as StorageData;
    } catch (err) {
      console.error('Failed to load vault storage:', err);
      return null;
    }
  }

  /**
   * Store a secret in the OS vault (Credential Manager / Keychain / SecretService).
   */
  static async vaultStoreSecret(
    service: string,
    account: string,
    secret: string,
  ): Promise<void> {
    if (!this.useTauri || !invoke) throw new Error('Vault not available');
    await invoke('vault_store_secret', { service, account, secret });
  }

  /**
   * Read a secret from the OS vault.
   */
  static async vaultReadSecret(
    service: string,
    account: string,
  ): Promise<string> {
    if (!this.useTauri || !invoke) throw new Error('Vault not available');
    return await invoke('vault_read_secret', { service, account }) as string;
  }

  /**
   * Delete a secret from the OS vault.
   */
  static async vaultDeleteSecret(
    service: string,
    account: string,
  ): Promise<void> {
    if (!this.useTauri || !invoke) throw new Error('Vault not available');
    await invoke('vault_delete_secret', { service, account });
  }

  /**
   * Store a secret gated behind biometric verification.
   */
  static async vaultBiometricStore(
    service: string,
    account: string,
    secret: string,
    reason: string,
  ): Promise<void> {
    if (!this.useTauri || !invoke) throw new Error('Vault not available');
    await invoke('vault_biometric_store', { service, account, secret, reason });
  }

  /**
   * Read a secret gated behind biometric verification.
   */
  static async vaultBiometricRead(
    service: string,
    account: string,
    reason: string,
  ): Promise<string> {
    if (!this.useTauri || !invoke) throw new Error('Vault not available');
    return await invoke('vault_biometric_read', { service, account, reason }) as string;
  }
}
