/**
 * Resolves a Connection's chain/tunnel/proxy associations into concrete
 * SSH connection config fields that can be sent to the Rust backend.
 *
 * Resolution priority:
 *   0. `tunnelChainId` — reference to a SavedTunnelChain (with profile resolution)
 *   1. Modern `tunnelChain` (most flexible, inline layers)
 *   2. `proxyChainId` — look up a saved proxy chain
 *   3. `connectionChainId` — look up a connection chain via Tauri
 *   4. Legacy `security.proxy` / `security.openvpn` / `security.sshTunnel`
 */

import type { Connection, TunnelChainLayer } from '../../types/connection/connection';
import { proxyCollectionManager } from '../connection/proxyCollectionManager';
import { ProxyOpenVPNManager } from '../network/proxyOpenVPNManager';
import type { SavedChainLayer, SSHJumpConfig } from '../../types/settings/vpnSettings';

// ── Result types ──────────────────────────────────────────────────

export interface VpnPreStep {
  vpnType: 'openvpn' | 'wireguard' | 'tailscale' | 'zerotier';
  connectionId: string;
  configId?: string;
}

export interface ResolvedJumpHost {
  host: string;
  port: number;
  username: string;
  password?: string | null;
  private_key_path?: string | null;
  private_key_passphrase?: string | null;
  agent_forwarding?: boolean;
  totp_secret?: string | null;
  keyboard_interactive_responses?: string[];
  preferred_ciphers?: string[];
  preferred_macs?: string[];
  preferred_kex?: string[];
  preferred_host_key_algorithms?: string[];
}

export interface ResolvedProxyConfig {
  proxy_type: string;
  host: string;
  port: number;
  username?: string | null;
  password?: string | null;
}

export interface ResolvedProxyChain {
  proxies: ResolvedProxyConfig[];
  mode?: string;
  hop_timeout_ms?: number;
}

export interface ResolvedMixedChainHop {
  type: 'ssh_jump' | 'proxy';
  // SSH jump fields
  host?: string;
  port?: number;
  username?: string;
  password?: string | null;
  private_key_path?: string | null;
  private_key_passphrase?: string | null;
  agent_forwarding?: boolean;
  // Proxy fields
  proxy_type?: string;
}

export interface ResolvedMixedChain {
  hops: ResolvedMixedChainHop[];
  hop_timeout_ms?: number;
}

export interface ResolvedChainConfig {
  jump_hosts: ResolvedJumpHost[];
  proxy_config: ResolvedProxyConfig | null;
  proxy_chain: ResolvedProxyChain | null;
  mixed_chain: ResolvedMixedChain | null;
  openvpn_config: { connection_id: string; chain_position?: number } | null;
  vpnPreSteps: VpnPreStep[];
}

// ── Main entry point ──────────────────────────────────────────────

export async function resolveChainConfig(
  connection: Connection,
): Promise<ResolvedChainConfig> {
  const result: ResolvedChainConfig = {
    jump_hosts: [],
    proxy_config: null,
    proxy_chain: null,
    mixed_chain: null,
    openvpn_config: null,
    vpnPreSteps: [],
  };

  // Priority 0: tunnelChainId — saved chain reference (resolves profiles)
  if (connection.tunnelChainId) {
    resolveTunnelChainById(connection.tunnelChainId, result);
    return result;
  }

  // Priority 1: Modern tunnelChain (most flexible, inline layers)
  if (connection.security?.tunnelChain?.length) {
    resolveTunnelChain(connection.security.tunnelChain, result);
    return result;
  }

  // Priority 2: proxyChainId — look up saved chain
  if (connection.proxyChainId) {
    await resolveProxyChainId(connection.proxyChainId, result);
  }

  // Priority 3: connectionChainId — look up connection chain
  if (connection.connectionChainId) {
    await resolveConnectionChainId(connection.connectionChainId, result);
  }

  // Priority 4: Legacy security fields (only when no chain IDs present)
  if (!connection.proxyChainId && !connection.connectionChainId) {
    resolveLegacySecurity(connection, result);
  }

  return result;
}

// ── Priority 0: tunnelChainId reference ──────────────────────────

function resolveTunnelChainById(
  chainId: string,
  result: ResolvedChainConfig,
): void {
  const chain = proxyCollectionManager.getTunnelChain(chainId);
  if (!chain) {
    console.warn(`[resolveChainConfig] Tunnel chain "${chainId}" not found`);
    return;
  }

  // Resolve tunnelProfileId references in layers
  const resolvedLayers = chain.layers.map((layer) => {
    if (layer.tunnelProfileId) {
      const profile = proxyCollectionManager.getTunnelProfile(layer.tunnelProfileId);
      if (profile) {
        // Merge profile config as base, layer overrides on top
        return { ...profile.config, ...layer, type: layer.type || profile.type };
      }
    }
    return layer;
  });

  resolveTunnelChain(resolvedLayers, result);
}

// ── Priority 1: Modern tunnelChain ────────────────────────────────

function resolveTunnelChain(
  layers: TunnelChainLayer[],
  result: ResolvedChainConfig,
): void {
  const enabledLayers = layers.filter((l) => l.enabled);

  const proxyLayers: TunnelChainLayer[] = [];
  const sshJumpLayers: TunnelChainLayer[] = [];
  let hasMix = false;

  for (const layer of enabledLayers) {
    switch (layer.type) {
      // ── VPN pre-steps ────────────────────────────────────
      case 'openvpn':
      case 'wireguard':
      case 'tailscale':
      case 'zerotier': {
        const configId =
          layer.vpn?.configId ?? layer.mesh?.networkId ?? undefined;
        result.vpnPreSteps.push({
          vpnType: layer.type,
          connectionId: layer.id,
          configId,
        });
        break;
      }

      // ── Proxy hops ──────────────────────────────────────
      case 'proxy':
      case 'shadowsocks': {
        proxyLayers.push(layer);
        break;
      }

      // ── SSH jump hosts ──────────────────────────────────
      case 'ssh-jump': {
        sshJumpLayers.push(layer);
        break;
      }

      // ssh-proxycmd and ssh-stdio are handled by useWebTerminal,
      // ssh-tunnel is a forwarding concept — none produce jump_hosts.
      // tor, i2p, stunnel, chisel, ngrok, cloudflared are tunnel
      // pre-steps similar to VPN but not yet modeled here.
      default:
        break;
    }
  }

  // Determine whether we have a mixed chain (SSH + proxy hops together)
  hasMix = proxyLayers.length > 0 && sshJumpLayers.length > 0;

  if (hasMix) {
    // Build a mixed chain preserving the original layer order
    const hops: ResolvedMixedChainHop[] = [];
    for (const layer of enabledLayers) {
      if (layer.type === 'ssh-jump' && layer.sshTunnel) {
        hops.push({
          type: 'ssh_jump',
          host: layer.sshTunnel.host ?? '',
          port: layer.sshTunnel.port ?? 22,
          username: layer.sshTunnel.username ?? '',
          password: layer.sshTunnel.password ?? null,
          private_key_path: layer.sshTunnel.privateKey ?? null,
          private_key_passphrase: layer.sshTunnel.passphrase ?? null,
          agent_forwarding: layer.sshTunnel.agentForwarding,
        });
      } else if (
        (layer.type === 'proxy' || layer.type === 'shadowsocks') &&
        layer.proxy
      ) {
        hops.push({
          type: 'proxy',
          proxy_type: layer.proxy.proxyType,
          host: layer.proxy.host,
          port: layer.proxy.port,
          username: layer.proxy.username ?? undefined,
          password: layer.proxy.password ?? null,
        });
      }
    }
    result.mixed_chain = { hops };
  } else {
    // Pure SSH jump chain
    for (const layer of sshJumpLayers) {
      const ssh = layer.sshTunnel;
      if (!ssh) continue;

      // If the layer references multiple jump hosts, expand them
      if (ssh.jumpHosts?.length) {
        for (const jh of ssh.jumpHosts) {
          result.jump_hosts.push({
            host: jh.host,
            port: jh.port ?? 22,
            username: jh.username ?? '',
          });
        }
      } else {
        result.jump_hosts.push({
          host: ssh.host ?? '',
          port: ssh.port ?? 22,
          username: ssh.username ?? '',
          password: ssh.password ?? null,
          private_key_path: ssh.privateKey ?? null,
          private_key_passphrase: ssh.passphrase ?? null,
          agent_forwarding: ssh.agentForwarding,
        });
      }
    }

    // Pure proxy chain
    if (proxyLayers.length === 1 && proxyLayers[0].proxy) {
      const p = proxyLayers[0].proxy;
      result.proxy_config = {
        proxy_type: p.proxyType,
        host: p.host,
        port: p.port,
        username: p.username ?? null,
        password: p.password ?? null,
      };
    } else if (proxyLayers.length > 1) {
      result.proxy_chain = {
        proxies: proxyLayers
          .filter((l) => l.proxy != null)
          .map((l) => ({
            proxy_type: l.proxy!.proxyType,
            host: l.proxy!.host,
            port: l.proxy!.port,
            username: l.proxy!.username ?? null,
            password: l.proxy!.password ?? null,
          })),
      };
    }
  }
}

// ── Priority 2: Saved proxy chain ─────────────────────────────────

async function resolveProxyChainId(
  chainId: string,
  result: ResolvedChainConfig,
): Promise<void> {
  const chain = proxyCollectionManager.getChain(chainId);
  if (!chain) return;

  const sortedLayers = [...chain.layers].sort(
    (a, b) => a.position - b.position,
  );

  const proxyLayers: SavedChainLayer[] = [];
  const sshJumpLayers: SavedChainLayer[] = [];

  for (const layer of sortedLayers) {
    switch (layer.type) {
      case 'openvpn':
      case 'wireguard': {
        result.vpnPreSteps.push({
          vpnType: layer.type,
          connectionId: layer.vpnProfileId ?? layer.proxyProfileId ?? '',
          configId: layer.vpnProfileId,
        });
        break;
      }
      case 'proxy': {
        proxyLayers.push(layer);
        break;
      }
      case 'ssh-jump': {
        sshJumpLayers.push(layer);
        break;
      }
      // ssh-tunnel and ssh-proxycmd are not directly convertible here
      default:
        break;
    }
  }

  const hasMix = proxyLayers.length > 0 && sshJumpLayers.length > 0;

  if (hasMix) {
    const hops: ResolvedMixedChainHop[] = [];
    for (const layer of sortedLayers) {
      if (layer.type === 'ssh-jump') {
        const cfg = layer.inlineConfig as SSHJumpConfig | undefined;
        if (cfg) {
          hops.push({
            type: 'ssh_jump',
            host: cfg.host,
            port: cfg.port ?? 22,
            username: cfg.username ?? '',
            password: cfg.password ?? null,
            private_key_path: cfg.privateKey ?? null,
            private_key_passphrase: cfg.passphrase ?? null,
          });
        }
      } else if (layer.type === 'proxy') {
        const profile = layer.proxyProfileId
          ? proxyCollectionManager.getProfile(layer.proxyProfileId)
          : undefined;
        if (profile) {
          hops.push({
            type: 'proxy',
            proxy_type: profile.config.type,
            host: profile.config.host,
            port: profile.config.port,
            username: profile.config.username ?? undefined,
            password: profile.config.password ?? null,
          });
        }
      }
    }
    result.mixed_chain = {
      hops,
      hop_timeout_ms: chain.dynamics?.hopTimeoutMs,
    };
  } else {
    // Pure SSH jumps
    for (const layer of sshJumpLayers) {
      const cfg = layer.inlineConfig as SSHJumpConfig | undefined;
      if (!cfg) continue;

      if (cfg.jumpChain?.length) {
        for (const jh of cfg.jumpChain) {
          result.jump_hosts.push({
            host: jh.host,
            port: jh.port ?? 22,
            username: jh.username ?? '',
          });
        }
      } else {
        result.jump_hosts.push({
          host: cfg.host,
          port: cfg.port ?? 22,
          username: cfg.username ?? '',
          password: cfg.password ?? null,
          private_key_path: cfg.privateKey ?? null,
          private_key_passphrase: cfg.passphrase ?? null,
        });
      }
    }

    // Pure proxies
    const resolvedProxies: ResolvedProxyConfig[] = [];
    for (const layer of proxyLayers) {
      const profile = layer.proxyProfileId
        ? proxyCollectionManager.getProfile(layer.proxyProfileId)
        : undefined;
      if (profile) {
        resolvedProxies.push({
          proxy_type: profile.config.type,
          host: profile.config.host,
          port: profile.config.port,
          username: profile.config.username ?? null,
          password: profile.config.password ?? null,
        });
      }
    }

    if (resolvedProxies.length === 1) {
      result.proxy_config = resolvedProxies[0];
    } else if (resolvedProxies.length > 1) {
      result.proxy_chain = {
        proxies: resolvedProxies,
        hop_timeout_ms: chain.dynamics?.hopTimeoutMs,
      };
    }
  }
}

// ── Priority 3: Connection chain (Tauri backend) ──────────────────

async function resolveConnectionChainId(
  chainId: string,
  result: ResolvedChainConfig,
): Promise<void> {
  try {
    const manager = ProxyOpenVPNManager.getInstance();
    const chain = await manager.getConnectionChain(chainId);
    if (!chain?.layers?.length) return;

    const sortedLayers = [...chain.layers].sort(
      (a, b) => a.position - b.position,
    );

    for (const layer of sortedLayers) {
      // Connection chains use ConnectionType enum values
      switch (layer.connection_type) {
        case 'OpenVPN': {
          result.vpnPreSteps.push({
            vpnType: 'openvpn',
            connectionId: layer.connection_id,
          });
          if (!result.openvpn_config) {
            result.openvpn_config = {
              connection_id: layer.connection_id,
              chain_position: layer.position,
            };
          }
          break;
        }
        case 'WireGuard': {
          result.vpnPreSteps.push({
            vpnType: 'wireguard',
            connectionId: layer.connection_id,
          });
          break;
        }
        case 'Tailscale': {
          result.vpnPreSteps.push({
            vpnType: 'tailscale',
            connectionId: layer.connection_id,
          });
          break;
        }
        case 'ZeroTier': {
          result.vpnPreSteps.push({
            vpnType: 'zerotier',
            connectionId: layer.connection_id,
          });
          break;
        }
        case 'Proxy': {
          // Connection chains store proxy references by connection_id;
          // the actual proxy details would need to be looked up from
          // the proxy collection. We store what we have.
          if (!result.proxy_config) {
            result.proxy_config = {
              proxy_type: 'socks5', // default; actual type from profile
              host: '',
              port: layer.local_port ?? 0,
            };
          }
          break;
        }
        // SSH, IKEv2, SSTP, SoftEther etc. are connection-level types
        // and don't map directly to jump_hosts without full connection data.
        default:
          break;
      }
    }
  } catch (error) {
    console.warn(
      `[resolveChainConfig] Failed to resolve connection chain "${chainId}":`,
      error,
    );
  }
}

// ── Priority 4: Legacy security fields ────────────────────────────

function resolveLegacySecurity(
  connection: Connection,
  result: ResolvedChainConfig,
): void {
  const security = connection.security;
  if (!security) return;

  // Legacy single proxy
  if (security.proxy) {
    const p = security.proxy;
    result.proxy_config = {
      proxy_type: p.type,
      host: p.host,
      port: p.port,
      username: p.username ?? null,
      password: p.password ?? null,
    };
  }

  // Legacy OpenVPN
  if (security.openvpn?.enabled) {
    const vpn = security.openvpn;
    result.openvpn_config = {
      connection_id: vpn.configId ?? connection.id,
      chain_position: vpn.chainPosition,
    };
    result.vpnPreSteps.push({
      vpnType: 'openvpn',
      connectionId: vpn.configId ?? connection.id,
      configId: vpn.configId,
    });
  }

  // Legacy SSH tunnel is a port-forwarding concept (local port -> remote
  // host via an SSH server). It does not translate to jump_hosts (which
  // are ProxyJump -J style hops), so we intentionally leave jump_hosts
  // empty here. Consumers that need SSH tunnel forwarding should read
  // connection.security.sshTunnel directly.
}
