import React from 'react';
import { describe, it, expect, beforeEach } from 'vitest';
import { renderHook, act } from '@testing-library/react';
import { ConnectionProvider, useConnections } from '../src/contexts/ConnectionContext';
import { CollectionManager } from '../src/utils/collectionManager';
import { IndexedDbService } from '../src/utils/indexedDbService';
import { openDB } from 'idb';
import { Connection } from '../src/types/connection';
import { StorageData } from '../src/utils/storage';

const DB_NAME = 'mremote-keyval';
const STORE_NAME = 'keyval';

function wrapper({ children }: { children: React.ReactNode }) {
  return <ConnectionProvider>{children}</ConnectionProvider>;
}

describe('ConnectionProvider auto-save', () => {
  let manager: CollectionManager;
  let collectionId: string;

  beforeEach(async () => {
    await IndexedDbService.init();
    const db = await openDB(DB_NAME, 1);
    await db.clear(STORE_NAME);
    CollectionManager.resetInstance();
    manager = CollectionManager.getInstance();
    const col = await manager.createCollection('Test');
    await manager.selectCollection(col.id);
    collectionId = col.id;
  });

  it('writes empty list after deleting all connections', async () => {
    const { result } = renderHook(() => useConnections(), { wrapper });

    const conn: Connection = {
      id: 'c1',
      name: 'c1',
      protocol: 'ssh',
      hostname: 'host',
      port: 22,
      isGroup: false,
      createdAt: new Date(),
      updatedAt: new Date(),
    } as Connection;

    await act(async () => {
      result.current.dispatch({ type: 'SET_CONNECTIONS', payload: [conn] });
    });

    await Promise.resolve();

    let stored = await IndexedDbService.getItem<StorageData>(
      `mremote-collection-${collectionId}`
    );
    expect(stored.connections).toHaveLength(1);

    await act(async () => {
      result.current.dispatch({ type: 'SET_CONNECTIONS', payload: [] });
    });

    await Promise.resolve();

    stored = await IndexedDbService.getItem<StorageData>(
      `mremote-collection-${collectionId}`
    );
    expect(stored.connections).toEqual([]);
  });
});
