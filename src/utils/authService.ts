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
 * Service for managing user credentials persisted as bcrypt hashes in a JSON
 * file on disk. Credentials are loaded into memory and can be updated or
 * verified against provided passwords.
 */
export class AuthService {
  private users: Record<string, string> = {};
  private storePath: string;
  private loadPromise: Promise<void>;
  private secret: string | undefined;

  constructor(storePath: string) {
    this.storePath = storePath;
    this.secret = process.env.USER_STORE_SECRET;
    this.loadPromise = this.load();
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
   *
   * @returns {Promise<void>} Resolves when the user list is loaded.
   * @throws {Error} If the user store cannot be read or parsed.
   */
  private async load(): Promise<void> {
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
        // Plaintext store
        this.users = {};
        parsed.forEach((u: StoredUser) => {
          this.users[u.username] = u.passwordHash;
        });
        // Migrate to encrypted store if a secret is configured
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
   *
   * @returns {Promise<void>} Resolves when all users are written to disk.
   * @throws {Error} If writing to the storage file fails.
   */
  private async persist(): Promise<void> {
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
   *
   * @param {string} username - The username to store.
   * @param {string} password - The plain-text password for the user.
   * @returns {Promise<void>} Resolves when the user is added and persisted.
   * @throws {Error} If hashing or persisting the user fails.
   */
  async addUser(username: string, password: string): Promise<void> {
    await this.ready();
    const hash = await bcrypt.hash(password, 10);
    this.users[username] = hash;
    try {
      await this.persist();
    } catch (error) {
      console.error("Failed to persist user", error);
    }
  }

  /**
   * Verifies that a provided password matches the stored hash for the given
   * username.
   *
   * @param {string} username - The username to verify.
   * @param {string} password - The plain-text password to compare.
   * @returns {Promise<boolean>} True if the credentials are valid, otherwise false.
   * @throws {Error} If the password comparison fails.
   */
  async verifyUser(username: string, password: string): Promise<boolean> {
    await this.ready();
    const hash = this.users[username];
    if (!hash) return false;
    return bcrypt.compare(password, hash);
  }

  /**
   * Returns a list of all stored usernames.
   */
  async listUsers(): Promise<string[]> {
    await this.ready();
    return Object.keys(this.users);
  }

  /**
   * Removes the specified user from the store.
   *
   * @param {string} username - The username to remove.
   * @returns {Promise<boolean>} True if the user existed and was removed.
   */
  async removeUser(username: string): Promise<boolean> {
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

  /**
   * Updates the password for an existing user.
   *
   * @param {string} username - The username to update.
   * @param {string} newPassword - The new plain-text password.
   * @returns {Promise<boolean>} True if the password was updated.
   */
  async updatePassword(
    username: string,
    newPassword: string,
  ): Promise<boolean> {
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
