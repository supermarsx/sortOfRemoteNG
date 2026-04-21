import { describe, it, expect } from 'vitest';
import { parseWireGuardConf } from '../../src/utils/network/parseWireGuardConf';

describe('parseWireGuardConf', () => {
  it('parses a complete WireGuard config', () => {
    const conf = `[Interface]
PrivateKey = yAnz5TF+lXXJte14tji3zlMNq+hd2rYUIgJBgB3fBmk=
Address = 10.0.0.2/32, fd00::2/128
DNS = 1.1.1.1, 8.8.8.8
MTU = 1420

[Peer]
PublicKey = xTIBA5rboUvnH4htodjb6e697QjLERt1NAB4mZqp8Dg=
PresharedKey = AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA=
Endpoint = vpn.example.com:51820
AllowedIPs = 0.0.0.0/0, ::/0
PersistentKeepalive = 25`;

    const result = parseWireGuardConf(conf);

    expect(result.interface.privateKey).toBe('yAnz5TF+lXXJte14tji3zlMNq+hd2rYUIgJBgB3fBmk=');
    expect(result.interface.address).toEqual(['10.0.0.2/32', 'fd00::2/128']);
    expect(result.interface.dns).toEqual(['1.1.1.1', '8.8.8.8']);
    expect(result.interface.mtu).toBe(1420);

    expect(result.peer.publicKey).toBe('xTIBA5rboUvnH4htodjb6e697QjLERt1NAB4mZqp8Dg=');
    expect(result.peer.presharedKey).toBe('AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA=');
    expect(result.peer.endpoint).toBe('vpn.example.com:51820');
    expect(result.peer.allowedIPs).toEqual(['0.0.0.0/0', '::/0']);
    expect(result.peer.persistentKeepalive).toBe(25);
  });

  it('handles minimal config with only required fields', () => {
    const conf = `[Interface]
PrivateKey = abc123=

[Peer]
PublicKey = xyz789=
AllowedIPs = 0.0.0.0/0`;

    const result = parseWireGuardConf(conf);

    expect(result.interface.privateKey).toBe('abc123=');
    expect(result.interface.address).toEqual([]);
    expect(result.interface.dns).toBeUndefined();
    expect(result.interface.mtu).toBeUndefined();

    expect(result.peer.publicKey).toBe('xyz789=');
    expect(result.peer.presharedKey).toBeUndefined();
    expect(result.peer.endpoint).toBeUndefined();
    expect(result.peer.allowedIPs).toEqual(['0.0.0.0/0']);
    expect(result.peer.persistentKeepalive).toBeUndefined();
  });

  it('ignores comments and empty lines', () => {
    const conf = `# This is a comment
; This is also a comment

[Interface]
# Private key for client
PrivateKey = testkey=
Address = 10.0.0.2/32

[Peer]
# Server public key
PublicKey = serverkey=
AllowedIPs = 0.0.0.0/0`;

    const result = parseWireGuardConf(conf);
    expect(result.interface.privateKey).toBe('testkey=');
    expect(result.peer.publicKey).toBe('serverkey=');
  });

  it('handles PreUp/PostUp/PreDown/PostDown scripts', () => {
    const conf = `[Interface]
PrivateKey = testkey=
Address = 10.0.0.2/32
PreUp = iptables -A FORWARD -i wg0 -j ACCEPT
PostUp = iptables -t nat -A POSTROUTING -o eth0 -j MASQUERADE
PreDown = iptables -D FORWARD -i wg0 -j ACCEPT
PostDown = iptables -t nat -D POSTROUTING -o eth0 -j MASQUERADE

[Peer]
PublicKey = serverkey=
AllowedIPs = 0.0.0.0/0`;

    const result = parseWireGuardConf(conf);
    expect(result.interface.preUp).toContain('iptables -A FORWARD -i wg0 -j ACCEPT');
    expect(result.interface.postUp).toContain('iptables -t nat -A POSTROUTING -o eth0 -j MASQUERADE');
    expect(result.interface.preDown).toContain('iptables -D FORWARD -i wg0 -j ACCEPT');
    expect(result.interface.postDown).toContain('iptables -t nat -D POSTROUTING -o eth0 -j MASQUERADE');
  });

  it('handles empty config', () => {
    const conf = '';
    const result = parseWireGuardConf(conf);
    expect(result.interface.privateKey).toBe('');
    expect(result.peer.publicKey).toBe('');
  });

  it('handles config with no [Peer] section', () => {
    const conf = `[Interface]
PrivateKey = testkey=
Address = 10.0.0.2/32`;

    const result = parseWireGuardConf(conf);
    expect(result.interface.privateKey).toBe('testkey=');
    expect(result.peer.publicKey).toBe('');
    expect(result.peer.allowedIPs).toEqual(['0.0.0.0/0']);
  });

  it('handles keys with equals signs in values', () => {
    // Base64 keys often end with = or ==
    const conf = `[Interface]
PrivateKey = yAnz5TF+lXXJte14tji3zlMNq+hd2rYUIgJBgB3fBmk=

[Peer]
PublicKey = xTIBA5rboUvnH4htodjb6e697QjLERt1NAB4mZqp8Dg==
AllowedIPs = 0.0.0.0/0`;

    const result = parseWireGuardConf(conf);
    // Key with single = should work
    expect(result.interface.privateKey).toBe('yAnz5TF+lXXJte14tji3zlMNq+hd2rYUIgJBgB3fBmk=');
    // Key with double == should also work (the parser splits on first = only)
    expect(result.peer.publicKey).toContain('xTIBA5rboUvnH4htodjb6e697QjLERt1NAB4mZqp8Dg');
  });

  it('is case-insensitive for section headers', () => {
    const conf = `[interface]
PrivateKey = testkey=

[peer]
PublicKey = serverkey=
AllowedIPs = 10.0.0.0/8`;

    const result = parseWireGuardConf(conf);
    expect(result.interface.privateKey).toBe('testkey=');
    expect(result.peer.publicKey).toBe('serverkey=');
  });

  it('handles single address without comma', () => {
    const conf = `[Interface]
PrivateKey = testkey=
Address = 10.0.0.2/32

[Peer]
PublicKey = serverkey=
AllowedIPs = 10.0.0.0/8`;

    const result = parseWireGuardConf(conf);
    expect(result.interface.address).toEqual(['10.0.0.2/32']);
    expect(result.peer.allowedIPs).toEqual(['10.0.0.0/8']);
  });

  it('handles extra whitespace around values', () => {
    const conf = `[Interface]
PrivateKey =   testkey=
Address =  10.0.0.2/32 ,  fd00::2/128

[Peer]
PublicKey =   serverkey=
Endpoint =  vpn.example.com:51820
AllowedIPs = 0.0.0.0/0`;

    const result = parseWireGuardConf(conf);
    expect(result.interface.privateKey).toBe('testkey=');
    expect(result.interface.address).toEqual(['10.0.0.2/32', 'fd00::2/128']);
    expect(result.peer.publicKey).toBe('serverkey=');
    expect(result.peer.endpoint).toBe('vpn.example.com:51820');
  });
});
