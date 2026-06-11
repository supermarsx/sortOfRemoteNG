import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import {
  importFromMRemoteNG,
  encryptMRemoteNGXml,
  decryptMRemoteNGXml,
} from '../../src/components/ImportExport/utils';
import type { Connection } from '../../src/types/connection/connection';

// ──────────────────────────────────────────────────────────────────
// t19-e6 — frontend mRemoteNG tunnel import (importer layer)
//
// Asserts the §1.4 contract actually emitted by importFromMRemoteNG
// (src/components/ImportExport/utils.ts, verified against the e1 log):
//   - tunnelChain layer type is 'ssh-jump' for SSH targets, 'ssh-tunnel'
//     for non-SSH targets
//   - inline host/port/username/password from the resolved jump host
//   - sshTunnel.connectionId kept as a re-resolution reference
//   - InheritSSHTunnelConnectionName default is FALSE (absent ⇒ no tunnel)
//   - container credential inheritance (InheritUsername/Password) flows
//     into the jump host's inlined creds
//   - unresolved jump host ⇒ disabled layer, no inline host
// ──────────────────────────────────────────────────────────────────

const CONF_CONS_TUNNELS_XML = readFileSync(
  resolve(__dirname, 'fixtures', 'confCons-tunnels.xml'),
  'utf8',
);

/** First tunnelChain layer of a named connection, or undefined. */
function tunnelLayerOf(conns: Connection[], name: string) {
  const conn = conns.find((c) => c.name === name);
  return conn?.security?.tunnelChain?.[0];
}

describe('importFromMRemoteNG — SSHTunnelConnectionName tunnels (fixture)', () => {
  it('imports the full fixture tree without throwing', async () => {
    const conns = await importFromMRemoteNG(CONF_CONS_TUNNELS_XML);
    // 3 containers + 6 connections.
    expect(conns.length).toBeGreaterThanOrEqual(9);
    expect(conns.find((c) => c.name === 'Edge Bastion')?.protocol).toBe('ssh');
  });

  it('named tunnel on a non-SSH (RDP) target → ssh-tunnel layer with inline jump-host creds', async () => {
    const conns = await importFromMRemoteNG(CONF_CONS_TUNNELS_XML);
    const layer = tunnelLayerOf(conns, 'Internal RDP');
    const bastion = conns.find((c) => c.name === 'Edge Bastion');

    expect(layer).toMatchObject({
      type: 'ssh-tunnel',
      enabled: true,
      localBindHost: '127.0.0.1',
      localBindPort: 0,
      sshTunnel: {
        forwardType: 'local',
        host: 'bastion.example.com',
        port: 2222,
        username: 'jump',
        password: 'secret',
        remoteHost: '10.10.0.25',
        remotePort: 3389,
      },
    });
    // connectionId reference kept, and points at the resolved jump host.
    expect(layer?.sshTunnel?.connectionId).toBe(bastion?.id);
    expect(layer?.name).toContain('Edge Bastion');
  });

  it('named tunnel on an SSH target → ssh-jump layer (resolver consumes it as a jump host)', async () => {
    const conns = await importFromMRemoteNG(CONF_CONS_TUNNELS_XML);
    const layer = tunnelLayerOf(conns, 'Internal SSH');

    expect(layer?.type).toBe('ssh-jump');
    expect(layer?.enabled).toBe(true);
    expect(layer?.sshTunnel?.remoteHost).toBe('10.10.0.40');
    expect(layer?.sshTunnel?.remotePort).toBe(22);
  });

  it('jump host inherits container credentials (InheritUsername/Password) and inlines them into the tunnel', async () => {
    const conns = await importFromMRemoteNG(CONF_CONS_TUNNELS_XML);

    // The DC Jump node itself imported with the container's creds (R7).
    const dcJump = conns.find((c) => c.name === 'DC Jump');
    expect(dcJump?.username).toBe('dcadmin');
    expect(dcJump?.password).toBe('dcpass');

    // And the tunnel that routes through it carries those creds inline.
    const layer = tunnelLayerOf(conns, 'Internal SSH');
    expect(layer?.sshTunnel).toMatchObject({
      host: 'dc-jump.example.com',
      port: 22,
      username: 'dcadmin',
      password: 'dcpass',
    });
    expect(layer?.sshTunnel?.connectionId).toBe(dcJump?.id);
  });

  it('inherited tunnel attaches when InheritSSHTunnelConnectionName="true"', async () => {
    const conns = await importFromMRemoteNG(CONF_CONS_TUNNELS_XML);
    const layer = tunnelLayerOf(conns, 'Inherited RDP');

    expect(layer).toBeDefined();
    expect(layer?.type).toBe('ssh-tunnel'); // RDP target
    expect(layer?.enabled).toBe(true);
    // Inherited from the "Tunneled Group" container → Edge Bastion.
    expect(layer?.sshTunnel?.host).toBe('bastion.example.com');
    expect(layer?.sshTunnel?.remoteHost).toBe('10.20.0.5');
  });

  it('does NOT attach an inherited tunnel when the inherit flag is absent (R6 default-false)', async () => {
    const conns = await importFromMRemoteNG(CONF_CONS_TUNNELS_XML);
    const noInherit = conns.find((c) => c.name === 'No-Inherit RDP');

    expect(noInherit).toBeDefined();
    // Sibling of "Inherited RDP" under the same tunneled container, but with
    // no InheritSSHTunnelConnectionName attribute → mRemoteNG default false.
    expect(noInherit?.security?.tunnelChain ?? []).toHaveLength(0);
  });

  it('unresolved jump host (name has no matching SSH connection) → disabled layer with no inline host', async () => {
    const conns = await importFromMRemoteNG(CONF_CONS_TUNNELS_XML);
    const layer = tunnelLayerOf(conns, 'Orphan RDP');

    expect(layer).toBeDefined();
    expect(layer?.enabled).toBe(false);
    expect(layer?.sshTunnel?.host).toBeUndefined();
    expect(layer?.sshTunnel?.connectionId).toBeUndefined();
    // Target details are still carried so the user can repair the reference.
    expect(layer?.sshTunnel?.remoteHost).toBe('10.30.0.9');
    expect(layer?.name).toContain('Ghost Host');
  });

  it('first-in-tree-order wins when two SSH connections share a tunnel name (R8)', async () => {
    const dupXml = `<?xml version="1.0" encoding="utf-8"?>
<Connections Name="Connections" ConfVersion="2.7">
  <Node Name="Bastion" Type="Connection" Protocol="SSH2"
    Hostname="first.example.com" Port="22" Username="first" Password="p1" />
  <Node Name="Bastion" Type="Connection" Protocol="SSH2"
    Hostname="second.example.com" Port="22" Username="second" Password="p2" />
  <Node Name="Target" Type="Connection" Protocol="RDP"
    Hostname="10.0.0.9" Port="3389" SSHTunnelConnectionName="Bastion" />
</Connections>`;

    const conns = await importFromMRemoteNG(dupXml);
    const layer = tunnelLayerOf(conns, 'Target');
    expect(layer?.sshTunnel?.host).toBe('first.example.com');
    expect(layer?.sshTunnel?.username).toBe('first');
  });
});

describe('importFromMRemoteNG — encrypted per-field jump-host password survives decrypt → import', () => {
  it('round-trips an encrypted bastion Password into an inline tunnel credential', async () => {
    const plain = `<?xml version="1.0" encoding="utf-8"?>
<Connections Name="Connections" ConfVersion="2.7">
  <Node Name="Edge Bastion" Type="Connection" Protocol="SSH2"
    Hostname="bastion.example.com" Port="2222" Username="jump" Password="topsecret" />
  <Node Name="Internal RDP" Type="Connection" Protocol="RDP"
    Hostname="10.10.0.25" Port="3389" Username="admin"
    SSHTunnelConnectionName="Edge Bastion" />
</Connections>`;

    const encrypted = await encryptMRemoteNGXml(plain, { password: 'master-pw' });
    // The per-field password is no longer plaintext in the encrypted file.
    expect(encrypted).not.toContain('Password="topsecret"');

    const decrypted = await decryptMRemoteNGXml(encrypted, 'master-pw');
    const conns = await importFromMRemoteNG(decrypted);
    const layer = tunnelLayerOf(conns, 'Internal RDP');

    expect(layer?.type).toBe('ssh-tunnel');
    expect(layer?.enabled).toBe(true);
    expect(layer?.sshTunnel?.host).toBe('bastion.example.com');
    expect(layer?.sshTunnel?.password).toBe('topsecret');
  });
});
