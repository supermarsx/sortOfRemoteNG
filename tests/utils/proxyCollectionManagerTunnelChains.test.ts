import { describe, it, expect, vi, beforeEach } from 'vitest';
import { invoke } from '@tauri-apps/api/core';
import type { TunnelChainLayer } from '../../src/types/connection/connection';

// Get reference to the mocked invoke
const mockedInvoke = vi.mocked(invoke);

// We need a fresh manager per test since it's a singleton with internal state.
// We'll re-instantiate by accessing the class directly.
import { ProxyCollectionManager } from '../../src/utils/connection/proxyCollectionManager';

function createFreshManager(): ProxyCollectionManager {
  // Access private static field to reset singleton
  (ProxyCollectionManager as any).instance = undefined;
  return ProxyCollectionManager.getInstance();
}

const emptyData = {
  profiles: [],
  chains: [],
  tunnelChains: [],
  version: 1,
};

function makeSampleLayer(overrides?: Partial<TunnelChainLayer>): TunnelChainLayer {
  return {
    id: crypto.randomUUID(),
    type: 'proxy',
    enabled: true,
    proxy: { proxyType: 'socks5' as any, host: 'localhost', port: 1080 },
    ...overrides,
  };
}

describe('ProxyCollectionManager - Tunnel Chains', () => {
  let manager: ProxyCollectionManager;

  beforeEach(async () => {
    vi.clearAllMocks();

    // Track what gets saved so we can make subsequent reads return it
    let savedData = JSON.stringify(emptyData);

    mockedInvoke.mockImplementation(async (cmd: string, args?: any) => {
      if (cmd === 'read_app_data') {
        return savedData;
      }
      if (cmd === 'write_app_data') {
        savedData = (args as any).value;
        return undefined;
      }
      return undefined;
    });

    manager = createFreshManager();
    await manager.initialize();
  });

  // ──── getTunnelChains ────────────────────────────────────────────

  it('returns empty array when no tunnel chains exist', () => {
    const chains = manager.getTunnelChains();
    expect(chains).toEqual([]);
  });

  it('returns a defensive copy of tunnel chains', async () => {
    await manager.createTunnelChain('Chain A', [makeSampleLayer()]);
    const a = manager.getTunnelChains();
    const b = manager.getTunnelChains();
    expect(a).toEqual(b);
    expect(a).not.toBe(b); // different array reference
  });

  // ──── createTunnelChain ──────────────────────────────────────────

  it('creates a tunnel chain with required fields', async () => {
    const layer = makeSampleLayer();
    const chain = await manager.createTunnelChain('Test Chain', [layer]);

    expect(chain.name).toBe('Test Chain');
    expect(chain.id).toBeDefined();
    expect(typeof chain.id).toBe('string');
    expect(chain.layers).toHaveLength(1);
    expect(chain.layers[0].type).toBe('proxy');
    expect(chain.createdAt).toBeDefined();
    expect(chain.updatedAt).toBeDefined();
  });

  it('creates a tunnel chain with optional description and tags', async () => {
    const chain = await manager.createTunnelChain(
      'Tagged Chain',
      [makeSampleLayer()],
      { description: 'My test chain', tags: ['prod', 'vpn'] },
    );

    expect(chain.description).toBe('My test chain');
    expect(chain.tags).toEqual(['prod', 'vpn']);
  });

  it('creates a tunnel chain without optional fields', async () => {
    const chain = await manager.createTunnelChain('Bare Chain', [makeSampleLayer()]);

    expect(chain.description).toBeUndefined();
    expect(chain.tags).toBeUndefined();
  });

  it('persists created tunnel chain (calls write_app_data)', async () => {
    await manager.createTunnelChain('Persisted', [makeSampleLayer()]);

    const writeCalls = mockedInvoke.mock.calls.filter(c => c[0] === 'write_app_data');
    expect(writeCalls.length).toBeGreaterThanOrEqual(1);

    const lastWritten = JSON.parse((writeCalls[writeCalls.length - 1][1] as any).value);
    expect(lastWritten.tunnelChains).toHaveLength(1);
    expect(lastWritten.tunnelChains[0].name).toBe('Persisted');
  });

  it('creates multiple tunnel chains with unique ids', async () => {
    const a = await manager.createTunnelChain('A', [makeSampleLayer()]);
    const b = await manager.createTunnelChain('B', [makeSampleLayer()]);

    expect(a.id).not.toBe(b.id);
    expect(manager.getTunnelChains()).toHaveLength(2);
  });

  it('supports multiple layers in a single chain', async () => {
    const layers = [
      makeSampleLayer({ type: 'proxy' }),
      makeSampleLayer({ type: 'ssh-tunnel' }),
      makeSampleLayer({ type: 'ssh-jump' }),
    ];

    const chain = await manager.createTunnelChain('Multi-layer', layers);
    expect(chain.layers).toHaveLength(3);
    expect(chain.layers[0].type).toBe('proxy');
    expect(chain.layers[1].type).toBe('ssh-tunnel');
    expect(chain.layers[2].type).toBe('ssh-jump');
  });

  // ──── getTunnelChain ─────────────────────────────────────────────

  it('retrieves a tunnel chain by id', async () => {
    const created = await manager.createTunnelChain('Findable', [makeSampleLayer()]);
    const found = manager.getTunnelChain(created.id);

    expect(found).toBeDefined();
    expect(found!.id).toBe(created.id);
    expect(found!.name).toBe('Findable');
  });

  it('returns undefined for non-existent tunnel chain id', () => {
    const found = manager.getTunnelChain('non-existent-id');
    expect(found).toBeUndefined();
  });

  // ──── updateTunnelChain ──────────────────────────────────────────

  it('updates a tunnel chain name', async () => {
    const created = await manager.createTunnelChain('Original', [makeSampleLayer()]);
    const updated = await manager.updateTunnelChain(created.id, { name: 'Renamed' });

    expect(updated).not.toBeNull();
    expect(updated!.name).toBe('Renamed');
    expect(updated!.id).toBe(created.id);
    // updatedAt should be a valid ISO string
    expect(updated!.updatedAt).toBeDefined();
    expect(new Date(updated!.updatedAt).getTime()).not.toBeNaN();
  });

  it('updates tunnel chain description and tags', async () => {
    const created = await manager.createTunnelChain('Chain', [makeSampleLayer()]);
    const updated = await manager.updateTunnelChain(created.id, {
      description: 'Updated desc',
      tags: ['new-tag'],
    });

    expect(updated!.description).toBe('Updated desc');
    expect(updated!.tags).toEqual(['new-tag']);
  });

  it('updates tunnel chain layers', async () => {
    const created = await manager.createTunnelChain('Chain', [makeSampleLayer()]);
    const newLayers = [makeSampleLayer({ type: 'ssh-tunnel' }), makeSampleLayer({ type: 'ssh-jump' })];

    const updated = await manager.updateTunnelChain(created.id, { layers: newLayers });

    expect(updated!.layers).toHaveLength(2);
    expect(updated!.layers[0].type).toBe('ssh-tunnel');
    expect(updated!.layers[1].type).toBe('ssh-jump');
  });

  it('returns null when updating non-existent tunnel chain', async () => {
    const result = await manager.updateTunnelChain('bogus-id', { name: 'Nope' });
    expect(result).toBeNull();
  });

  it('preserves createdAt on update', async () => {
    const created = await manager.createTunnelChain('Chain', [makeSampleLayer()]);
    const updated = await manager.updateTunnelChain(created.id, { name: 'New Name' });

    expect(updated!.createdAt).toBe(created.createdAt);
  });

  // ──── deleteTunnelChain ──────────────────────────────────────────

  it('deletes an existing tunnel chain', async () => {
    const created = await manager.createTunnelChain('ToDelete', [makeSampleLayer()]);
    expect(manager.getTunnelChains()).toHaveLength(1);

    const result = await manager.deleteTunnelChain(created.id);
    expect(result).toBe(true);
    expect(manager.getTunnelChains()).toHaveLength(0);
  });

  it('returns false when deleting non-existent tunnel chain', async () => {
    const result = await manager.deleteTunnelChain('no-such-id');
    expect(result).toBe(false);
  });

  it('persists deletion (calls write_app_data)', async () => {
    const created = await manager.createTunnelChain('ToDelete', [makeSampleLayer()]);
    await manager.deleteTunnelChain(created.id);

    const writeCalls = mockedInvoke.mock.calls.filter(c => c[0] === 'write_app_data');
    const lastWritten = JSON.parse((writeCalls[writeCalls.length - 1][1] as any).value);
    expect(lastWritten.tunnelChains).toHaveLength(0);
  });

  it('does not affect other chains when deleting one', async () => {
    const a = await manager.createTunnelChain('Keep', [makeSampleLayer()]);
    const b = await manager.createTunnelChain('Delete', [makeSampleLayer()]);

    await manager.deleteTunnelChain(b.id);

    expect(manager.getTunnelChains()).toHaveLength(1);
    expect(manager.getTunnelChains()[0].id).toBe(a.id);
  });

  // ──── duplicateTunnelChain ───────────────────────────────────────

  it('duplicates a tunnel chain with default name', async () => {
    const original = await manager.createTunnelChain('My Chain', [makeSampleLayer()], {
      description: 'Desc',
      tags: ['tag1'],
    });

    const copy = await manager.duplicateTunnelChain(original.id);

    expect(copy).not.toBeNull();
    expect(copy!.name).toBe('My Chain (Copy)');
    expect(copy!.id).not.toBe(original.id);
    expect(copy!.description).toBe('Desc');
    expect(copy!.tags).toEqual(['tag1']);
    expect(copy!.layers).toHaveLength(original.layers.length);
    expect(manager.getTunnelChains()).toHaveLength(2);
  });

  it('duplicates a tunnel chain with custom name', async () => {
    const original = await manager.createTunnelChain('Original', [makeSampleLayer()]);
    const copy = await manager.duplicateTunnelChain(original.id, 'Custom Copy');

    expect(copy!.name).toBe('Custom Copy');
  });

  it('returns null when duplicating non-existent tunnel chain', async () => {
    const result = await manager.duplicateTunnelChain('no-such-id');
    expect(result).toBeNull();
  });

  it('duplicate has independent layers (not same reference)', async () => {
    const layer = makeSampleLayer();
    const original = await manager.createTunnelChain('Original', [layer]);
    const copy = await manager.duplicateTunnelChain(original.id);

    // Modifying the copy's layer shouldn't affect the original
    expect(copy!.layers[0]).not.toBe(original.layers[0]);
  });

  // ──── searchTunnelChains ─────────────────────────────────────────

  it('searches tunnel chains by name', async () => {
    await manager.createTunnelChain('Production VPN', [makeSampleLayer()]);
    await manager.createTunnelChain('Development SSH', [makeSampleLayer()]);
    await manager.createTunnelChain('Staging VPN', [makeSampleLayer()]);

    const results = manager.searchTunnelChains('vpn');
    expect(results).toHaveLength(2);
    expect(results.map(r => r.name)).toContain('Production VPN');
    expect(results.map(r => r.name)).toContain('Staging VPN');
  });

  it('searches tunnel chains by description', async () => {
    await manager.createTunnelChain('Chain A', [makeSampleLayer()], {
      description: 'Routes through datacenter',
    });
    await manager.createTunnelChain('Chain B', [makeSampleLayer()], {
      description: 'Direct connection',
    });

    const results = manager.searchTunnelChains('datacenter');
    expect(results).toHaveLength(1);
    expect(results[0].name).toBe('Chain A');
  });

  it('searches tunnel chains by tags', async () => {
    await manager.createTunnelChain('Chain A', [makeSampleLayer()], { tags: ['prod', 'secure'] });
    await manager.createTunnelChain('Chain B', [makeSampleLayer()], { tags: ['dev'] });

    const results = manager.searchTunnelChains('secure');
    expect(results).toHaveLength(1);
    expect(results[0].name).toBe('Chain A');
  });

  it('search is case-insensitive', async () => {
    await manager.createTunnelChain('UPPERCASE Chain', [makeSampleLayer()]);

    const results = manager.searchTunnelChains('uppercase');
    expect(results).toHaveLength(1);
  });

  it('returns empty array when search finds no matches', async () => {
    await manager.createTunnelChain('Some Chain', [makeSampleLayer()]);
    const results = manager.searchTunnelChains('nonexistent');
    expect(results).toEqual([]);
  });

  // ──── getTunnelChainsByTags ──────────────────────────────────────

  it('finds tunnel chains by tags', async () => {
    await manager.createTunnelChain('A', [makeSampleLayer()], { tags: ['prod', 'vpn'] });
    await manager.createTunnelChain('B', [makeSampleLayer()], { tags: ['dev'] });
    await manager.createTunnelChain('C', [makeSampleLayer()], { tags: ['prod', 'ssh'] });

    const results = manager.getTunnelChainsByTags(['prod']);
    expect(results).toHaveLength(2);
    expect(results.map(r => r.name)).toContain('A');
    expect(results.map(r => r.name)).toContain('C');
  });

  it('finds tunnel chains matching any of multiple tags', async () => {
    await manager.createTunnelChain('A', [makeSampleLayer()], { tags: ['vpn'] });
    await manager.createTunnelChain('B', [makeSampleLayer()], { tags: ['ssh'] });
    await manager.createTunnelChain('C', [makeSampleLayer()], { tags: ['rdp'] });

    const results = manager.getTunnelChainsByTags(['vpn', 'ssh']);
    expect(results).toHaveLength(2);
  });

  it('returns empty array when no chains have matching tags', async () => {
    await manager.createTunnelChain('A', [makeSampleLayer()], { tags: ['prod'] });
    const results = manager.getTunnelChainsByTags(['nonexistent']);
    expect(results).toEqual([]);
  });

  it('skips chains with no tags', async () => {
    await manager.createTunnelChain('No Tags', [makeSampleLayer()]);
    const results = manager.getTunnelChainsByTags(['anything']);
    expect(results).toEqual([]);
  });

  // ──── Backward compatibility ─────────────────────────────────────

  it('handles stored data without tunnelChains field', async () => {
    // Simulate legacy data that has no tunnelChains field
    mockedInvoke.mockImplementation(async (cmd: string) => {
      if (cmd === 'read_app_data') {
        return JSON.stringify({ profiles: [], chains: [], version: 1 });
      }
      if (cmd === 'write_app_data') {
        return undefined;
      }
      return undefined;
    });

    const mgr = createFreshManager();
    await mgr.initialize();

    // Should not throw, should return empty array
    expect(mgr.getTunnelChains()).toEqual([]);
  });

  // ──── Listener notifications ─────────────────────────────────────

  it('notifies listeners on create', async () => {
    const listener = vi.fn();
    manager.subscribe(listener);

    await manager.createTunnelChain('Chain', [makeSampleLayer()]);
    expect(listener).toHaveBeenCalled();
  });

  it('notifies listeners on update', async () => {
    const created = await manager.createTunnelChain('Chain', [makeSampleLayer()]);

    const listener = vi.fn();
    manager.subscribe(listener);

    await manager.updateTunnelChain(created.id, { name: 'Updated' });
    expect(listener).toHaveBeenCalled();
  });

  it('notifies listeners on delete', async () => {
    const created = await manager.createTunnelChain('Chain', [makeSampleLayer()]);

    const listener = vi.fn();
    manager.subscribe(listener);

    await manager.deleteTunnelChain(created.id);
    expect(listener).toHaveBeenCalled();
  });

  it('unsubscribe stops notifications', async () => {
    const listener = vi.fn();
    const unsub = manager.subscribe(listener);
    unsub();

    await manager.createTunnelChain('Chain', [makeSampleLayer()]);
    expect(listener).not.toHaveBeenCalled();
  });

  // ──── Import/Export with tunnel chains ───────────────────────────

  it('exports tunnel chains in JSON', async () => {
    await manager.createTunnelChain('Export Me', [makeSampleLayer()], {
      description: 'For export',
      tags: ['export'],
    });

    const exported = await manager.exportData();
    const parsed = JSON.parse(exported);

    expect(parsed.tunnelChains).toHaveLength(1);
    expect(parsed.tunnelChains[0].name).toBe('Export Me');
    expect(parsed.tunnelChains[0].description).toBe('For export');
    expect(parsed.tunnelChains[0].tags).toEqual(['export']);
  });

  it('imports tunnel chains (replace mode)', async () => {
    await manager.createTunnelChain('Existing', [makeSampleLayer()]);

    const importData = JSON.stringify({
      profiles: [],
      chains: [],
      tunnelChains: [
        {
          id: 'imported-1',
          name: 'Imported Chain',
          layers: [makeSampleLayer()],
          createdAt: new Date().toISOString(),
          updatedAt: new Date().toISOString(),
        },
      ],
      version: 1,
    });

    await manager.importData(importData, false);

    const chains = manager.getTunnelChains();
    expect(chains).toHaveLength(1);
    expect(chains[0].name).toBe('Imported Chain');
  });

  it('imports tunnel chains (merge mode, avoids duplicates by id)', async () => {
    const existing = await manager.createTunnelChain('Existing', [makeSampleLayer()]);

    const importData = JSON.stringify({
      profiles: [],
      chains: [],
      tunnelChains: [
        {
          id: existing.id, // same ID - should be skipped
          name: 'Duplicate',
          layers: [makeSampleLayer()],
          createdAt: new Date().toISOString(),
          updatedAt: new Date().toISOString(),
        },
        {
          id: 'new-import-id',
          name: 'New Import',
          layers: [makeSampleLayer()],
          createdAt: new Date().toISOString(),
          updatedAt: new Date().toISOString(),
        },
      ],
      version: 1,
    });

    await manager.importData(importData, true);

    const chains = manager.getTunnelChains();
    expect(chains).toHaveLength(2);
    expect(chains.map(c => c.name)).toContain('Existing');
    expect(chains.map(c => c.name)).toContain('New Import');
    expect(chains.map(c => c.name)).not.toContain('Duplicate');
  });

  it('imports data without tunnelChains field gracefully', async () => {
    const importData = JSON.stringify({
      profiles: [],
      chains: [],
      version: 1,
    });

    // Should not throw
    await manager.importData(importData, false);
    expect(manager.getTunnelChains()).toEqual([]);
  });
});
