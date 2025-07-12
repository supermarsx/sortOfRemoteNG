import { describe, it, expect, beforeEach } from 'vitest';
import { SecureStorage, StorageData } from '../src/utils/storage';
import 'fake-indexeddb/auto';
import { openDB } from 'idb';
import { IndexedDbService } from '../src/utils/indexedDbService';


describe('SecureStorage encryption', () => {
  beforeEach(async () => {
    await IndexedDbService.init();
    const db = await openDB('mremote-keyval', 1);
    await db.clear('keyval');
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
    expect(() => JSON.parse(stored!)).toThrow();
    const meta = await IndexedDbService.getItem<any>('mremote-storage-meta');
    expect(meta.isEncrypted).toBe(true);
  });
});
