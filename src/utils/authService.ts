import fs from 'fs';
import path from 'path';
import bcrypt from 'bcryptjs';

export interface StoredUser {
  username: string;
  passwordHash: string;
}

export class AuthService {
  private users: Record<string, string> = {};
  private storePath: string;
  private loadPromise: Promise<void>;

  constructor(storePath: string) {
    this.storePath = storePath;
    this.loadPromise = this.load();
  }

  private async load(): Promise<void> {
    try {
      const fullPath = path.resolve(this.storePath);
      const data = await fs.promises.readFile(fullPath, 'utf8');
      const parsed: StoredUser[] = JSON.parse(data);
      this.users = {};
      parsed.forEach(u => {
        this.users[u.username] = u.passwordHash;
      });
    } catch {
      this.users = {};
    }
  }

  private async persist(): Promise<void> {
    const arr: StoredUser[] = Object.entries(this.users).map(
      ([username, passwordHash]) => ({ username, passwordHash })
    );
    await fs.promises.writeFile(
      path.resolve(this.storePath),
      JSON.stringify(arr, null, 2)
    );
  }

  async addUser(username: string, password: string): Promise<void> {
    const hash = await bcrypt.hash(password, 10);
    await this.loadPromise;
    this.users[username] = hash;
    try {
      await this.persist();
    } catch (error) {
      console.error('Failed to persist user', error);
    }
  }

  async verifyUser(username: string, password: string): Promise<boolean> {
    await this.loadPromise;
    const hash = this.users[username];
    if (!hash) return false;
    return bcrypt.compare(password, hash);
  }
}
