import { describe, it, expect, beforeEach } from 'vitest';
import { SecureStorage, StorageData } from '../src/utils/storage';
import { IndexedDbService } from '../src/utils/indexedDbService';
import { openDB } from 'idb';

const DB_NAME = 'mremote-keyval';
const STORE_NAME = 'keyval';

describe('SecureStorage loadData', () => {
  beforeEach(async () => {
    await IndexedDbService.init();
    const db = await openDB(DB_NAME, 1);
    await db.clear(STORE_NAME);
    SecureStorage.clearPassword();
  });

  it('returns stored data when not encrypted', async () => {
    const data: StorageData = { connections: [], settings: {}, timestamp: Date.now() };
    await SecureStorage.saveData(data, false);
    const loaded = await SecureStorage.loadData();
    expect(loaded).toEqual(data);
  });

  it('returns decrypted data when password is set', async () => {
    const data: StorageData = { connections: [], settings: {}, timestamp: Date.now() };
    SecureStorage.setPassword('secret');
    await SecureStorage.saveData(data, true);
    const loaded = await SecureStorage.loadData();
    expect(loaded).toEqual(data);
  });

  it('throws error when encrypted data loaded without password', async () => {
    const data: StorageData = { connections: [], settings: {}, timestamp: Date.now() };
    SecureStorage.setPassword('secret');
    await SecureStorage.saveData(data, true);
    SecureStorage.clearPassword();
    await expect(SecureStorage.loadData()).rejects.toThrow('Password is required');
  });
});
