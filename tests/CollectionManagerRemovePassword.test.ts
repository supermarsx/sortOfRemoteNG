import { describe, it, expect, beforeEach } from 'vitest';
import { CollectionManager } from '../src/utils/collectionManager';

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
    const storedBefore = localStorage.getItem(`mremote-collection-${collectionId}`)!;
    expect(() => JSON.parse(storedBefore)).toThrow();

    await manager.removePasswordFromCollection(collectionId, 'secret');
    const storedAfter = localStorage.getItem(`mremote-collection-${collectionId}`)!;
    expect(JSON.parse(storedAfter)).toBeTruthy();

    const meta = JSON.parse(localStorage.getItem('mremote-collections')!)[0];
    expect(meta.isEncrypted).toBe(false);
  });

  it('throws on wrong password', async () => {
    await expect(manager.removePasswordFromCollection(collectionId, 'bad')).rejects.toThrow();
  });
});
