import React from 'react';
import { describe, it, expect, beforeEach } from 'vitest';
import { renderHook, act } from '@testing-library/react';
import { ConnectionProvider, useConnections } from '../src/contexts/ConnectionContext';
import { CollectionManager } from '../src/utils/collectionManager';
import { LocalStorageService } from '../src/utils/localStorageService';
import { Connection } from '../src/types/connection';
import { StorageData } from '../src/utils/storage';

function wrapper({ children }: { children: React.ReactNode }) {
  return <ConnectionProvider>{children}</ConnectionProvider>;
}

describe('ConnectionProvider auto-save', () => {
  let manager: CollectionManager;
  let collectionId: string;

  beforeEach(async () => {
    localStorage.clear();
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

    let stored = LocalStorageService.getItem<StorageData>(`mremote-collection-${collectionId}`)!;
    expect(stored.connections).toHaveLength(1);

    await act(async () => {
      result.current.dispatch({ type: 'SET_CONNECTIONS', payload: [] });
    });

    await Promise.resolve();

    stored = LocalStorageService.getItem<StorageData>(`mremote-collection-${collectionId}`)!;
    expect(stored.connections).toEqual([]);
  });
});
