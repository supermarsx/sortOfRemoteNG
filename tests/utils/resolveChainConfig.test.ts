import { describe, it, expect, vi, beforeEach } from 'vitest';

// ── Hoisted mocks ────────────────────────────────────────────────
const mocks = vi.hoisted(() => ({
  getChain: vi.fn(),
  getProfile: vi.fn(),
  getConnectionChain: vi.fn(),
}));

vi.mock('../../src/utils/connection/proxyCollectionManager', () => ({
  proxyCollectionManager: {
    getChain: mocks.getChain,
    getProfile: mocks.getProfile,
  },
}));

vi.mock('../../src/utils/network/proxyOpenVPNManager', () => ({
  ProxyOpenVPNManager: {
    getInstance: () => ({
      getConnectionChain: mocks.getConnectionChain,
    }),
  },
}));

import { resolveChainConfig } from '../../src/utils/ssh/resolveChainConfig';
import type { Connection, TunnelChainLayer } from '../../src/types/connection/connection';

// ── Helpers ──────────────────────────────────────────────────────

function makeConnection(overrides: Partial<Connection> = {}): Connection {
  return { id: 'conn-1', hostname: 'test.example.com', ...overrides } as Connection;
}

function makeLayer(overrides: Partial<TunnelChainLayer>): TunnelChainLayer {
  return {
    id: 'layer-default',
    type: 'proxy',
    enabled: true,
    ...overrides,
  } as TunnelChainLayer;
}

// ── Tests ────────────────────────────────────────────────────────

describe('resolveChainConfig', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  // ────────────────────────────────────────────────────────────────
  // 1. Empty connection (no chains configured)
  // ────────────────────────────────────────────────────────────────
  it('returns empty config for connection with no chains', async () => {
    const connection = makeConnection();
    const result = await resolveChainConfig(connection);

    expect(result.jump_hosts).toEqual([]);
    expect(result.proxy_config).toBeNull();
    expect(result.proxy_chain).toBeNull();
    expect(result.mixed_chain).toBeNull();
    expect(result.openvpn_config).toBeNull();
    expect(result.vpnPreSteps).toEqual([]);
  });

  // ────────────────────────────────────────────────────────────────
  // 2. tunnelChain: VPN layer
  // ────────────────────────────────────────────────────────────────
  describe('tunnelChain — VPN layers', () => {
    it('extracts OpenVPN pre-step from tunnelChain', async () => {
      const connection = makeConnection({
        security: {
          tunnelChain: [
            makeLayer({
              id: 'vpn-layer',
              type: 'openvpn',
              vpn: { configId: 'vpn-123' },
            }),
          ],
        },
      });

      const result = await resolveChainConfig(connection);

      expect(result.vpnPreSteps).toHaveLength(1);
      expect(result.vpnPreSteps[0].vpnType).toBe('openvpn');
      expect(result.vpnPreSteps[0].connectionId).toBe('vpn-layer');
      expect(result.vpnPreSteps[0].configId).toBe('vpn-123');
    });

    it('extracts WireGuard pre-step from tunnelChain', async () => {
      const connection = makeConnection({
        security: {
          tunnelChain: [
            makeLayer({
              id: 'wg-layer',
              type: 'wireguard',
              vpn: { configId: 'wg-456' },
            }),
          ],
        },
      });

      const result = await resolveChainConfig(connection);

      expect(result.vpnPreSteps).toHaveLength(1);
      expect(result.vpnPreSteps[0].vpnType).toBe('wireguard');
      expect(result.vpnPreSteps[0].configId).toBe('wg-456');
    });

    it('extracts Tailscale pre-step using mesh.networkId as configId', async () => {
      const connection = makeConnection({
        security: {
          tunnelChain: [
            makeLayer({
              id: 'ts-layer',
              type: 'tailscale',
              mesh: { networkId: 'ts-net-1' },
            }),
          ],
        },
      });

      const result = await resolveChainConfig(connection);

      expect(result.vpnPreSteps).toHaveLength(1);
      expect(result.vpnPreSteps[0].vpnType).toBe('tailscale');
      expect(result.vpnPreSteps[0].configId).toBe('ts-net-1');
    });

    it('extracts ZeroTier pre-step', async () => {
      const connection = makeConnection({
        security: {
          tunnelChain: [
            makeLayer({
              id: 'zt-layer',
              type: 'zerotier',
              mesh: { networkId: 'zt-net-1' },
            }),
          ],
        },
      });

      const result = await resolveChainConfig(connection);

      expect(result.vpnPreSteps).toHaveLength(1);
      expect(result.vpnPreSteps[0].vpnType).toBe('zerotier');
    });
  });

  // ────────────────────────────────────────────────────────────────
  // 3. tunnelChain: SSH jump layers
  // ────────────────────────────────────────────────────────────────
  describe('tunnelChain — SSH jump layers', () => {
    it('extracts a single jump host from tunnelChain', async () => {
      const connection = makeConnection({
        security: {
          tunnelChain: [
            makeLayer({
              id: 'ssh-layer',
              type: 'ssh-jump',
              sshTunnel: {
                host: 'jump.example.com',
                port: 22,
                username: 'jumpuser',
                password: 'pass',
                forwardType: 'local',
              },
            }),
          ],
        },
      });

      const result = await resolveChainConfig(connection);

      expect(result.jump_hosts).toHaveLength(1);
      expect(result.jump_hosts[0].host).toBe('jump.example.com');
      expect(result.jump_hosts[0].port).toBe(22);
      expect(result.jump_hosts[0].username).toBe('jumpuser');
      expect(result.jump_hosts[0].password).toBe('pass');
    });

    it('expands jumpHosts array into multiple jump_hosts', async () => {
      const connection = makeConnection({
        security: {
          tunnelChain: [
            makeLayer({
              id: 'multi-jump',
              type: 'ssh-jump',
              sshTunnel: {
                forwardType: 'local',
                jumpHosts: [
                  { host: 'hop1.test', port: 22, username: 'user1' },
                  { host: 'hop2.test', username: 'user2' },
                ],
              },
            }),
          ],
        },
      });

      const result = await resolveChainConfig(connection);

      expect(result.jump_hosts).toHaveLength(2);
      expect(result.jump_hosts[0].host).toBe('hop1.test');
      expect(result.jump_hosts[0].port).toBe(22);
      expect(result.jump_hosts[1].host).toBe('hop2.test');
      expect(result.jump_hosts[1].port).toBe(22); // default port
    });

    it('sets default port 22 when port is not provided', async () => {
      const connection = makeConnection({
        security: {
          tunnelChain: [
            makeLayer({
              id: 'ssh-layer',
              type: 'ssh-jump',
              sshTunnel: {
                host: 'jump.example.com',
                username: 'user',
                forwardType: 'local',
              },
            }),
          ],
        },
      });

      const result = await resolveChainConfig(connection);

      expect(result.jump_hosts[0].port).toBe(22);
    });

    it('includes private_key_path and passphrase when set', async () => {
      const connection = makeConnection({
        security: {
          tunnelChain: [
            makeLayer({
              id: 'ssh-key-layer',
              type: 'ssh-jump',
              sshTunnel: {
                host: 'jump.test',
                port: 2222,
                username: 'keyuser',
                privateKey: '/home/user/.ssh/id_rsa',
                passphrase: 'my-passphrase',
                forwardType: 'local',
              },
            }),
          ],
        },
      });

      const result = await resolveChainConfig(connection);

      expect(result.jump_hosts[0].private_key_path).toBe('/home/user/.ssh/id_rsa');
      expect(result.jump_hosts[0].private_key_passphrase).toBe('my-passphrase');
    });

    it('skips ssh-jump layers without sshTunnel config', async () => {
      const connection = makeConnection({
        security: {
          tunnelChain: [
            makeLayer({
              id: 'no-config',
              type: 'ssh-jump',
              // no sshTunnel property
            }),
          ],
        },
      });

      const result = await resolveChainConfig(connection);

      expect(result.jump_hosts).toHaveLength(0);
    });
  });

  // ────────────────────────────────────────────────────────────────
  // 4. tunnelChain: Single proxy layer
  // ────────────────────────────────────────────────────────────────
  describe('tunnelChain — proxy layers', () => {
    it('extracts proxy_config from a single proxy layer', async () => {
      const connection = makeConnection({
        security: {
          tunnelChain: [
            makeLayer({
              id: 'proxy-1',
              type: 'proxy',
              proxy: {
                proxyType: 'socks5',
                host: 'proxy.test',
                port: 1080,
                username: 'proxyuser',
                password: 'proxypass',
              },
            }),
          ],
        },
      });

      const result = await resolveChainConfig(connection);

      expect(result.proxy_config).not.toBeNull();
      expect(result.proxy_config!.proxy_type).toBe('socks5');
      expect(result.proxy_config!.host).toBe('proxy.test');
      expect(result.proxy_config!.port).toBe(1080);
      expect(result.proxy_config!.username).toBe('proxyuser');
      expect(result.proxy_config!.password).toBe('proxypass');
      expect(result.proxy_chain).toBeNull();
    });

    it('treats shadowsocks as a proxy layer', async () => {
      const connection = makeConnection({
        security: {
          tunnelChain: [
            makeLayer({
              id: 'ss-1',
              type: 'shadowsocks',
              proxy: {
                proxyType: 'socks5',
                host: 'ss.test',
                port: 8388,
              },
            }),
          ],
        },
      });

      const result = await resolveChainConfig(connection);

      expect(result.proxy_config).not.toBeNull();
      expect(result.proxy_config!.host).toBe('ss.test');
      expect(result.proxy_config!.port).toBe(8388);
    });

    it('builds proxy_chain when multiple proxy layers exist', async () => {
      const connection = makeConnection({
        security: {
          tunnelChain: [
            makeLayer({
              id: 'proxy-1',
              type: 'proxy',
              proxy: { proxyType: 'socks5', host: 'proxy1.test', port: 1080 },
            }),
            makeLayer({
              id: 'proxy-2',
              type: 'proxy',
              proxy: { proxyType: 'http', host: 'proxy2.test', port: 8080 },
            }),
          ],
        },
      });

      const result = await resolveChainConfig(connection);

      expect(result.proxy_config).toBeNull();
      expect(result.proxy_chain).not.toBeNull();
      expect(result.proxy_chain!.proxies).toHaveLength(2);
      expect(result.proxy_chain!.proxies[0].host).toBe('proxy1.test');
      expect(result.proxy_chain!.proxies[1].host).toBe('proxy2.test');
    });
  });

  // ────────────────────────────────────────────────────────────────
  // 5. tunnelChain: Mixed chain (SSH + proxy together)
  // ────────────────────────────────────────────────────────────────
  describe('tunnelChain — mixed chain', () => {
    it('builds mixed_chain when both SSH jump and proxy layers exist', async () => {
      const connection = makeConnection({
        security: {
          tunnelChain: [
            makeLayer({
              id: 'proxy-layer',
              type: 'proxy',
              proxy: { proxyType: 'socks5', host: 'proxy.test', port: 1080 },
            }),
            makeLayer({
              id: 'ssh-layer',
              type: 'ssh-jump',
              sshTunnel: {
                host: 'jump.test',
                port: 22,
                username: 'user',
                password: 'pass',
                forwardType: 'local',
              },
            }),
          ],
        },
      });

      const result = await resolveChainConfig(connection);

      expect(result.mixed_chain).not.toBeNull();
      expect(result.mixed_chain!.hops).toHaveLength(2);

      // Preserves original layer order
      expect(result.mixed_chain!.hops[0].type).toBe('proxy');
      expect(result.mixed_chain!.hops[0].host).toBe('proxy.test');
      expect(result.mixed_chain!.hops[1].type).toBe('ssh_jump');
      expect(result.mixed_chain!.hops[1].host).toBe('jump.test');

      // When mixed, proxy_config and jump_hosts should be empty
      expect(result.proxy_config).toBeNull();
      expect(result.proxy_chain).toBeNull();
      expect(result.jump_hosts).toEqual([]);
    });

    it('includes VPN pre-steps alongside mixed chain', async () => {
      const connection = makeConnection({
        security: {
          tunnelChain: [
            makeLayer({
              id: 'vpn-layer',
              type: 'openvpn',
              vpn: { configId: 'vpn-1' },
            }),
            makeLayer({
              id: 'proxy-layer',
              type: 'proxy',
              proxy: { proxyType: 'socks5', host: 'proxy.test', port: 1080 },
            }),
            makeLayer({
              id: 'ssh-layer',
              type: 'ssh-jump',
              sshTunnel: {
                host: 'jump.test',
                port: 22,
                username: 'user',
                forwardType: 'local',
              },
            }),
          ],
        },
      });

      const result = await resolveChainConfig(connection);

      expect(result.vpnPreSteps).toHaveLength(1);
      expect(result.vpnPreSteps[0].vpnType).toBe('openvpn');
      expect(result.mixed_chain).not.toBeNull();
      expect(result.mixed_chain!.hops).toHaveLength(2); // proxy + ssh only (VPN is separate)
    });

    it('skips VPN and unrecognized layers from mixed chain hops', async () => {
      const connection = makeConnection({
        security: {
          tunnelChain: [
            makeLayer({
              id: 'vpn-layer',
              type: 'openvpn',
              vpn: { configId: 'vpn-1' },
            }),
            makeLayer({
              id: 'tor-layer',
              type: 'tor' as any,
            }),
            makeLayer({
              id: 'proxy-layer',
              type: 'proxy',
              proxy: { proxyType: 'socks5', host: 'p.test', port: 1080 },
            }),
            makeLayer({
              id: 'ssh-layer',
              type: 'ssh-jump',
              sshTunnel: {
                host: 'j.test',
                port: 22,
                username: 'u',
                forwardType: 'local',
              },
            }),
          ],
        },
      });

      const result = await resolveChainConfig(connection);

      // VPN goes to vpnPreSteps, tor is ignored, only proxy+ssh make hops
      expect(result.vpnPreSteps).toHaveLength(1);
      expect(result.mixed_chain).not.toBeNull();
      expect(result.mixed_chain!.hops).toHaveLength(2);
    });
  });

  // ────────────────────────────────────────────────────────────────
  // 6. Disabled layers are skipped
  // ────────────────────────────────────────────────────────────────
  describe('tunnelChain — disabled layers', () => {
    it('skips disabled layers entirely', async () => {
      const connection = makeConnection({
        security: {
          tunnelChain: [
            makeLayer({
              id: 'disabled-vpn',
              type: 'openvpn',
              enabled: false,
              vpn: { configId: 'vpn-1' },
            }),
            makeLayer({
              id: 'enabled-ssh',
              type: 'ssh-jump',
              enabled: true,
              sshTunnel: {
                host: 'jump.test',
                port: 22,
                username: 'user',
                forwardType: 'local',
              },
            }),
          ],
        },
      });

      const result = await resolveChainConfig(connection);

      expect(result.vpnPreSteps).toHaveLength(0);
      expect(result.jump_hosts).toHaveLength(1);
    });

    it('returns empty config when all layers are disabled', async () => {
      const connection = makeConnection({
        security: {
          tunnelChain: [
            makeLayer({
              id: 'disabled-proxy',
              type: 'proxy',
              enabled: false,
              proxy: { proxyType: 'socks5', host: 'proxy.test', port: 1080 },
            }),
          ],
        },
      });

      const result = await resolveChainConfig(connection);

      expect(result.proxy_config).toBeNull();
      expect(result.jump_hosts).toEqual([]);
      expect(result.vpnPreSteps).toEqual([]);
    });
  });

  // ────────────────────────────────────────────────────────────────
  // 7. tunnelChain has priority — early return
  // ────────────────────────────────────────────────────────────────
  it('tunnelChain takes priority over proxyChainId (early return)', async () => {
    const connection = makeConnection({
      proxyChainId: 'chain-1',
      security: {
        tunnelChain: [
          makeLayer({
            id: 'ssh-layer',
            type: 'ssh-jump',
            sshTunnel: {
              host: 'direct.test',
              port: 22,
              username: 'user',
              forwardType: 'local',
            },
          }),
        ],
      },
    });

    const result = await resolveChainConfig(connection);

    expect(result.jump_hosts).toHaveLength(1);
    expect(result.jump_hosts[0].host).toBe('direct.test');
    // proxyChainId should NOT have been resolved because tunnelChain returns early
    expect(mocks.getChain).not.toHaveBeenCalled();
  });

  // ────────────────────────────────────────────────────────────────
  // 8. proxyChainId resolution — pure proxy
  // ────────────────────────────────────────────────────────────────
  describe('proxyChainId resolution', () => {
    it('resolves a single proxy profile from saved chain', async () => {
      mocks.getChain.mockReturnValue({
        id: 'chain-1',
        name: 'Office Chain',
        layers: [
          { position: 0, type: 'proxy', proxyProfileId: 'prof-1' },
        ],
      });
      mocks.getProfile.mockReturnValue({
        id: 'prof-1',
        config: {
          type: 'socks5',
          host: 'socks.office',
          port: 1080,
          username: 'admin',
          password: 'secret',
        },
      });

      const connection = makeConnection({ proxyChainId: 'chain-1' });
      const result = await resolveChainConfig(connection);

      expect(mocks.getChain).toHaveBeenCalledWith('chain-1');
      expect(mocks.getProfile).toHaveBeenCalledWith('prof-1');
      expect(result.proxy_config).not.toBeNull();
      expect(result.proxy_config!.proxy_type).toBe('socks5');
      expect(result.proxy_config!.host).toBe('socks.office');
      expect(result.proxy_config!.port).toBe(1080);
      expect(result.proxy_config!.username).toBe('admin');
    });

    it('builds proxy_chain for multiple proxy profiles', async () => {
      mocks.getChain.mockReturnValue({
        id: 'chain-multi',
        name: 'Multi-Proxy',
        layers: [
          { position: 0, type: 'proxy', proxyProfileId: 'prof-1' },
          { position: 1, type: 'proxy', proxyProfileId: 'prof-2' },
        ],
        dynamics: { hopTimeoutMs: 5000 },
      });
      mocks.getProfile.mockImplementation((id: string) => {
        if (id === 'prof-1') {
          return {
            id: 'prof-1',
            config: { type: 'socks5', host: 'proxy1.test', port: 1080 },
          };
        }
        if (id === 'prof-2') {
          return {
            id: 'prof-2',
            config: { type: 'http', host: 'proxy2.test', port: 8080 },
          };
        }
        return undefined;
      });

      const connection = makeConnection({ proxyChainId: 'chain-multi' });
      const result = await resolveChainConfig(connection);

      expect(result.proxy_config).toBeNull();
      expect(result.proxy_chain).not.toBeNull();
      expect(result.proxy_chain!.proxies).toHaveLength(2);
      expect(result.proxy_chain!.proxies[0].host).toBe('proxy1.test');
      expect(result.proxy_chain!.proxies[1].host).toBe('proxy2.test');
      expect(result.proxy_chain!.hop_timeout_ms).toBe(5000);
    });

    it('returns empty when getChain returns undefined', async () => {
      mocks.getChain.mockReturnValue(undefined);

      const connection = makeConnection({ proxyChainId: 'nonexistent' });
      const result = await resolveChainConfig(connection);

      expect(mocks.getChain).toHaveBeenCalledWith('nonexistent');
      expect(result.proxy_config).toBeNull();
      expect(result.proxy_chain).toBeNull();
      expect(result.jump_hosts).toEqual([]);
    });

    it('sorts saved chain layers by position', async () => {
      mocks.getChain.mockReturnValue({
        id: 'chain-sorted',
        name: 'Out of Order',
        layers: [
          { position: 2, type: 'proxy', proxyProfileId: 'prof-b' },
          { position: 0, type: 'proxy', proxyProfileId: 'prof-a' },
        ],
      });
      mocks.getProfile.mockImplementation((id: string) => {
        if (id === 'prof-a') {
          return { id: 'prof-a', config: { type: 'socks5', host: 'first.test', port: 1080 } };
        }
        if (id === 'prof-b') {
          return { id: 'prof-b', config: { type: 'http', host: 'second.test', port: 8080 } };
        }
        return undefined;
      });

      const connection = makeConnection({ proxyChainId: 'chain-sorted' });
      const result = await resolveChainConfig(connection);

      expect(result.proxy_chain!.proxies[0].host).toBe('first.test');
      expect(result.proxy_chain!.proxies[1].host).toBe('second.test');
    });

    it('extracts VPN pre-steps from saved chain', async () => {
      mocks.getChain.mockReturnValue({
        id: 'chain-vpn',
        name: 'VPN Chain',
        layers: [
          { position: 0, type: 'openvpn', vpnProfileId: 'vpn-prof-1' },
          { position: 1, type: 'wireguard', vpnProfileId: 'wg-prof-1' },
        ],
      });

      const connection = makeConnection({ proxyChainId: 'chain-vpn' });
      const result = await resolveChainConfig(connection);

      expect(result.vpnPreSteps).toHaveLength(2);
      expect(result.vpnPreSteps[0].vpnType).toBe('openvpn');
      expect(result.vpnPreSteps[0].connectionId).toBe('vpn-prof-1');
      expect(result.vpnPreSteps[0].configId).toBe('vpn-prof-1');
      expect(result.vpnPreSteps[1].vpnType).toBe('wireguard');
    });

    it('resolves SSH jump hosts from saved chain inlineConfig', async () => {
      mocks.getChain.mockReturnValue({
        id: 'chain-ssh',
        name: 'SSH Chain',
        layers: [
          {
            position: 0,
            type: 'ssh-jump',
            inlineConfig: {
              host: 'jump.saved.test',
              port: 2222,
              username: 'saveduser',
              password: 'savedpass',
            },
          },
        ],
      });

      const connection = makeConnection({ proxyChainId: 'chain-ssh' });
      const result = await resolveChainConfig(connection);

      expect(result.jump_hosts).toHaveLength(1);
      expect(result.jump_hosts[0].host).toBe('jump.saved.test');
      expect(result.jump_hosts[0].port).toBe(2222);
      expect(result.jump_hosts[0].username).toBe('saveduser');
      expect(result.jump_hosts[0].password).toBe('savedpass');
    });

    it('expands jumpChain from saved chain SSH inlineConfig', async () => {
      mocks.getChain.mockReturnValue({
        id: 'chain-multi-jump',
        name: 'Multi Jump',
        layers: [
          {
            position: 0,
            type: 'ssh-jump',
            inlineConfig: {
              host: 'primary.test',
              port: 22,
              username: 'user',
              jumpChain: [
                { host: 'hop1.test', port: 22, username: 'hop1user' },
                { host: 'hop2.test', username: 'hop2user' },
              ],
            },
          },
        ],
      });

      const connection = makeConnection({ proxyChainId: 'chain-multi-jump' });
      const result = await resolveChainConfig(connection);

      // jumpChain takes precedence over the inline host
      expect(result.jump_hosts).toHaveLength(2);
      expect(result.jump_hosts[0].host).toBe('hop1.test');
      expect(result.jump_hosts[1].host).toBe('hop2.test');
      expect(result.jump_hosts[1].port).toBe(22); // default
    });

    it('builds mixed_chain from saved chain with proxy and SSH layers', async () => {
      mocks.getChain.mockReturnValue({
        id: 'chain-mixed',
        name: 'Mixed',
        layers: [
          {
            position: 0,
            type: 'proxy',
            proxyProfileId: 'prof-1',
          },
          {
            position: 1,
            type: 'ssh-jump',
            inlineConfig: {
              host: 'jump.test',
              port: 22,
              username: 'user',
            },
          },
        ],
        dynamics: { hopTimeoutMs: 3000 },
      });
      mocks.getProfile.mockReturnValue({
        id: 'prof-1',
        config: { type: 'socks5', host: 'proxy.test', port: 1080 },
      });

      const connection = makeConnection({ proxyChainId: 'chain-mixed' });
      const result = await resolveChainConfig(connection);

      expect(result.mixed_chain).not.toBeNull();
      expect(result.mixed_chain!.hops).toHaveLength(2);
      expect(result.mixed_chain!.hops[0].type).toBe('proxy');
      expect(result.mixed_chain!.hops[0].host).toBe('proxy.test');
      expect(result.mixed_chain!.hops[1].type).toBe('ssh_jump');
      expect(result.mixed_chain!.hops[1].host).toBe('jump.test');
      expect(result.mixed_chain!.hop_timeout_ms).toBe(3000);
    });

    it('skips proxy layers without a profile match', async () => {
      mocks.getChain.mockReturnValue({
        id: 'chain-no-profile',
        name: 'Missing Profile',
        layers: [
          { position: 0, type: 'proxy', proxyProfileId: 'nonexistent' },
        ],
      });
      mocks.getProfile.mockReturnValue(undefined);

      const connection = makeConnection({ proxyChainId: 'chain-no-profile' });
      const result = await resolveChainConfig(connection);

      expect(result.proxy_config).toBeNull();
      expect(result.proxy_chain).toBeNull();
    });
  });

  // ────────────────────────────────────────────────────────────────
  // 9. connectionChainId resolution (via ProxyOpenVPNManager)
  // ────────────────────────────────────────────────────────────────
  describe('connectionChainId resolution', () => {
    it('resolves OpenVPN from connection chain', async () => {
      mocks.getConnectionChain.mockResolvedValue({
        layers: [
          { position: 0, connection_type: 'OpenVPN', connection_id: 'ovpn-1' },
        ],
      });

      const connection = makeConnection({ connectionChainId: 'cc-1' });
      const result = await resolveChainConfig(connection);

      expect(mocks.getConnectionChain).toHaveBeenCalledWith('cc-1');
      expect(result.vpnPreSteps).toHaveLength(1);
      expect(result.vpnPreSteps[0].vpnType).toBe('openvpn');
      expect(result.vpnPreSteps[0].connectionId).toBe('ovpn-1');
      expect(result.openvpn_config).not.toBeNull();
      expect(result.openvpn_config!.connection_id).toBe('ovpn-1');
      expect(result.openvpn_config!.chain_position).toBe(0);
    });

    it('resolves WireGuard, Tailscale, and ZeroTier from connection chain', async () => {
      mocks.getConnectionChain.mockResolvedValue({
        layers: [
          { position: 0, connection_type: 'WireGuard', connection_id: 'wg-1' },
          { position: 1, connection_type: 'Tailscale', connection_id: 'ts-1' },
          { position: 2, connection_type: 'ZeroTier', connection_id: 'zt-1' },
        ],
      });

      const connection = makeConnection({ connectionChainId: 'cc-2' });
      const result = await resolveChainConfig(connection);

      expect(result.vpnPreSteps).toHaveLength(3);
      expect(result.vpnPreSteps[0].vpnType).toBe('wireguard');
      expect(result.vpnPreSteps[1].vpnType).toBe('tailscale');
      expect(result.vpnPreSteps[2].vpnType).toBe('zerotier');
    });

    it('resolves Proxy from connection chain with default socks5 type', async () => {
      mocks.getConnectionChain.mockResolvedValue({
        layers: [
          { position: 0, connection_type: 'Proxy', connection_id: 'p-1', local_port: 9050 },
        ],
      });

      const connection = makeConnection({ connectionChainId: 'cc-proxy' });
      const result = await resolveChainConfig(connection);

      expect(result.proxy_config).not.toBeNull();
      expect(result.proxy_config!.proxy_type).toBe('socks5');
      expect(result.proxy_config!.port).toBe(9050);
    });

    it('only sets openvpn_config for the first OpenVPN layer', async () => {
      mocks.getConnectionChain.mockResolvedValue({
        layers: [
          { position: 0, connection_type: 'OpenVPN', connection_id: 'ovpn-1' },
          { position: 1, connection_type: 'OpenVPN', connection_id: 'ovpn-2' },
        ],
      });

      const connection = makeConnection({ connectionChainId: 'cc-multi-vpn' });
      const result = await resolveChainConfig(connection);

      expect(result.vpnPreSteps).toHaveLength(2);
      expect(result.openvpn_config!.connection_id).toBe('ovpn-1');
    });

    it('sorts connection chain layers by position', async () => {
      mocks.getConnectionChain.mockResolvedValue({
        layers: [
          { position: 2, connection_type: 'Tailscale', connection_id: 'ts-1' },
          { position: 0, connection_type: 'OpenVPN', connection_id: 'ovpn-1' },
        ],
      });

      const connection = makeConnection({ connectionChainId: 'cc-sort' });
      const result = await resolveChainConfig(connection);

      // OpenVPN (position 0) should come first
      expect(result.vpnPreSteps[0].vpnType).toBe('openvpn');
      expect(result.vpnPreSteps[1].vpnType).toBe('tailscale');
    });

    it('handles getConnectionChain returning null/empty', async () => {
      mocks.getConnectionChain.mockResolvedValue(null);

      const connection = makeConnection({ connectionChainId: 'cc-empty' });
      const result = await resolveChainConfig(connection);

      expect(result.vpnPreSteps).toEqual([]);
      expect(result.openvpn_config).toBeNull();
    });

    it('handles getConnectionChain throwing an error gracefully', async () => {
      mocks.getConnectionChain.mockRejectedValue(new Error('network error'));
      const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});

      const connection = makeConnection({ connectionChainId: 'cc-error' });
      const result = await resolveChainConfig(connection);

      expect(result.vpnPreSteps).toEqual([]);
      expect(result.openvpn_config).toBeNull();
      expect(warnSpy).toHaveBeenCalledWith(
        expect.stringContaining('Failed to resolve connection chain'),
        expect.any(Error),
      );

      warnSpy.mockRestore();
    });
  });

  // ────────────────────────────────────────────────────────────────
  // 10. Both proxyChainId and connectionChainId (not mutually exclusive)
  // ────────────────────────────────────────────────────────────────
  it('resolves both proxyChainId and connectionChainId when both present', async () => {
    mocks.getChain.mockReturnValue({
      id: 'chain-1',
      name: 'Proxy Chain',
      layers: [
        { position: 0, type: 'proxy', proxyProfileId: 'prof-1' },
      ],
    });
    mocks.getProfile.mockReturnValue({
      id: 'prof-1',
      config: { type: 'socks5', host: 'proxy.test', port: 1080 },
    });
    mocks.getConnectionChain.mockResolvedValue({
      layers: [
        { position: 0, connection_type: 'OpenVPN', connection_id: 'ovpn-1' },
      ],
    });

    const connection = makeConnection({
      proxyChainId: 'chain-1',
      connectionChainId: 'cc-1',
    });
    const result = await resolveChainConfig(connection);

    // Both should be resolved
    expect(result.proxy_config).not.toBeNull();
    expect(result.vpnPreSteps).toHaveLength(1);
    expect(result.openvpn_config).not.toBeNull();
  });

  // ────────────────────────────────────────────────────────────────
  // 11. Legacy security.proxy fallback
  // ────────────────────────────────────────────────────────────────
  describe('legacy security fallbacks', () => {
    it('falls back to legacy security.proxy when no chains', async () => {
      const connection = makeConnection({
        security: {
          proxy: {
            type: 'socks5',
            host: 'legacy-proxy.test',
            port: 1080,
            username: 'legacyuser',
            password: 'legacypass',
            enabled: true,
          },
        },
      }) as any;

      const result = await resolveChainConfig(connection);

      expect(result.proxy_config).not.toBeNull();
      expect(result.proxy_config!.proxy_type).toBe('socks5');
      expect(result.proxy_config!.host).toBe('legacy-proxy.test');
      expect(result.proxy_config!.port).toBe(1080);
      expect(result.proxy_config!.username).toBe('legacyuser');
      expect(result.proxy_config!.password).toBe('legacypass');
    });

    it('falls back to legacy security.openvpn when no chains', async () => {
      const connection = makeConnection({
        security: {
          openvpn: {
            enabled: true,
            configId: 'legacy-vpn-1',
            chainPosition: 0,
          },
        },
      }) as any;

      const result = await resolveChainConfig(connection);

      expect(result.openvpn_config).not.toBeNull();
      expect(result.openvpn_config!.connection_id).toBe('legacy-vpn-1');
      expect(result.openvpn_config!.chain_position).toBe(0);
      expect(result.vpnPreSteps).toHaveLength(1);
      expect(result.vpnPreSteps[0].vpnType).toBe('openvpn');
      expect(result.vpnPreSteps[0].connectionId).toBe('legacy-vpn-1');
      expect(result.vpnPreSteps[0].configId).toBe('legacy-vpn-1');
    });

    it('uses connection.id as fallback when openvpn.configId is missing', async () => {
      const connection = makeConnection({
        id: 'my-conn-id',
        security: {
          openvpn: {
            enabled: true,
          },
        },
      }) as any;

      const result = await resolveChainConfig(connection);

      expect(result.openvpn_config!.connection_id).toBe('my-conn-id');
      expect(result.vpnPreSteps[0].connectionId).toBe('my-conn-id');
    });

    it('does NOT use legacy openvpn when enabled is false', async () => {
      const connection = makeConnection({
        security: {
          openvpn: {
            enabled: false,
            configId: 'disabled-vpn',
          },
        },
      }) as any;

      const result = await resolveChainConfig(connection);

      expect(result.openvpn_config).toBeNull();
      expect(result.vpnPreSteps).toEqual([]);
    });

    it('resolves both legacy proxy and openvpn simultaneously', async () => {
      const connection = makeConnection({
        security: {
          proxy: {
            type: 'http',
            host: 'proxy.legacy',
            port: 8080,
            enabled: true,
          },
          openvpn: {
            enabled: true,
            configId: 'vpn-legacy',
          },
        },
      }) as any;

      const result = await resolveChainConfig(connection);

      expect(result.proxy_config).not.toBeNull();
      expect(result.proxy_config!.host).toBe('proxy.legacy');
      expect(result.openvpn_config).not.toBeNull();
      expect(result.openvpn_config!.connection_id).toBe('vpn-legacy');
    });

    it('does NOT use legacy security when proxyChainId is present', async () => {
      mocks.getChain.mockReturnValue(undefined);

      const connection = makeConnection({
        proxyChainId: 'chain-1',
        security: {
          proxy: {
            type: 'socks5',
            host: 'legacy.test',
            port: 1080,
            enabled: true,
          },
        },
      }) as any;

      const result = await resolveChainConfig(connection);

      // Legacy should be skipped because proxyChainId is set
      expect(result.proxy_config).toBeNull();
    });

    it('does NOT use legacy security when connectionChainId is present', async () => {
      mocks.getConnectionChain.mockResolvedValue(null);

      const connection = makeConnection({
        connectionChainId: 'cc-1',
        security: {
          proxy: {
            type: 'socks5',
            host: 'legacy.test',
            port: 1080,
            enabled: true,
          },
        },
      }) as any;

      const result = await resolveChainConfig(connection);

      // Legacy should be skipped because connectionChainId is set
      expect(result.proxy_config).toBeNull();
    });

    it('returns empty when security is undefined and no chains', async () => {
      const connection = makeConnection({ security: undefined }) as any;
      const result = await resolveChainConfig(connection);

      expect(result.proxy_config).toBeNull();
      expect(result.openvpn_config).toBeNull();
      expect(result.vpnPreSteps).toEqual([]);
    });
  });

  // ────────────────────────────────────────────────────────────────
  // 12. Edge cases
  // ────────────────────────────────────────────────────────────────
  describe('edge cases', () => {
    it('handles empty tunnelChain array (falls through to next priority)', async () => {
      mocks.getChain.mockReturnValue(undefined);

      const connection = makeConnection({
        proxyChainId: 'chain-1',
        security: {
          tunnelChain: [], // empty array — falsy length
        },
      });

      const result = await resolveChainConfig(connection);

      // Should NOT take the tunnelChain path because length is 0
      // Should try proxyChainId instead
      expect(mocks.getChain).toHaveBeenCalledWith('chain-1');
    });

    it('handles proxy layer without proxy config object', async () => {
      const connection = makeConnection({
        security: {
          tunnelChain: [
            makeLayer({
              id: 'proxy-no-config',
              type: 'proxy',
              // proxy property missing
            }),
          ],
        },
      });

      const result = await resolveChainConfig(connection);

      // Single proxy layer but with no proxy object
      expect(result.proxy_config).toBeNull();
    });

    it('handles multiple proxy layers where some lack config', async () => {
      const connection = makeConnection({
        security: {
          tunnelChain: [
            makeLayer({
              id: 'proxy-valid',
              type: 'proxy',
              proxy: { proxyType: 'socks5', host: 'valid.test', port: 1080 },
            }),
            makeLayer({
              id: 'proxy-no-config',
              type: 'proxy',
              // no proxy object
            }),
          ],
        },
      });

      const result = await resolveChainConfig(connection);

      // proxy_chain filters out null proxy objects
      expect(result.proxy_chain).not.toBeNull();
      expect(result.proxy_chain!.proxies).toHaveLength(1);
      expect(result.proxy_chain!.proxies[0].host).toBe('valid.test');
    });

    it('handles connection chain with empty layers array', async () => {
      mocks.getConnectionChain.mockResolvedValue({ layers: [] });

      const connection = makeConnection({ connectionChainId: 'cc-empty-layers' });
      const result = await resolveChainConfig(connection);

      expect(result.vpnPreSteps).toEqual([]);
    });

    it('handles connection chain with unknown connection_type', async () => {
      mocks.getConnectionChain.mockResolvedValue({
        layers: [
          { position: 0, connection_type: 'UnknownType', connection_id: 'x-1' },
        ],
      });

      const connection = makeConnection({ connectionChainId: 'cc-unknown' });
      const result = await resolveChainConfig(connection);

      expect(result.vpnPreSteps).toEqual([]);
      expect(result.proxy_config).toBeNull();
    });

    it('sets null for optional fields that are undefined', async () => {
      const connection = makeConnection({
        security: {
          tunnelChain: [
            makeLayer({
              id: 'ssh-minimal',
              type: 'ssh-jump',
              sshTunnel: {
                host: 'minimal.test',
                forwardType: 'local',
                // no password, privateKey, passphrase, agentForwarding
              },
            }),
          ],
        },
      });

      const result = await resolveChainConfig(connection);

      const jump = result.jump_hosts[0];
      expect(jump.host).toBe('minimal.test');
      expect(jump.password).toBeNull();
      expect(jump.private_key_path).toBeNull();
      expect(jump.private_key_passphrase).toBeNull();
    });
  });
});
