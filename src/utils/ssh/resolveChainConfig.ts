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

/**
 * @param connection  The target connection whose chain/tunnel should be resolved.
 * @param connections Optional connection store snapshot. Used to resolve
 *   tunnel/jump layers that reference another connection only by
 *   `sshTunnel.connectionId` (e.g. mRemoteNG `SSHTunnelConnectionName`
 *   imports) into concrete host/port/credentials. Callers that have the
 *   live connection list (e.g. `useWebTerminal`, `useRDPClient`) should
 *   pass it so imported tunnels resolve even when inline host fields are
 *   absent; omitting it preserves the previous inline-only behavior.
 */
export async function resolveChainConfig(
  connection: Connection,
  connections?: Connection[],
): Promise<ResolvedChainConfig> {
  const result: ResolvedChainConfig = {
    jump_hosts: [],
    proxy_config: null,
    proxy_chain: null,
    mixed_chain: null,
    openvpn_config: null,
    vpnPreSteps: [],
  };

  const lookupConnection = makeConnectionLookup(connections);

  // Priority 0: tunnelChainId — saved chain reference (resolves profiles)
  if (connection.tunnelChainId) {
    resolveTunnelChainById(connection.tunnelChainId, result, lookupConnection);
    return result;
  }

  // Priority 1: Modern tunnelChain (most flexible, inline layers)
  //
  // Note: we no longer unconditionally early-return here. A tunnelChain made
  // up entirely of layer types this resolver does not turn into jump_hosts /
  // proxies (the old "non-empty chain ⇒ empty config" trap, R2) would
  // otherwise suppress the legacy fallbacks below and yield a silent no-op.
  // We only short-circuit when the chain actually produced a usable result.
  if (connection.security?.tunnelChain?.length) {
    resolveTunnelChain(connection.security.tunnelChain, result, lookupConnection);
    if (chainProducedResult(result)) {
      return result;
    }
    // Otherwise fall through to legacy/saved-chain resolution.
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

// ── Connection lookup + result helpers ────────────────────────────

type ConnectionLookup = (id: string) => Connection | undefined;

/**
 * Build a stable id → connection lookup from an optional connection list.
 * Returns a function that always resolves to `undefined` when no list is
 * supplied, so resolution degrades to inline-only fields.
 */
function makeConnectionLookup(connections?: Connection[]): ConnectionLookup {
  if (!connections?.length) {
    return () => undefined;
  }
  const byId = new Map<string, Connection>();
  for (const conn of connections) {
    if (conn?.id) byId.set(conn.id, conn);
  }
  return (id: string) => byId.get(id);
}

/** True when chain resolution produced something the runtime can act on. */
function chainProducedResult(result: ResolvedChainConfig): boolean {
  return (
    result.jump_hosts.length > 0 ||
    result.proxy_config !== null ||
    result.proxy_chain !== null ||
    result.mixed_chain !== null ||
    result.openvpn_config !== null ||
    result.vpnPreSteps.length > 0
  );
}

/**
 * Resolve an `ssh-jump` / `ssh-tunnel` layer's effective jump-host fields.
 *
 * mRemoteNG tunnel imports (and the Rust converter) seed a layer whose
 * `sshTunnel` carries a `connectionId` reference to the jump/bastion host.
 * The frontend importer inlines host/port/creds too, but the Rust path and
 * any hand-built layer may only carry the reference — so when the inline
 * host is missing we resolve it from the connection store. Inline values
 * always win over the referenced connection (post-inheritance creds the
 * importer captured should not be silently overwritten).
 */
function resolveJumpHostFields(
  ssh: NonNullable<TunnelChainLayer['sshTunnel']>,
  lookup: ConnectionLookup,
): ResolvedJumpHost {
  const ref =
    !ssh.host && ssh.connectionId ? lookup(ssh.connectionId) : undefined;

  return {
    host: ssh.host || ref?.hostname || '',
    port: ssh.port ?? ref?.port ?? 22,
    username: ssh.username ?? ref?.username ?? '',
    password: ssh.password ?? ref?.password ?? null,
    private_key_path: ssh.privateKey ?? ref?.privateKey ?? null,
    private_key_passphrase: ssh.passphrase ?? ref?.passphrase ?? null,
    agent_forwarding: ssh.agentForwarding,
  };
}

// ── Priority 0: tunnelChainId reference ──────────────────────────

function resolveTunnelChainById(
  chainId: string,
  result: ResolvedChainConfig,
  lookup: ConnectionLookup,
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

  resolveTunnelChain(resolvedLayers, result, lookup);
}

// ── Priority 1: Modern tunnelChain ────────────────────────────────

function resolveTunnelChain(
  layers: TunnelChainLayer[],
  result: ResolvedChainConfig,
  lookup: ConnectionLookup,
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
      // `ssh-jump` is the modern ProxyJump hop. `ssh-tunnel` is the layer
      // type the importers emit for an mRemoteNG SSHTunnelConnectionName
      // when the target is NOT ssh (RDP/VNC/HTTP/… through an SSH bastion):
      // the imported tunnel names a bastion host that the target is routed
      // through, which is exactly a jump host for chain-resolution purposes.
      // Both carry their bastion details in `layer.sshTunnel` (inline and/or
      // a `connectionId` reference resolved below), so we treat them alike
      // here instead of dropping `ssh-tunnel` and yielding an empty config.
      case 'ssh-jump':
      case 'ssh-tunnel': {
        sshJumpLayers.push(layer);
        break;
      }

      // ssh-proxycmd and ssh-stdio are handled by useWebTerminal.
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
      if (
        (layer.type === 'ssh-jump' || layer.type === 'ssh-tunnel') &&
        layer.sshTunnel
      ) {
        const jh = resolveJumpHostFields(layer.sshTunnel, lookup);
        hops.push({
          type: 'ssh_jump',
          host: jh.host,
          port: jh.port,
          username: jh.username,
          password: jh.password ?? null,
          private_key_path: jh.private_key_path ?? null,
          private_key_passphrase: jh.private_key_passphrase ?? null,
          agent_forwarding: jh.agent_forwarding,
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

      // If the layer references multiple jump hosts, expand them. Each entry
      // may itself reference a connection by id (resolve when host missing).
      if (ssh.jumpHosts?.length) {
        for (const jh of ssh.jumpHosts) {
          const ref =
            !jh.host && jh.connectionId ? lookup(jh.connectionId) : undefined;
          result.jump_hosts.push({
            host: jh.host || ref?.hostname || '',
            port: jh.port ?? ref?.port ?? 22,
            username: jh.username ?? ref?.username ?? '',
          });
        }
      } else {
        // Single bastion: inline fields win, with a `connectionId` reference
        // (mRemoteNG SSHTunnelConnectionName / Rust converter output) as the
        // fallback source for host/port/credentials.
        result.jump_hosts.push(resolveJumpHostFields(ssh, lookup));
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
