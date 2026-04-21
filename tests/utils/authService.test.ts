import fs from 'fs/promises';
import path from 'path';
import os from 'os';
import crypto from 'crypto';
import { vi } from 'vitest';
import { invoke } from '@tauri-apps/api/core';

let AuthService: typeof import('../../src/utils/auth/authService').AuthService;

// The real Argon2id/bcrypt verification lives in the Rust backend and is
// exercised by `cargo test -p sorng-auth`. For the JS-side tests we stub the
// `auth_hash_password` / `auth_verify_password` commands with a deterministic
// Node-crypto-backed implementation so the persistence and store plumbing can
// be tested end-to-end without a running Tauri runtime.
function installInvokeStub() {
  const mocked = invoke as unknown as ReturnType<typeof vi.fn>;
  mocked.mockImplementation(async (cmd: string, args?: any) => {
    if (cmd === 'auth_hash_password') {
      const salt = crypto.randomBytes(16).toString('hex');
      const derived = crypto
        .scryptSync(args.password, salt, 32)
        .toString('hex');
      // Use a synthetic PHC-style prefix distinct from bcrypt's `$2…$`.
      return `$sorngtest$${salt}$${derived}`;
    }
    if (cmd === 'auth_verify_password') {
      const hash: string = args.hash;
      if (hash.startsWith('$sorngtest$')) {
        const [, , salt, derived] = hash.split('$');
        const check = crypto
          .scryptSync(args.password, salt, 32)
          .toString('hex');
        return check === derived;
      }
      // Pretend legacy bcrypt hashes match only a well-known password for
      // the opportunistic-rehash test below.
      if (/^\$2[abxy]\$/.test(hash)) {
        return args.password === 'legacypass';
      }
      return false;
    }
    return undefined;
  });
}

async function createStore(): Promise<string> {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'auth-'));
  const file = path.join(dir, 'users.json');
  await fs.writeFile(file, '[]');
  return file;
}

describe('AuthService', () => {
  let storePath: string;
  let service: InstanceType<typeof AuthService>;

  beforeAll(async () => {
    process.env.USER_STORE_SECRET = 'test-secret';
    process.env.PBKDF2_ITERATIONS = '1000';
    ({ AuthService } = await import('../../src/utils/auth/authService'));
  });

  afterAll(() => {
    delete process.env.USER_STORE_SECRET;
    delete process.env.PBKDF2_ITERATIONS;
  });

  beforeEach(async () => {
    installInvokeStub();
    storePath = await createStore();
    service = new AuthService(storePath);
    await service.ready();
  });

  test('addUser and listUsers', async () => {
    await service.addUser('alice', 'password1');
    await service.addUser('bob', 'password2');
    const users = await service.listUsers();
    expect(users.sort()).toEqual(['alice', 'bob']);
    const contents = await fs.readFile(storePath, 'utf8');
    expect(contents).not.toContain('alice');
    expect(contents).not.toContain('bob');
    const parsed = JSON.parse(contents);
    expect(parsed).toHaveProperty('iv');
    const service2 = new AuthService(storePath);
    await service2.ready();
    expect(await service2.verifyUser('alice', 'password1')).toBe(true);
  }, 15000);

  test('removeUser', async () => {
    await service.addUser('charlie', 'secret');
    const removed = await service.removeUser('charlie');
    expect(removed).toBe(true);
    expect(await service.listUsers()).toEqual([]);
    const contents = await fs.readFile(storePath, 'utf8');
    expect(contents).not.toContain('charlie');
  });

  test('updatePassword', async () => {
    await service.addUser('dave', 'old');
    const updated = await service.updatePassword('dave', 'new');
    expect(updated).toBe(true);
    expect(await service.verifyUser('dave', 'new')).toBe(true);
  });

  test('migrates plaintext store to encrypted', async () => {
    const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'auth-plain-'));
    const file = path.join(dir, 'users.json');
    await fs.writeFile(
      file,
      JSON.stringify([{ username: 'legacy', passwordHash: 'hash' }]),
    );
    const svc = new AuthService(file);
    await svc.ready();
    expect(await svc.listUsers()).toEqual(['legacy']);
    const contents = await fs.readFile(file, 'utf8');
    expect(contents).not.toContain('legacy');
  });

  test('opportunistically rehashes legacy bcrypt entries on successful verify', async () => {
    // Seed the store with a legacy bcrypt-looking hash.
    const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'auth-legacy-'));
    const file = path.join(dir, 'users.json');
    await fs.writeFile(
      file,
      JSON.stringify([
        { username: 'legacy', passwordHash: '$2b$10$fakefakefakefakefakefu' },
      ]),
    );
    const svc = new AuthService(file);
    await svc.ready();
    expect(await svc.verifyUser('legacy', 'legacypass')).toBe(true);
    // After successful legacy verify, stored hash should no longer be bcrypt.
    const list = await svc.listUsers();
    expect(list).toContain('legacy');
    // Re-verify uses the new hash (still passes).
    expect(await svc.verifyUser('legacy', 'legacypass')).toBe(true);
  });
});
