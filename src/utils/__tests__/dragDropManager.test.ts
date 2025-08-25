import { describe, it, expect, beforeEach } from 'vitest';
import { DragDropManager, DragDropResult } from '../dragDropManager';
import { Connection } from '../../types/connection';

const baseDate = new Date();

function makeConnection(partial: Partial<Connection>): Connection {
  return {
    id: 'id',
    name: 'name',
    protocol: 'ssh',
    hostname: 'host',
    port: 22,
    isGroup: false,
    createdAt: baseDate,
    updatedAt: baseDate,
    ...partial,
  } as Connection;
}

describe('DragDropManager.processDropResult', () => {
  let manager: DragDropManager;
  let connections: Connection[];

  beforeEach(() => {
    manager = new DragDropManager();
    connections = [
      makeConnection({ id: 'group1', name: 'Group1', isGroup: true }),
      makeConnection({ id: 'item1', name: 'Item1', parentId: 'group1' }),
      makeConnection({ id: 'group2', name: 'Group2', isGroup: true }),
    ];
  });

  it('moves connection inside a group', () => {
    const result: DragDropResult = { draggedId: 'item1', targetId: 'group2', position: 'inside' };
    const updated = manager.processDropResult(result, connections);
    const item = updated.find(c => c.id === 'item1')!;
    expect(item.parentId).toBe('group2');
    expect(updated.map(c => c.id)).toEqual(['group1', 'group2', 'item1']);
  });

  it('moves connection before another', () => {
    const result: DragDropResult = { draggedId: 'item1', targetId: 'group2', position: 'before' };
    const updated = manager.processDropResult(result, connections);
    const item = updated.find(c => c.id === 'item1')!;
    expect(item.parentId).toBeUndefined();
    expect(updated.map(c => c.id)).toEqual(['group1', 'item1', 'group2']);
  });

  it('moves connection to root when dropped on root level', () => {
    const result: DragDropResult = { draggedId: 'item1', targetId: null, position: 'after' };
    const updated = manager.processDropResult(result, connections);
    const item = updated.find(c => c.id === 'item1')!;
    expect(item.parentId).toBeUndefined();
    expect(updated.map(c => c.id)).toEqual(['group1', 'group2', 'item1']);
  });
});
