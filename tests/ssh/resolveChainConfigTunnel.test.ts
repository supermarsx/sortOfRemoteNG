import { describe, it, expect } from 'vitest';
import { resolveChainConfig } from '../../src/utils/ssh/resolveChainConfig';
import type { Connection, TunnelChainLayer } from '../../src/types/connection/connection';

// ──────────────────────────────────────────────────────────────────
// t19-e6 — runtime resolver (resolveChainConfig.ts) for imported
// mRemoteNG tunnels. Asserts the e3-implemented contract:
//   R1 — 'ssh-tunnel' layers are treated as jump hosts (not dropped)
//   R2 — a non-empty tunnelChain no longer early-returns an EMPTY config
//   R4 — sshTunnel.connectionId references resolve against the passed
//        connections list when the inline host is missing
//
// These are pure-logic paths (no Tauri/proxy lookups), so they run
// without mocking the backend.
// ──────────────────────────────────────────────────────────────────

/** Minimal connection carrying a single tunnelChain layer. */
function targetWithLayer(layer: TunnelChainLayer): Connection {
  return {
    id: 'target-1',
    name: 'Target',
    protocol: 'ssh',
    hostname: '10.0.0.1',
    port: 22,
    security: { tunnelChain: [layer] },
  } as unknown as Connection;
}

describe('resolveChainConfig — imported mRemoteNG tunnel layers', () => {
  it('R1: an enabled ssh-tunnel layer with inline host resolves to a jump host', async () => {
    const conn = targetWithLayer({
      id: 'layer-1',
      type: 'ssh-tunnel',
      enabled: true,
      name: 'mRemoteNG SSH tunnel via Bastion',
      localBindHost: '127.0.0.1',
      localBindPort: 0,
      sshTunnel: {
        forwardType: 'local',
        host: 'bastion.example.com',
        port: 2222,
        username: 'jump',
        password: 'secret',
        remoteHost: '10.0.0.1',
        remotePort: 22,
      },
    } as unknown as TunnelChainLayer);

    const res = await resolveChainConfig(conn);
    expect(res.jump_hosts).toHaveLength(1);
    expect(res.jump_hosts[0]).toMatchObject({
      host: 'bastion.example.com',
      port: 2222,
      username: 'jump',
      password: 'secret',
    });
  });

  it('R1: an ssh-jump layer is likewise resolved as a jump host', async () => {
    const conn = targetWithLayer({
      id: 'layer-1',
      type: 'ssh-jump',
      enabled: true,
      sshTunnel: {
        forwardType: 'local',
        host: 'jump.example.com',
        port: 22,
        username: 'ops',
      },
    } as unknown as TunnelChainLayer);

    const res = await resolveChainConfig(conn);
    expect(res.jump_hosts).toHaveLength(1);
    expect(res.jump_hosts[0].host).toBe('jump.example.com');
  });

  it('R2: a non-empty tunnelChain that resolves a jump host does NOT yield an empty config', async () => {
    const conn = targetWithLayer({
      id: 'layer-1',
      type: 'ssh-tunnel',
      enabled: true,
      sshTunnel: {
        forwardType: 'local',
        host: 'bastion.example.com',
        port: 22,
        username: 'jump',
        remoteHost: '10.0.0.1',
        remotePort: 22,
      },
    } as unknown as TunnelChainLayer);

    const res = await resolveChainConfig(conn);
    // The old "non-empty chain ⇒ early-return empty config" trap (R2) would
    // have produced jump_hosts.length === 0 here.
    expect(res.jump_hosts.length).toBeGreaterThan(0);
  });

  it('R4: a connectionId-only layer resolves host/creds from the passed connections list', async () => {
    const bastion = {
      id: 'bastion-1',
      name: 'Edge Bastion',
      protocol: 'ssh',
      hostname: 'bastion.example.com',
      port: 2222,
      username: 'jump',
      password: 'secret',
    } as unknown as Connection;

    const conn = targetWithLayer({
      id: 'layer-1',
      type: 'ssh-jump',
      enabled: true,
      sshTunnel: {
        forwardType: 'local',
        // No inline host — only a reference, as the Rust path may emit.
        connectionId: 'bastion-1',
        remoteHost: '10.0.0.1',
        remotePort: 22,
      },
    } as unknown as TunnelChainLayer);

    const res = await resolveChainConfig(conn, [bastion, conn]);
    expect(res.jump_hosts).toHaveLength(1);
    expect(res.jump_hosts[0]).toMatchObject({
      host: 'bastion.example.com',
      port: 2222,
      username: 'jump',
      password: 'secret',
    });
  });

  it('R4: inline host wins over the connectionId reference (post-inheritance creds not overwritten)', async () => {
    const bastion = {
      id: 'bastion-1',
      name: 'Edge Bastion',
      protocol: 'ssh',
      hostname: 'stale.example.com',
      port: 22,
      username: 'stale',
      password: 'stale',
    } as unknown as Connection;

    const conn = targetWithLayer({
      id: 'layer-1',
      type: 'ssh-jump',
      enabled: true,
      sshTunnel: {
        forwardType: 'local',
        connectionId: 'bastion-1',
        host: 'fresh.example.com',
        port: 2200,
        username: 'fresh',
        password: 'fresh',
      },
    } as unknown as TunnelChainLayer);

    const res = await resolveChainConfig(conn, [bastion, conn]);
    expect(res.jump_hosts[0]).toMatchObject({
      host: 'fresh.example.com',
      port: 2200,
      username: 'fresh',
      password: 'fresh',
    });
  });

  it('a disabled layer is skipped (yields no jump host)', async () => {
    const conn = targetWithLayer({
      id: 'layer-1',
      type: 'ssh-tunnel',
      enabled: false,
      sshTunnel: {
        forwardType: 'local',
        // unresolved jump host: no host, no connectionId
        remoteHost: '10.0.0.1',
        remotePort: 22,
      },
    } as unknown as TunnelChainLayer);

    const res = await resolveChainConfig(conn);
    expect(res.jump_hosts).toHaveLength(0);
  });
});
