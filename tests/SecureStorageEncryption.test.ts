import { describe, it, expect, beforeEach } from 'vitest';
import { SecureStorage, StorageData } from '../src/utils/storage';
import { LocalStorageService } from '../src/utils/localStorageService';


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

    const stored = await LocalStorageService.getItem<string>('mremote-connections');
    expect(typeof stored).toBe('string');
    const meta = await LocalStorageService.getItem<{ isEncrypted: boolean }>('mremote-storage-meta');
    expect(meta.isEncrypted).toBe(true);
  });
});
