import { describe, it, expect, beforeEach } from 'vitest';
import { CollectionManager } from '../src/utils/collectionManager';
import { LocalStorageService } from '../src/utils/localStorageService';
import { StorageData } from '../src/utils/storage';
import { ConnectionCollection } from '../src/types/connection';

describe('CollectionManager remove password', () => {
  let manager: CollectionManager;
  let collectionId: string;

  beforeEach(async () => {
    localStorage.clear();
    (CollectionManager as any).instance = undefined;
    manager = CollectionManager.getInstance();
    const col = await manager.createCollection('Secure', 'desc', true, 'secret');
    collectionId = col.id;
  });

  it('removes encryption with correct password', async () => {
    await manager.selectCollection(collectionId, 'secret');
    const storedBefore = LocalStorageService.getItem<string>(`mremote-collection-${collectionId}`);
    expect(typeof storedBefore).toBe('string');

    await manager.removePasswordFromCollection(collectionId, 'secret');
    const storedAfter = LocalStorageService.getItem<StorageData>(`mremote-collection-${collectionId}`)!;
    expect(storedAfter.connections).toBeTruthy();

    const meta = LocalStorageService.getItem<ConnectionCollection[]>('mremote-collections')![0];
    expect(meta.isEncrypted).toBe(false);
  });

  it('throws on wrong password', async () => {
    await expect(manager.removePasswordFromCollection(collectionId, 'bad')).rejects.toThrow();
  });
});
