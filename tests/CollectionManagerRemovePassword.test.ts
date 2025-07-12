import { describe, it, expect, beforeEach } from 'vitest';
import { CollectionManager } from '../src/utils/collectionManager';
import 'fake-indexeddb/auto';
import { openDB } from 'idb';
import { IndexedDbService } from '../src/utils/indexedDbService';

describe('CollectionManager remove password', () => {
  let manager: CollectionManager;
  let collectionId: string;

  beforeEach(async () => {
    await IndexedDbService.init();
    const db = await openDB('mremote-keyval', 1);
    await db.clear('keyval');
    (CollectionManager as any).instance = undefined;
    manager = CollectionManager.getInstance();
    const col = await manager.createCollection('Secure', 'desc', true, 'secret');
    collectionId = col.id;
  });

  it('removes encryption with correct password', async () => {
    await manager.selectCollection(collectionId, 'secret');
    const storedBefore = await IndexedDbService.getItem<string>(`mremote-collection-${collectionId}`);
    expect(() => JSON.parse(storedBefore!)).toThrow();

    await manager.removePasswordFromCollection(collectionId, 'secret');
    const storedAfter = await IndexedDbService.getItem<string>(`mremote-collection-${collectionId}`);
    expect(JSON.parse(storedAfter!)).toBeTruthy();

    const meta = (await IndexedDbService.getItem<any[]>('mremote-collections'))![0];
    expect(meta.isEncrypted).toBe(false);
  });

  it('throws on wrong password', async () => {
    await expect(manager.removePasswordFromCollection(collectionId, 'bad')).rejects.toThrow();
  });
});
