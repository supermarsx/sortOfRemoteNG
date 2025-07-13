import { describe, it, expect, beforeEach } from 'vitest';
import { SecureStorage, StorageData } from '../src/utils/storage';
import { IndexedDbService } from '../src/utils/indexedDbService';
import { openDB } from 'idb';

const DB_NAME = 'mremote-keyval';
const STORE_NAME = 'keyval';


describe('SecureStorage encryption', () => {
  beforeEach(async () => {
    await IndexedDbService.init();
    const db = await openDB(DB_NAME, 1);
    await db.clear(STORE_NAME);
    SecureStorage.setPassword('secret');
  });

  it('stores encrypted data when usePassword is true', async () => {
    const data: StorageData = {
      connections: [],
      settings: {},
      timestamp: Date.now(),
    };

    await SecureStorage.saveData(data, true);

    const stored = await IndexedDbService.getItem<string>('mremote-connections');
    expect(typeof stored).toBe('string');
    const meta = await IndexedDbService.getItem<{ isEncrypted: boolean }>('mremote-storage-meta');
    expect(meta.isEncrypted).toBe(true);
  });
});
