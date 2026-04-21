import React from 'react';
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { renderHook, act } from '@testing-library/react';
import { ConnectionProvider } from '../../src/contexts/ConnectionContext';
import { useConnections } from '../../src/contexts/useConnections';
import { CollectionManager } from '../../src/utils/connection/collectionManager';
import { IndexedDbService } from '../../src/utils/storage/indexedDbService';
import { openDB } from 'idb';
import { Connection } from '../../src/types/connection/connection';
import { StorageData } from '../../src/utils/storage/storage';

const DB_NAME = 'mremote-keyval';
const STORE_NAME = 'keyval';

function wrapper({ children }: { children: React.ReactNode }) {
  return <ConnectionProvider>{children}</ConnectionProvider>;
}

/** Flush the 500ms debounce timer and all pending micro-tasks. */
async function flushSave() {
  // Advance past the 500ms debounce
  await act(async () => {
    vi.advanceTimersByTime(600);
  });
  // Flush any remaining micro-tasks from the async save
  await act(async () => {
    await vi.runAllTimersAsync();
  });
}

describe('ConnectionProvider auto-save', () => {
  let manager: CollectionManager;
  let collectionId: string;

  beforeEach(async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    await IndexedDbService.init();
    const db = await openDB(DB_NAME, 1);
    await db.clear(STORE_NAME);
    CollectionManager.resetInstance();
    manager = CollectionManager.getInstance();
    const col = await manager.createCollection('Test');
    await manager.selectCollection(col.id);
    collectionId = col.id;
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('writes empty list after deleting all connections', async () => {
    const { result } = renderHook(() => useConnections(), { wrapper });

    // Must call loadData first to enable auto-save
    await act(async () => {
      await result.current.loadData();
    });

    const conn: Connection = {
      id: 'c1',
      name: 'c1',
      protocol: 'ssh',
      hostname: 'host',
      port: 22,
      isGroup: false,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    } as Connection;

    await act(async () => {
      result.current.dispatch({ type: 'SET_CONNECTIONS', payload: [conn] });
    });

    await flushSave();

    let stored = await IndexedDbService.getItem<StorageData>(
      `mremote-collection-${collectionId}`
    );
    expect(stored!.connections).toHaveLength(1);

    await act(async () => {
      result.current.dispatch({ type: 'SET_CONNECTIONS', payload: [] });
    });

    await flushSave();

    stored = await IndexedDbService.getItem<StorageData>(
      `mremote-collection-${collectionId}`
    );
    expect(stored!.connections).toEqual([]);
  });

  it('auto-saves after updating a connection', async () => {
    const { result } = renderHook(() => useConnections(), { wrapper });

    await act(async () => {
      await result.current.loadData();
    });

    const conn: Connection = {
      id: 'u1',
      name: 'original',
      protocol: 'ssh',
      hostname: 'host',
      port: 22,
      isGroup: false,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    } as Connection;

    await act(async () => {
      result.current.dispatch({ type: 'SET_CONNECTIONS', payload: [conn] });
    });
    await flushSave();

    const updated = { ...conn, name: 'renamed' };
    await act(async () => {
      result.current.dispatch({ type: 'UPDATE_CONNECTION', payload: updated });
    });
    await flushSave();

    const stored = await IndexedDbService.getItem<StorageData>(
      `mremote-collection-${collectionId}`
    );
    expect(stored!.connections).toHaveLength(1);
    expect(stored!.connections[0].name).toBe('renamed');
  });

  it('auto-saves after adding a connection', async () => {
    const { result } = renderHook(() => useConnections(), { wrapper });

    await act(async () => {
      await result.current.loadData();
    });

    const conn: Connection = {
      id: 'a1',
      name: 'added',
      protocol: 'rdp',
      hostname: 'newhost',
      port: 3389,
      isGroup: false,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    } as Connection;

    await act(async () => {
      result.current.dispatch({ type: 'ADD_CONNECTION', payload: conn });
    });
    await flushSave();

    const stored = await IndexedDbService.getItem<StorageData>(
      `mremote-collection-${collectionId}`
    );
    expect(stored!.connections).toHaveLength(1);
    expect(stored!.connections[0].id).toBe('a1');
  });

  it('persists the latest state after multiple rapid updates', async () => {
    const { result } = renderHook(() => useConnections(), { wrapper });

    await act(async () => {
      await result.current.loadData();
    });

    const conn1: Connection = {
      id: 'r1',
      name: 'first',
      protocol: 'ssh',
      hostname: 'h1',
      port: 22,
      isGroup: false,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    } as Connection;
    const conn2: Connection = {
      id: 'r2',
      name: 'second',
      protocol: 'rdp',
      hostname: 'h2',
      port: 3389,
      isGroup: false,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    } as Connection;

    await act(async () => {
      result.current.dispatch({ type: 'SET_CONNECTIONS', payload: [conn1] });
    });
    await act(async () => {
      result.current.dispatch({ type: 'SET_CONNECTIONS', payload: [conn1, conn2] });
    });
    await flushSave();

    const stored = await IndexedDbService.getItem<StorageData>(
      `mremote-collection-${collectionId}`
    );
    expect(stored!.connections).toHaveLength(2);
  });

  it('auto-save handles errors gracefully', async () => {
    const { result } = renderHook(() => useConnections(), { wrapper });

    await act(async () => {
      await result.current.loadData();
    });

    const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
    const saveSpy = vi.spyOn(
      CollectionManager.getInstance(),
      'saveCurrentCollectionData' as any,
    ).mockRejectedValueOnce(new Error('DB write failed'));

    const conn: Connection = {
      id: 'e1',
      name: 'err',
      protocol: 'ssh',
      hostname: 'host',
      port: 22,
      isGroup: false,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    } as Connection;

    await act(async () => {
      result.current.dispatch({ type: 'SET_CONNECTIONS', payload: [conn] });
    });
    await flushSave();

    expect(errorSpy).toHaveBeenCalled();

    errorSpy.mockRestore();
    saveSpy.mockRestore();
  });
});
