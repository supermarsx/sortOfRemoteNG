import fs from 'fs/promises';
import path from 'path';
import os from 'os';

let AuthService: typeof import('../src/utils/authService').AuthService;

// Utility to create temp directory for user store
async function createStore(): Promise<string> {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'auth-'));
  const file = path.join(dir, 'users.json');
  await fs.writeFile(file, '[]');
  return file;
}

describe('AuthService', () => {
  let storePath: string;
  let service: AuthService;

  beforeAll(async () => {
    process.env.USER_STORE_SECRET = 'test-secret';
    process.env.PBKDF2_ITERATIONS = '1000';
    ({ AuthService } = await import('../src/utils/authService'));
  });

  afterAll(() => {
    delete process.env.USER_STORE_SECRET;
    delete process.env.PBKDF2_ITERATIONS;
  });

  beforeEach(async () => {
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
  });

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
});
