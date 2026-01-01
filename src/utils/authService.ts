import { invoke } from '@tauri-apps/api/core';
import fs from "fs";
import path from "path";
import bcrypt from "bcryptjs";
import crypto from "crypto";
import { PBKDF2_ITERATIONS } from "../config";

export interface StoredUser {
  username: string;
  passwordHash: string;
}

/**
 * Service for managing user credentials.
 * Uses Tauri backend if available, otherwise falls back to file-based storage.
 */
export class AuthService {
  private users: Record<string, string> = {};
  private storePath?: string;
  private loadPromise: Promise<void>;
  private secret: string | undefined;
  private useTauri: boolean;

  constructor(storePath?: string) {
    this.storePath = storePath;
    this.secret = process.env.USER_STORE_SECRET;
    this.useTauri = typeof window !== 'undefined' && (window as any).__TAURI__;
    if (!this.useTauri && storePath) {
      this.loadPromise = this.load();
    } else {
      this.loadPromise = Promise.resolve();
    }
  }

  private static instance: AuthService | null = null;

  static getInstance(): AuthService {
    if (AuthService.instance === null) {
      AuthService.instance = new AuthService();
    }
    return AuthService.instance;
  }

  static resetInstance(): void {
    AuthService.instance = null;
  }

  /**
   * Returns a promise that resolves when the initial user list has been
   * loaded from disk.
   */
  async ready(): Promise<void> {
    await this.loadPromise;
  }

  /**
   * Loads the stored users from disk into memory.
   */
  private async load(): Promise<void> {
    if (!this.storePath) return;
    const fullPath = path.resolve(this.storePath);
    let data: string;
    try {
      data = await fs.promises.readFile(fullPath, "utf8");
    } catch (err: any) {
      if (err.code === "ENOENT") {
        this.users = {};
        return;
      }
      console.error("Failed to read user store", err);
      throw err;
    }

    try {
      const parsed = JSON.parse(data);
      if (Array.isArray(parsed)) {
        this.users = {};
        parsed.forEach((u: StoredUser) => {
          this.users[u.username] = u.passwordHash;
        });
        if (this.secret) {
          await this.persist();
        }
      } else if (
        parsed &&
        typeof parsed === "object" &&
        "iv" in parsed &&
        "salt" in parsed &&
        "data" in parsed
      ) {
        if (!this.secret) {
          throw new Error("USER_STORE_SECRET is required to decrypt user store");
        }
        const salt = Buffer.from((parsed as any).salt, "base64");
        const iv = Buffer.from((parsed as any).iv, "base64");
        const authTag = Buffer.from((parsed as any).authTag, "base64");
        const key = crypto.pbkdf2Sync(
          this.secret,
          salt,
          PBKDF2_ITERATIONS,
          32,
          "sha256",
        );
        const decipher = crypto.createDecipheriv("aes-256-gcm", key, iv);
        decipher.setAuthTag(authTag);
        const decrypted = Buffer.concat([
          decipher.update(Buffer.from((parsed as any).data, "base64")),
          decipher.final(),
        ]).toString("utf8");
        const arr: StoredUser[] = JSON.parse(decrypted);
        this.users = {};
        arr.forEach((u) => {
          this.users[u.username] = u.passwordHash;
        });
      } else {
        this.users = {};
      }
    } catch (err) {
      console.error("Failed to load user store", err);
      throw err;
    }
  }

  /**
   * Persists the in-memory users to the JSON storage file.
   */
  private async persist(): Promise<void> {
    if (!this.storePath) return;
    const arr: StoredUser[] = Object.entries(this.users).map(
      ([username, passwordHash]) => ({ username, passwordHash }),
    );
    const fullPath = path.resolve(this.storePath);
    if (this.secret) {
      const salt = crypto.randomBytes(16);
      const iv = crypto.randomBytes(12);
      const key = crypto.pbkdf2Sync(
        this.secret,
        salt,
        PBKDF2_ITERATIONS,
        32,
        "sha256",
      );
      const cipher = crypto.createCipheriv("aes-256-gcm", key, iv);
      const encrypted = Buffer.concat([
        cipher.update(JSON.stringify(arr)),
        cipher.final(),
      ]);
      const authTag = cipher.getAuthTag();
      const payload = {
        salt: salt.toString("base64"),
        iv: iv.toString("base64"),
        authTag: authTag.toString("base64"),
        data: encrypted.toString("base64"),
      };
      await fs.promises.writeFile(fullPath, JSON.stringify(payload, null, 2));
    } else {
      await fs.promises.writeFile(fullPath, JSON.stringify(arr, null, 2));
    }
  }

  /**
   * Adds a new user with a bcrypt-hashed password and persists the update.
   */
  async addUser(username: string, password: string): Promise<void> {
    if (this.useTauri) {
      await invoke('add_user', { username, password });
    } else {
      await this.ready();
      const hash = await bcrypt.hash(password, 10);
      this.users[username] = hash;
      try {
        await this.persist();
      } catch (error) {
        console.error("Failed to persist user", error);
      }
    }
  }

  /**
   * Verifies that a provided password matches the stored hash for the given username.
   */
  async verifyUser(username: string, password: string): Promise<boolean> {
    if (this.useTauri) {
      return await invoke('verify_user', { username, password });
    } else {
      await this.ready();
      const hash = this.users[username];
      if (!hash) return false;
      return bcrypt.compare(password, hash);
    }
  }

  /**
   * Returns a list of all stored usernames.
   */
  async listUsers(): Promise<string[]> {
    if (this.useTauri) {
      return await invoke('list_users');
    } else {
      await this.ready();
      return Object.keys(this.users);
    }
  }

  /**
   * Removes the specified user from the store.
   */
  async removeUser(username: string): Promise<boolean> {
    if (this.useTauri) {
      return await invoke('remove_user', { username });
    } else {
      await this.ready();
      if (!(username in this.users)) {
        return false;
      }
      delete this.users[username];
      try {
        await this.persist();
      } catch (error) {
        console.error("Failed to persist user removal", error);
        return false;
      }
      return true;
    }
  }

  /**
   * Updates the password for an existing user.
   */
  async updatePassword(username: string, newPassword: string): Promise<boolean> {
    if (this.useTauri) {
      return await invoke('update_password', { username, newPassword });
    } else {
      await this.ready();
      if (!(username in this.users)) {
        return false;
      }
      const hash = await bcrypt.hash(newPassword, 10);
      this.users[username] = hash;
      try {
        await this.persist();
      } catch (error) {
        console.error("Failed to persist password update", error);
        return false;
      }
      return true;
    }
  }
}
