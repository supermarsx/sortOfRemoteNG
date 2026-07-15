import type { Connection } from "../../types/connection/connection";
import type { ProxyCollectionData } from "../../types/settings/settings";
import { proxyCollectionManager } from "../connection/proxyCollectionManager";
import { formatErrorForDisplay } from "../errors/formatError";
import type {
  ResolvedChainConfig,
  ResolvedJumpHost,
  ResolvedMixedChainHop,
  ResolvedProxyConfig,
  VpnPreStep,
} from "../ssh/resolveChainConfig";
import { ProxyOpenVPNManager } from "./proxyOpenVPNManager";
import {
  resolveNetworkPath,
  type CanonicalNetworkPathLayer,
  type NetworkPathCatalog,
  type NetworkPathResolution,
} from "./resolveNetworkPath";

export type RuntimeNetworkPathProtocol =
  | "ssh"
  | "rdp"
  | "raw-tcp"
  | "raw-udp"
  | "rlogin"
  | "powershell";

export type RuntimeNetworkPathErrorCode =
  | "invalid-path"
  | "snapshot-unavailable"
  | "unsupported-layer";

/**
 * A fail-closed runtime resolution error. Messages deliberately contain only
 * source metadata and transport labels, never layer configuration values.
 */
export class RuntimeNetworkPathError extends Error {
  constructor(
    readonly code: RuntimeNetworkPathErrorCode,
    message: string,
  ) {
    super(message);
    this.name = "RuntimeNetworkPathError";
  }
}

/**
 * The only path material allowed on ConnectionSession or persistence payloads.
 * It is enough for detached windows to request the referenced connections but
 * intentionally excludes hosts, usernames, credentials, and raw configs.
 */
export interface SessionNetworkPathSnapshot {
  version: 1;
  transports: string[];
  connectionIds: string[];
}

export interface RuntimeRdpTunnel {
  bastion: ResolvedJumpHost;
}

export interface RuntimeNetworkPath {
  protocol: RuntimeNetworkPathProtocol;
  /** Secret-bearing transport material. Keep local to connection setup. */
  transport: ResolvedChainConfig;
  rdpTunnel: RuntimeRdpTunnel | null;
  /** Safe, minimal session/detach/restore snapshot. */
  snapshot: SessionNetworkPathSnapshot;
  /** Ephemeral values used only to redact backend errors. Never persist. */
  redactionSecrets: string[];
}

type SocketHop =
  | { kind: "proxy"; config: ResolvedProxyConfig }
  | { kind: "ssh"; config: ResolvedJumpHost };

const SUPPORTED_PROXY_TYPES = new Set(["http", "https", "socks4", "socks5"]);
const SUPPORTED_VPN_TYPES = new Set([
  "openvpn",
  "wireguard",
  "tailscale",
  "zerotier",
]);
const DIRECT_ONLY_PROTOCOLS = new Set<RuntimeNetworkPathProtocol>([
  "raw-tcp",
  "raw-udp",
  "rlogin",
  "powershell",
]);

let proxyCollectionInitialization: Promise<void> | null = null;

function emptyTransport(): ResolvedChainConfig {
  return {
    jump_hosts: [],
    proxy_config: null,
    proxy_chain: null,
    mixed_chain: null,
    openvpn_config: null,
    vpnPreSteps: [],
  };
}

function needsSavedCatalog(connection: Connection): boolean {
  return Boolean(
    connection.proxyChainId ||
    connection.tunnelChainId ||
    connection.connectionChainId ||
    connection.security?.tunnelChain?.some((layer) => layer.tunnelProfileId),
  );
}

async function ensureProxyCollectionReady(): Promise<void> {
  if (!proxyCollectionInitialization) {
    proxyCollectionInitialization = proxyCollectionManager
      .initialize()
      .catch(() => {
        proxyCollectionInitialization = null;
        throw new RuntimeNetworkPathError(
          "snapshot-unavailable",
          "The current saved network-path collection could not be loaded.",
        );
      });
  }
  await proxyCollectionInitialization;
}

function snapshotProxyCollection(): NetworkPathCatalog["proxyCollection"] {
  return {
    profiles: proxyCollectionManager.getProfiles(),
    chains: proxyCollectionManager.getChains(),
    tunnelChains: proxyCollectionManager.getTunnelChains(),
    tunnelProfiles: proxyCollectionManager.getTunnelProfiles(),
  };
}

/** Capture all live stores immediately before transport construction. */
export async function captureNetworkPathCatalog(
  connection: Connection,
  connections: readonly Connection[],
): Promise<NetworkPathCatalog> {
  const connectionSnapshot = [...connections];
  if (!connectionSnapshot.some((candidate) => candidate.id === connection.id)) {
    connectionSnapshot.push(connection);
  }

  if (connectionSnapshot.some(needsSavedCatalog)) {
    await ensureProxyCollectionReady();
  }

  let connectionChains: NetworkPathCatalog["connectionChains"] = [];
  if (connectionSnapshot.some((candidate) => candidate.connectionChainId)) {
    try {
      connectionChains =
        await ProxyOpenVPNManager.getInstance().listConnectionChains();
    } catch {
      throw new RuntimeNetworkPathError(
        "snapshot-unavailable",
        "The current connection-chain snapshot could not be loaded.",
      );
    }
  }

  return {
    connections: connectionSnapshot,
    proxyCollection: snapshotProxyCollection(),
    connectionChains,
  };
}

function unsupported(
  protocol: RuntimeNetworkPathProtocol,
  layer: Pick<CanonicalNetworkPathLayer, "order" | "transport">,
  reason?: string,
): never {
  const suffix = reason ? ` ${reason}` : "";
  throw new RuntimeNetworkPathError(
    "unsupported-layer",
    `${protocol.toUpperCase()} cannot use network-path layer ${layer.order + 1} (${layer.transport}).${suffix}`,
  );
}

function normalizeProxyType(type: string): string {
  return type === "http-connect" ? "http" : type.toLowerCase();
}

function toProxyHop(
  protocol: RuntimeNetworkPathProtocol,
  layer: Extract<CanonicalNetworkPathLayer, { kind: "proxy" }>,
): SocketHop {
  const proxyType = normalizeProxyType(layer.config.type);
  if (!SUPPORTED_PROXY_TYPES.has(proxyType)) {
    unsupported(
      protocol,
      layer,
      "The SSH backend supports only HTTP, HTTPS, SOCKS4, and SOCKS5 proxy hops.",
    );
  }
  return {
    kind: "proxy",
    config: {
      proxy_type: proxyType,
      host: layer.config.host,
      port: layer.config.port,
      username: layer.config.username ?? null,
      password: layer.config.password ?? null,
    },
  };
}

function toSshHop(
  protocol: RuntimeNetworkPathProtocol,
  layer: Extract<CanonicalNetworkPathLayer, { kind: "ssh" }>,
): SocketHop {
  if (layer.transport !== "ssh-jump" && layer.transport !== "ssh-tunnel") {
    unsupported(
      protocol,
      layer,
      "ProxyCommand and stdio layers are not supported as nested runtime hops.",
    );
  }
  return {
    kind: "ssh",
    config: {
      host: layer.config.host ?? "",
      port: layer.config.port ?? 22,
      username: layer.config.username ?? "",
      password: layer.config.password ?? null,
      private_key_path: layer.config.privateKey ?? null,
      private_key_passphrase: layer.config.passphrase ?? null,
      agent_forwarding: layer.config.agentForwarding ?? false,
    },
  };
}

function toVpnStep(
  protocol: RuntimeNetworkPathProtocol,
  layer: Extract<CanonicalNetworkPathLayer, { kind: "vpn" | "connection" }>,
): VpnPreStep {
  const vpnType = layer.transport.toLowerCase();
  if (!SUPPORTED_VPN_TYPES.has(vpnType)) {
    unsupported(
      protocol,
      layer,
      "This backend does not expose a compatible runtime pre-step for that layer.",
    );
  }

  const connectionId =
    layer.kind === "connection"
      ? layer.config.connection_id
      : layer.config.connectionId;
  if (!connectionId) {
    unsupported(
      protocol,
      layer,
      "The layer has no saved runtime connection reference.",
    );
  }

  return {
    vpnType: vpnType as VpnPreStep["vpnType"],
    connectionId,
    configId:
      layer.kind === "vpn"
        ? (layer.config.vpn?.configId ?? layer.config.mesh?.networkId)
        : undefined,
  };
}

function toMixedHop(hop: SocketHop): ResolvedMixedChainHop {
  if (hop.kind === "proxy") {
    return {
      type: "proxy",
      proxy_type: hop.config.proxy_type,
      host: hop.config.host,
      port: hop.config.port,
      username: hop.config.username ?? undefined,
      password: hop.config.password ?? null,
    };
  }
  return {
    type: "ssh_jump",
    host: hop.config.host,
    port: hop.config.port,
    username: hop.config.username,
    password: hop.config.password ?? null,
    private_key_path: hop.config.private_key_path ?? null,
    private_key_passphrase: hop.config.private_key_passphrase ?? null,
    agent_forwarding: hop.config.agent_forwarding,
  };
}

function applySocketHops(
  transport: ResolvedChainConfig,
  hops: readonly SocketHop[],
): void {
  if (hops.length === 0) return;
  if (hops.every((hop) => hop.kind === "ssh")) {
    transport.jump_hosts = hops.map(
      (hop) => (hop as Extract<SocketHop, { kind: "ssh" }>).config,
    );
    return;
  }
  if (hops.every((hop) => hop.kind === "proxy")) {
    const proxies = hops.map(
      (hop) => (hop as Extract<SocketHop, { kind: "proxy" }>).config,
    );
    if (proxies.length === 1) transport.proxy_config = proxies[0];
    else transport.proxy_chain = { proxies };
    return;
  }
  transport.mixed_chain = { hops: hops.map(toMixedHop) };
}

function assertStrictSavedChains(
  resolution: NetworkPathResolution,
  catalog: NetworkPathCatalog,
): void {
  const referencedIds = new Set(
    resolution.layers
      .filter((layer) => layer.source.kind === "proxy-chain")
      .map((layer) => layer.source.referenceId)
      .filter((id): id is string => Boolean(id)),
  );
  for (const chain of catalog.proxyCollection?.chains ?? []) {
    if (!referencedIds.has(chain.id)) continue;
    const strategy = chain.dynamics?.strategy;
    if (strategy && strategy !== "strict") {
      throw new RuntimeNetworkPathError(
        "unsupported-layer",
        `The saved proxy chain "${chain.id}" uses ${strategy} routing, which is not supported by the fail-closed session runtime.`,
      );
    }
  }
}

function buildSnapshot(
  connection: Connection,
  resolution: NetworkPathResolution,
): SessionNetworkPathSnapshot {
  const connectionIds: string[] = [];
  const seen = new Set<string>([connection.id]);
  const add = (id?: string) => {
    if (!id || seen.has(id)) return;
    seen.add(id);
    connectionIds.push(id);
  };

  for (const layer of resolution.layers) {
    add(layer.source.ownerConnectionId);
    if (layer.kind === "ssh") add(layer.config.connectionId);
  }

  return {
    version: 1,
    transports: resolution.layers.map((layer) => layer.transport),
    connectionIds,
  };
}

const SECRET_KEY =
  /(?:password|passphrase|secret|token|private.?key|preshared.?key|auth.?key|tunnel.?key|client.?key|credential|custom.?headers|command|extra.?args|custom.?options)/i;

function collectSecretValues(value: unknown, output: Set<string>): void {
  if (Array.isArray(value)) {
    value.forEach((item) => collectSecretValues(item, output));
    return;
  }
  if (!value || typeof value !== "object") return;
  for (const [key, item] of Object.entries(value)) {
    if (SECRET_KEY.test(key)) {
      if (typeof item === "string" && item) output.add(item);
      else collectSecretValues(item, output);
    } else {
      collectSecretValues(item, output);
    }
  }
}

/** Convert a supplied canonical snapshot into an executable fail-closed path. */
export function buildRuntimeNetworkPath(
  connection: Connection,
  catalog: NetworkPathCatalog,
  protocol: RuntimeNetworkPathProtocol,
): RuntimeNetworkPath {
  const resolution = resolveNetworkPath(connection, catalog);
  if (!resolution.validation.valid) {
    const issue = resolution.validation.issues.find(
      (candidate) => candidate.severity === "error",
    );
    const detail = issue?.message ?? "The configured path is invalid.";
    throw new RuntimeNetworkPathError(
      "invalid-path",
      `Network path blocked: ${detail}`,
    );
  }
  assertStrictSavedChains(resolution, catalog);

  if (DIRECT_ONLY_PROTOCOLS.has(protocol) && resolution.layers.length > 0) {
    const firstLayer = resolution.layers[0];
    const reason =
      protocol === "powershell"
        ? "PowerShell Remoting routes are unavailable until the backend exposes a network-path adapter. The configured path will not be bypassed."
        : protocol === "rlogin"
          ? "The current RLogin runtime supports direct TCP only. The configured path will not be bypassed."
          : `The current ${protocol === "raw-udp" ? "Raw UDP" : "Raw TCP"} runtime supports direct connections only. The configured path will not be bypassed.`;
    unsupported(protocol, firstLayer, reason);
  }

  const transport = emptyTransport();
  const socketHops: SocketHop[] = [];
  let socketLayerSeen = false;

  for (const layer of resolution.layers) {
    if (layer.kind === "vpn" || layer.kind === "connection") {
      if (socketLayerSeen) {
        unsupported(
          protocol,
          layer,
          "VPN layers after a socket hop cannot be represented without changing path order.",
        );
      }
      transport.vpnPreSteps.push(toVpnStep(protocol, layer));
      continue;
    }

    socketLayerSeen = true;
    if (layer.kind === "proxy") {
      socketHops.push(toProxyHop(protocol, layer));
    } else if (layer.kind === "ssh") {
      socketHops.push(toSshHop(protocol, layer));
    } else {
      unsupported(
        protocol,
        layer,
        "No compatible session transport exists for this tunnel type.",
      );
    }
  }

  const firstOpenVpn = transport.vpnPreSteps.find(
    (step) => step.vpnType === "openvpn",
  );
  if (firstOpenVpn) {
    transport.openvpn_config = {
      connection_id: firstOpenVpn.connectionId,
      chain_position: resolution.layers.findIndex(
        (layer) => layer.transport.toLowerCase() === "openvpn",
      ),
    };
  }

  let rdpTunnel: RuntimeRdpTunnel | null = null;
  if (protocol === "rdp" && socketHops.length > 0) {
    const lastHop = socketHops[socketHops.length - 1];
    if (lastHop.kind !== "ssh") {
      const socketLayers = resolution.layers.filter(
        (layer) => layer.kind === "proxy" || layer.kind === "ssh",
      );
      const lastLayer = socketLayers[socketLayers.length - 1]!;
      unsupported(
        protocol,
        lastLayer,
        "RDP requires a final SSH bastion to create the local forward.",
      );
    }
    rdpTunnel = { bastion: lastHop.config };
    applySocketHops(transport, socketHops.slice(0, -1));
  } else {
    applySocketHops(transport, socketHops);
  }

  const secrets = new Set<string>();
  collectSecretValues(resolution.layers, secrets);

  return {
    protocol,
    transport,
    rdpTunnel,
    snapshot: buildSnapshot(connection, resolution),
    redactionSecrets: [...secrets],
  };
}

/** Resolve against the live snapshots captured at the connection boundary. */
export async function resolveRuntimeNetworkPath(
  connection: Connection,
  connections: readonly Connection[],
  protocol: RuntimeNetworkPathProtocol,
): Promise<RuntimeNetworkPath> {
  const catalog = await captureNetworkPathCatalog(connection, connections);
  return buildRuntimeNetworkPath(connection, catalog, protocol);
}

/** Render arbitrary backend errors without leaking target or path secrets. */
export function formatRuntimeNetworkPathError(
  error: unknown,
  runtime?: RuntimeNetworkPath | null,
  additionalSecrets: readonly (string | null | undefined)[] = [],
): string {
  return formatErrorForDisplay(error, [
    ...(runtime?.redactionSecrets ?? []),
    ...additionalSecrets.filter((value): value is string => Boolean(value)),
  ]);
}

/** Utility for detached-window filtering; returns only safe dependency IDs. */
export function networkPathConnectionIds(
  snapshots: readonly (SessionNetworkPathSnapshot | undefined)[],
): Set<string> {
  return new Set(
    snapshots.flatMap((snapshot) => snapshot?.connectionIds ?? []),
  );
}

// Compile-time guard: the live snapshot deliberately omits collection version
// because the canonical resolver consumes only these four immutable arrays.
void ({} as Pick<
  ProxyCollectionData,
  "profiles" | "chains" | "tunnelChains" | "tunnelProfiles"
>);
