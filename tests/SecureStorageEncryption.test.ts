import { describe, it, expect, beforeEach } from 'vitest';
import { SecureStorage, StorageData } from '../src/utils/storage';
import 'fake-indexeddb/auto';
import { IndexedDbService } from '../src/utils/indexedDbService';


describe('SecureStorage encryption', () => {
  beforeEach(() => {
    localStorage.clear();
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
