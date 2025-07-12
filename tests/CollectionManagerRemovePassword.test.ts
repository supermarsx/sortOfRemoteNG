import { describe, it, expect, beforeEach } from 'vitest';
import { CollectionManager } from '../src/utils/collectionManager';
import 'fake-indexeddb/auto';
import { IndexedDbService } from '../src/utils/indexedDbService';
import { StorageData } from '../src/utils/storage';
import { ConnectionCollection } from '../src/types/connection';

describe('CollectionManager remove password', () => {
  let manager: CollectionManager;
  let collectionId: string;

  beforeEach(async () => {
    localStorage.clear();
    CollectionManager.resetInstance();
    manager = CollectionManager.getInstance();
    const col = await manager.createCollection('Secure', 'desc', true, 'secret');
    collectionId = col.id;
  });

  it('removes encryption with correct password', async () => {
    await manager.selectCollection(collectionId, 'secret');
    const storedBefore = await IndexedDbService.getItem<string>(`mremote-collection-${collectionId}`);
    expect(typeof storedBefore).toBe('string');

    await manager.removePasswordFromCollection(collectionId, 'secret');
    const storedAfter = await IndexedDbService.getItem<StorageData>(`mremote-collection-${collectionId}`)!;
    expect(storedAfter.connections).toBeTruthy();

    const meta = (await IndexedDbService.getItem<ConnectionCollection[]>('mremote-collections'))![0];
    expect(meta.isEncrypted).toBe(false);
  });

  it('throws on wrong password', async () => {
    await expect(manager.removePasswordFromCollection(collectionId, 'bad')).rejects.toThrow();
  });
});
