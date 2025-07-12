import { describe, it, expect, beforeEach } from 'vitest';
import 'fake-indexeddb/auto';
import { openDB } from 'idb';
import { IndexedDbService } from '../indexedDbService';

const DB_NAME = 'mremote-keyval';
const STORE_NAME = 'keyval';

beforeEach(async () => {
  await IndexedDbService.init();
  const db = await openDB(DB_NAME, 1);
  await db.clear(STORE_NAME);
});

describe('IndexedDbService', () => {
  it('stores and retrieves objects', async () => {
    const value = { a: 1, b: 'two' };
    await IndexedDbService.setItem('obj', value);
    const result = await IndexedDbService.getItem<typeof value>('obj');
    expect(result).toEqual(value);
  });

  it('returns null for invalid JSON', async () => {
    const db = await openDB(DB_NAME, 1);
    await db.put(STORE_NAME, 'notjson', 'bad');
    const result = await IndexedDbService.getItem('bad');
    expect(result).toBeNull();
  });
});
