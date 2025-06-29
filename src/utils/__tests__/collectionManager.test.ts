import { describe, it, expect, beforeEach } from 'vitest';
import { CollectionManager } from '../collectionManager';

const sampleData = { connections: [], settings: {}, timestamp: 1 };

describe('CollectionManager', () => {
  let manager: CollectionManager;

  beforeEach(() => {
    localStorage.clear();
    manager = new CollectionManager();
  });

  it('creates and persists a collection', async () => {
    const col = await manager.createCollection('Test');
    const stored = JSON.parse(localStorage.getItem('mremote-collections')!);
    expect(stored).toHaveLength(1);
    expect(stored[0].id).toBe(col.id);
    expect(stored[0].name).toBe('Test');
  });

  it('loads collection data', async () => {
    localStorage.setItem('mremote-collection-abc', JSON.stringify(sampleData));
    const loaded = await manager.loadCollectionData('abc');
    expect(loaded).toEqual(sampleData);
  });

  it('generates export filenames', () => {
    const a = manager.generateExportFilename();
    const b = manager.generateExportFilename();
    expect(a).toMatch(/sortofremoteng-exports-.*\.json/);
    expect(b).toMatch(/sortofremoteng-exports-.*\.json/);
    expect(a).not.toBe(b);
  });

  it('updates and persists changes to a collection', async () => {
    const col = await manager.createCollection('Initial', 'desc');
    const updated = { ...col, name: 'Updated', description: 'changed' };
    manager.updateCollection(updated);

    const stored = JSON.parse(localStorage.getItem('mremote-collections')!);
    expect(stored[0].name).toBe('Updated');
    expect(stored[0].description).toBe('changed');
  });
});
