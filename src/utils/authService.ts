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

  constructor(storePath: string) {
    this.storePath = storePath;
    this.load();
  }

  private load(): void {
    try {
      const fullPath = path.resolve(this.storePath);
      const data = fs.readFileSync(fullPath, 'utf8');
      const parsed: StoredUser[] = JSON.parse(data);
      this.users = {};
      parsed.forEach(u => {
        this.users[u.username] = u.passwordHash;
      });
    } catch {
      this.users = {};
    }
  }

  private persist(): void {
    const arr: StoredUser[] = Object.entries(this.users).map(
      ([username, passwordHash]) => ({ username, passwordHash })
    );
    fs.writeFileSync(path.resolve(this.storePath), JSON.stringify(arr, null, 2));
  }

  async addUser(username: string, password: string): Promise<void> {
    const hash = await bcrypt.hash(password, 10);
    this.users[username] = hash;
    this.persist();
  }

  async verifyUser(username: string, password: string): Promise<boolean> {
    const hash = this.users[username];
    if (!hash) return false;
    return bcrypt.compare(password, hash);
  }
}
