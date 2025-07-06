import { describe, it, expect, beforeEach } from 'vitest';
import { SecureStorage, StorageData } from '../src/utils/storage';


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

    const stored = localStorage.getItem('mremote-connections')!;
    expect(() => JSON.parse(stored)).toThrow();
    const meta = JSON.parse(localStorage.getItem('mremote-storage-meta')!);
    expect(meta.isEncrypted).toBe(true);
  });
});
