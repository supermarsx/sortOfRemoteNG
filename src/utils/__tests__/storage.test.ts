import { describe, it, expect, beforeEach } from 'vitest';
import { openDB } from 'idb';
import { SecureStorage, type StorageData } from '../storage';
import { IndexedDbService } from '../indexedDbService';

const DB_NAME = 'mremote-keyval';
const STORE_NAME = 'keyval';

beforeEach(async () => {
  await IndexedDbService.init();
  const db = await openDB(DB_NAME, 1);
  await db.clear(STORE_NAME);
  SecureStorage.clearPassword();
});

describe('SecureStorage', () => {
  it('rejects when loading encrypted data without a password', async () => {
    const data: StorageData = { connections: [], settings: {}, timestamp: Date.now() };
    SecureStorage.setPassword('secret');
    await SecureStorage.saveData(data, true);
    SecureStorage.clearPassword();
    await expect(SecureStorage.loadData()).rejects.toThrow('Password is required to load encrypted data');
  });
});
