import React from 'react';
import { describe, it, expect, beforeEach } from 'vitest';
import { renderHook, act } from '@testing-library/react';
import { ConnectionProvider, useConnections } from '../src/contexts/ConnectionContext';
import { CollectionManager } from '../src/utils/collectionManager';
import 'fake-indexeddb/auto';
import { openDB } from 'idb';
import { IndexedDbService } from '../src/utils/indexedDbService';
import { Connection } from '../src/types/connection';

function wrapper({ children }: { children: React.ReactNode }) {
  return <ConnectionProvider>{children}</ConnectionProvider>;
}

describe('ConnectionProvider auto-save', () => {
  let manager: CollectionManager;
  let collectionId: string;

  beforeEach(async () => {
    await IndexedDbService.init();
    const db = await openDB('mremote-keyval', 1);
    await db.clear('keyval');
    (CollectionManager as any).instance = undefined;
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

    let stored = await IndexedDbService.getItem<any>(`mremote-collection-${collectionId}`);
    stored = JSON.parse(stored!);
    expect(stored.connections).toHaveLength(1);

    await act(async () => {
      result.current.dispatch({ type: 'SET_CONNECTIONS', payload: [] });
    });

    await Promise.resolve();

    stored = await IndexedDbService.getItem<any>(`mremote-collection-${collectionId}`);
    stored = JSON.parse(stored!);
    expect(stored.connections).toEqual([]);
  });
});
