import type {
  Connection,
  TunnelChainLayer,
  TunnelType,
} from "../../types/connection/connection";
import type {
  ProxyCollectionData,
  ProxyConfig,
  SavedChainLayer,
  SavedProxyChain,
  SavedProxyProfile,
  SavedTunnelProfile,
  SSHJumpConfig,
} from "../../types/settings/settings";
import type { ChainLayer, ConnectionChain } from "./proxyOpenVPNManager";

/** Marker used by {@link redactNetworkPathSecrets}. */
export const NETWORK_PATH_REDACTED = "[REDACTED]" as const;

/**
 * Canonical network-path composition policy.
 *
 * Layers are always expressed outermost-to-target. Independent source
 * categories compose in the order below so no configured source silently
 * disappears. A saved tunnel-chain reference and an inline tunnel chain are
 * two representations of the same category: the reference wins and the
 * inline value is reported as shadowed. Missing references never fall back to
 * a lower-precedence representation because that could silently change the
 * route used for a connection.
 */
export const NETWORK_PATH_POLICY = Object.freeze({
  sourceOrder: [
    "connection-chain",
    "proxy-chain",
    "tunnel-chain",
    "inline-tunnel",
    "legacy-proxy",
  ] as const,
  tunnelSelection:
    "tunnelChainId replaces security.tunnelChain; inline layers are used only when no reference is configured",
  layerOrder:
    "source order first; array order for tunnel layers; stable position order for saved/backend chains",
  invalidReference:
    "report an error and omit the unresolved layer; never silently substitute another source",
});

export type NetworkPathSourceKind =
  | "connection-chain"
  | "proxy-chain"
  | "tunnel-chain"
  | "inline-tunnel"
  | "legacy-proxy";

export interface NetworkPathLayerSource {
  kind: NetworkPathSourceKind;
  ownerConnectionId: string;
  referenceId?: string;
  layerId?: string;
  profileId?: string;
}

interface CanonicalNetworkPathLayerBase {
  /** Stable within a deterministic resolution of the same catalog snapshot. */
  key: string;
  /** Zero-based outermost-to-target position. */
  order: number;
  source: NetworkPathLayerSource;
  transport: string;
}

export interface CanonicalProxyPathLayer extends CanonicalNetworkPathLayerBase {
  kind: "proxy";
  config: ProxyConfig;
}

export interface CanonicalSshPathLayer extends CanonicalNetworkPathLayerBase {
  kind: "ssh";
  transport: Extract<
    TunnelType,
    "ssh-tunnel" | "ssh-jump" | "ssh-proxycmd" | "ssh-stdio"
  >;
  config: NonNullable<TunnelChainLayer["sshTunnel"]>;
}

export interface CanonicalVpnPathLayer extends CanonicalNetworkPathLayerBase {
  kind: "vpn";
  transport:
    | Extract<TunnelType, "openvpn" | "wireguard" | "tailscale" | "zerotier">
    | string;
  config: {
    connectionId?: string;
    vpn?: TunnelChainLayer["vpn"];
    mesh?: TunnelChainLayer["mesh"];
    inlineConfig?: SavedChainLayer["inlineConfig"];
  };
}

export interface CanonicalTunnelPathLayer extends CanonicalNetworkPathLayerBase {
  kind: "tunnel";
  transport: TunnelType;
  config: {
    localBindHost?: string;
    localBindPort?: number;
    tunnel?: TunnelChainLayer["tunnel"];
    nodeChainConfig?: TunnelChainLayer["nodeChainConfig"];
  };
}

export interface CanonicalConnectionPathLayer extends CanonicalNetworkPathLayerBase {
  kind: "connection";
  config: Pick<
    ChainLayer,
    "id" | "connection_type" | "connection_id" | "position" | "local_port"
  >;
}

/**
 * Runtime-oriented canonical layers. Config values intentionally retain
 * credentials for later transport wiring. Never render or log this array;
 * use `summary`, `validation`, or {@link redactNetworkPathSecrets} for UI and
 * diagnostics.
 */
export type CanonicalNetworkPathLayer =
  | CanonicalProxyPathLayer
  | CanonicalSshPathLayer
  | CanonicalVpnPathLayer
  | CanonicalTunnelPathLayer
  | CanonicalConnectionPathLayer;

export type NetworkPathIssueSeverity = "error" | "warning";

export type NetworkPathIssueCode =
  | "missing-reference"
  | "disabled-reference"
  | "disabled-layer"
  | "disabled-chain"
  | "empty-chain"
  | "cycle"
  | "invalid-layer"
  | "shadowed-source"
  | "duplicate-position";

export interface NetworkPathIssue {
  code: NetworkPathIssueCode;
  severity: NetworkPathIssueSeverity;
  message: string;
  source: NetworkPathLayerSource;
}

export interface NetworkPathValidation {
  valid: boolean;
  errorCount: number;
  warningCount: number;
  issues: NetworkPathIssue[];
}

export interface NetworkPathLayerSummary {
  order: number;
  kind: CanonicalNetworkPathLayer["kind"];
  transport: string;
  source: NetworkPathLayerSource;
}

export interface NetworkPathSummary {
  status: "direct" | "ready" | "invalid";
  description: string;
  layerCount: number;
  sourceKinds: NetworkPathSourceKind[];
  layers: NetworkPathLayerSummary[];
}

export interface NetworkPathResolution {
  /** Secret-bearing runtime material. Do not expose directly in UI. */
  layers: CanonicalNetworkPathLayer[];
  /** UI-safe; messages and metadata never contain configuration values. */
  validation: NetworkPathValidation;
  /** UI-safe; contains transport labels and reference metadata only. */
  summary: NetworkPathSummary;
}

export interface NetworkPathCatalog {
  /** Snapshot of the live connection store. */
  connections?: readonly Connection[];
  /** Snapshot returned by the proxy collection store. */
  proxyCollection?: Readonly<
    Pick<
      ProxyCollectionData,
      "profiles" | "chains" | "tunnelChains" | "tunnelProfiles"
    >
  >;
  /** Snapshot returned by ProxyOpenVPNManager.listConnectionChains(). */
  connectionChains?: readonly ConnectionChain[];
}

interface ResolutionScope {
  connectionStack: string[];
  tunnelChainStack: string[];
}

interface ResolutionState {
  layers: CanonicalNetworkPathLayer[];
  issues: NetworkPathIssue[];
  keyCounts: Map<string, number>;
  connections: Map<string, Connection>;
  proxyProfiles: Map<string, SavedProxyProfile>;
  proxyChains: Map<string, SavedProxyChain>;
  tunnelChains: Map<string, ProxyCollectionData["tunnelChains"][number]>;
  tunnelProfiles: Map<string, SavedTunnelProfile>;
  connectionChains: Map<string, ConnectionChain>;
}

const SSH_TUNNEL_TYPES = new Set<TunnelType>([
  "ssh-tunnel",
  "ssh-jump",
  "ssh-proxycmd",
  "ssh-stdio",
]);

const VPN_TUNNEL_TYPES = new Set<TunnelType>([
  "openvpn",
  "wireguard",
  "tailscale",
  "zerotier",
]);

const EMPTY_PROXY_COLLECTION: NetworkPathCatalog["proxyCollection"] = {
  profiles: [],
  chains: [],
  tunnelChains: [],
  tunnelProfiles: [],
};

/**
 * Resolve every configured per-connection path source without I/O or singleton
 * access. Callers supply snapshots from the existing stores, making the result
 * deterministic, testable, and safe to recompute during editor validation.
 */
export function resolveNetworkPath(
  connection: Connection,
  catalog: NetworkPathCatalog = {},
): NetworkPathResolution {
  const proxyCollection = catalog.proxyCollection ?? EMPTY_PROXY_COLLECTION;
  const state: ResolutionState = {
    layers: [],
    issues: [],
    keyCounts: new Map(),
    connections: indexById(catalog.connections ?? []),
    proxyProfiles: indexById(proxyCollection?.profiles ?? []),
    proxyChains: indexById(proxyCollection?.chains ?? []),
    tunnelChains: indexById(proxyCollection?.tunnelChains ?? []),
    tunnelProfiles: indexById(proxyCollection?.tunnelProfiles ?? []),
    connectionChains: indexById(catalog.connectionChains ?? []),
  };

  // The target itself participates in cycle detection even when the supplied
  // connection snapshot does not contain it.
  if (connection.id) {
    state.connections.set(connection.id, connection);
  }

  appendConnectionSources(connection, state, {
    connectionStack: connection.id ? [connection.id] : [],
    tunnelChainStack: [],
  });

  const errorCount = state.issues.filter(
    (issue) => issue.severity === "error",
  ).length;
  const warningCount = state.issues.length - errorCount;
  const validation: NetworkPathValidation = {
    valid: errorCount === 0,
    errorCount,
    warningCount,
    issues: state.issues,
  };

  return {
    layers: state.layers,
    validation,
    summary: buildSummary(state.layers, validation),
  };
}

function appendConnectionSources(
  connection: Connection,
  state: ResolutionState,
  scope: ResolutionScope,
): void {
  const ownerConnectionId = connection.id || "unknown-connection";

  if (connection.connectionChainId) {
    appendConnectionChain(
      connection.connectionChainId,
      ownerConnectionId,
      state,
    );
  }

  if (connection.proxyChainId) {
    appendProxyChain(connection.proxyChainId, ownerConnectionId, state, scope);
  }

  const inlineTunnelLayers = connection.security?.tunnelChain ?? [];
  if (connection.tunnelChainId) {
    if (inlineTunnelLayers.length > 0) {
      addIssue(
        state,
        "shadowed-source",
        "warning",
        "Inline tunnel layers are shadowed by the selected tunnel-chain reference.",
        {
          kind: "inline-tunnel",
          ownerConnectionId,
          referenceId: connection.tunnelChainId,
        },
      );
    }
    appendTunnelChainReference(
      connection.tunnelChainId,
      ownerConnectionId,
      state,
      scope,
    );
  } else if (inlineTunnelLayers.length > 0) {
    appendTunnelLayers(
      inlineTunnelLayers,
      {
        kind: "inline-tunnel",
        ownerConnectionId,
      },
      state,
      scope,
      "Inline tunnel chain",
    );
  }

  if (connection.security?.proxy) {
    appendLegacyProxy(connection.security.proxy, ownerConnectionId, state);
  }
}

function appendConnectionChain(
  chainId: string,
  ownerConnectionId: string,
  state: ResolutionState,
): void {
  const source: NetworkPathLayerSource = {
    kind: "connection-chain",
    ownerConnectionId,
    referenceId: chainId,
  };
  const chain = state.connectionChains.get(chainId);
  if (!chain) {
    addIssue(
      state,
      "missing-reference",
      "error",
      `Connection chain "${chainId}" does not exist in the supplied snapshot.`,
      source,
    );
    return;
  }
  if (chain.layers.length === 0) {
    addIssue(
      state,
      "empty-chain",
      "error",
      `Connection chain "${chainId}" has no layers.`,
      source,
    );
    return;
  }

  const sortedLayers = stablePositionSort(chain.layers, source, state);
  const startCount = state.layers.length;
  sortedLayers.forEach((layer, index) => {
    const layerSource: NetworkPathLayerSource = {
      ...source,
      layerId: layer.id || `position-${layer.position}-${index}`,
    };
    if (!layer.connection_id) {
      addIssue(
        state,
        "invalid-layer",
        "error",
        "A connection-chain layer has no connection reference.",
        layerSource,
      );
      return;
    }

    if (String(layer.connection_type) === "Proxy") {
      appendProxyProfile(layer.connection_id, layerSource, state);
      return;
    }

    appendLayer(state, {
      kind: "connection",
      transport: String(layer.connection_type),
      source: layerSource,
      config: {
        id: layer.id,
        connection_type: layer.connection_type,
        connection_id: layer.connection_id,
        position: layer.position,
        local_port: layer.local_port,
      },
    });
  });

  if (state.layers.length === startCount) {
    addIssue(
      state,
      "disabled-chain",
      "error",
      `Connection chain "${chainId}" has no usable layers.`,
      source,
    );
  }
}

function appendProxyChain(
  chainId: string,
  ownerConnectionId: string,
  state: ResolutionState,
  scope: ResolutionScope,
): void {
  const source: NetworkPathLayerSource = {
    kind: "proxy-chain",
    ownerConnectionId,
    referenceId: chainId,
  };
  const chain = state.proxyChains.get(chainId);
  if (!chain) {
    addIssue(
      state,
      "missing-reference",
      "error",
      `Proxy chain "${chainId}" does not exist in the supplied collection.`,
      source,
    );
    return;
  }
  validateProxyFallbacks(chain, ownerConnectionId, state, [chainId]);
  if (chain.layers.length === 0) {
    addIssue(
      state,
      "empty-chain",
      "error",
      `Proxy chain "${chainId}" has no layers.`,
      source,
    );
    return;
  }

  const sortedLayers = stablePositionSort(chain.layers, source, state);
  const startCount = state.layers.length;
  sortedLayers.forEach((layer, index) => {
    appendSavedChainLayer(layer, index, source, state, scope);
  });
  if (state.layers.length === startCount) {
    addIssue(
      state,
      "disabled-chain",
      "error",
      `Proxy chain "${chainId}" has no enabled, usable layers.`,
      source,
    );
  }
}

function validateProxyFallbacks(
  chain: SavedProxyChain,
  ownerConnectionId: string,
  state: ResolutionState,
  stack: string[],
): void {
  for (const fallbackId of chain.dynamics?.fallbackChainIds ?? []) {
    const source: NetworkPathLayerSource = {
      kind: "proxy-chain",
      ownerConnectionId,
      referenceId: fallbackId,
    };
    if (stack.includes(fallbackId)) {
      addIssue(
        state,
        "cycle",
        "error",
        `Proxy-chain fallback cycle detected: ${[...stack, fallbackId].join(" -> ")}.`,
        source,
      );
      continue;
    }
    const fallback = state.proxyChains.get(fallbackId);
    if (!fallback) {
      addIssue(
        state,
        "missing-reference",
        "error",
        `Fallback proxy chain "${fallbackId}" does not exist.`,
        source,
      );
      continue;
    }
    if (fallback.layers.length === 0) {
      addIssue(
        state,
        "disabled-reference",
        "error",
        `Fallback proxy chain "${fallbackId}" has no usable layers.`,
        source,
      );
    }
    validateProxyFallbacks(fallback, ownerConnectionId, state, [
      ...stack,
      fallbackId,
    ]);
  }
}

function appendSavedChainLayer(
  layer: SavedChainLayer,
  index: number,
  chainSource: NetworkPathLayerSource,
  state: ResolutionState,
  scope: ResolutionScope,
): void {
  const source: NetworkPathLayerSource = {
    ...chainSource,
    layerId: `position-${layer.position}-${index}`,
  };

  if (layer.type === "proxy") {
    if (layer.proxyProfileId) {
      if (layer.inlineConfig) {
        addIssue(
          state,
          "shadowed-source",
          "warning",
          "Inline proxy configuration is shadowed by the saved profile reference.",
          { ...source, profileId: layer.proxyProfileId },
        );
      }
      appendProxyProfile(layer.proxyProfileId, source, state);
      return;
    }
    if (!isProxyConfig(layer.inlineConfig)) {
      addIssue(
        state,
        "invalid-layer",
        "error",
        "A proxy-chain proxy layer has neither a valid profile nor inline proxy configuration.",
        source,
      );
      return;
    }
    appendProxyConfig(layer.inlineConfig, source, state);
    return;
  }

  if (
    layer.type === "ssh-jump" ||
    layer.type === "ssh-tunnel" ||
    layer.type === "ssh-proxycmd"
  ) {
    if (!isSshJumpConfig(layer.inlineConfig)) {
      addIssue(
        state,
        "invalid-layer",
        "error",
        "An SSH chain layer is missing its inline SSH configuration.",
        source,
      );
      return;
    }
    appendSshConfig(
      layer.type,
      sshJumpToTunnelConfig(layer.inlineConfig),
      source,
      state,
      scope,
    );
    return;
  }

  const connectionId = layer.vpnProfileId ?? layer.proxyProfileId;
  if (!connectionId && !layer.inlineConfig) {
    addIssue(
      state,
      "invalid-layer",
      "error",
      "A VPN chain layer has neither a profile reference nor inline configuration.",
      source,
    );
    return;
  }
  appendLayer(state, {
    kind: "vpn",
    transport: layer.type,
    source,
    config: {
      connectionId,
      inlineConfig: cloneValue(layer.inlineConfig),
    },
  });
}

function appendProxyProfile(
  profileId: string,
  source: NetworkPathLayerSource,
  state: ResolutionState,
): void {
  const profileSource = { ...source, profileId };
  const profile = state.proxyProfiles.get(profileId);
  if (!profile) {
    addIssue(
      state,
      "missing-reference",
      "error",
      `Proxy profile "${profileId}" does not exist in the supplied collection.`,
      profileSource,
    );
    return;
  }
  if (!profile.config.enabled) {
    addIssue(
      state,
      "disabled-reference",
      "error",
      `Proxy profile "${profileId}" is disabled.`,
      profileSource,
    );
    return;
  }
  appendProxyConfig(profile.config, profileSource, state);
}

function appendTunnelChainReference(
  chainId: string,
  ownerConnectionId: string,
  state: ResolutionState,
  scope: ResolutionScope,
): void {
  const source: NetworkPathLayerSource = {
    kind: "tunnel-chain",
    ownerConnectionId,
    referenceId: chainId,
  };
  if (scope.tunnelChainStack.includes(chainId)) {
    addIssue(
      state,
      "cycle",
      "error",
      `Tunnel-chain cycle detected: ${[...scope.tunnelChainStack, chainId].join(
        " -> ",
      )}.`,
      source,
    );
    return;
  }
  const chain = state.tunnelChains.get(chainId);
  if (!chain) {
    addIssue(
      state,
      "missing-reference",
      "error",
      `Tunnel chain "${chainId}" does not exist in the supplied collection.`,
      source,
    );
    return;
  }
  appendTunnelLayers(
    chain.layers,
    source,
    state,
    {
      ...scope,
      tunnelChainStack: [...scope.tunnelChainStack, chainId],
    },
    `Tunnel chain "${chainId}"`,
  );
}

function appendTunnelLayers(
  layers: readonly TunnelChainLayer[],
  source: NetworkPathLayerSource,
  state: ResolutionState,
  scope: ResolutionScope,
  displayName: string,
): void {
  if (layers.length === 0) {
    addIssue(
      state,
      "empty-chain",
      "error",
      `${displayName} has no layers.`,
      source,
    );
    return;
  }

  const startCount = state.layers.length;
  let enabledCount = 0;
  layers.forEach((layer, index) => {
    const layerSource: NetworkPathLayerSource = {
      ...source,
      layerId: layer.id || `index-${index}`,
    };
    if (!layer.enabled) {
      addIssue(
        state,
        "disabled-layer",
        "warning",
        `Disabled ${layer.type} layer was omitted from the canonical path.`,
        layerSource,
      );
      return;
    }
    enabledCount += 1;
    const materialized = materializeTunnelProfile(
      layer,
      layerSource,
      state,
      [],
    );
    if (materialized) {
      appendTunnelLayer(materialized, layerSource, state, scope);
    }
  });

  if (enabledCount === 0) {
    addIssue(
      state,
      "disabled-chain",
      "error",
      `${displayName} has no enabled layers.`,
      source,
    );
  } else if (state.layers.length === startCount) {
    addIssue(
      state,
      "disabled-chain",
      "error",
      `${displayName} has no usable layers.`,
      source,
    );
  }
}

function materializeTunnelProfile(
  layer: TunnelChainLayer,
  source: NetworkPathLayerSource,
  state: ResolutionState,
  profileStack: string[],
): TunnelChainLayer | undefined {
  const profileId = layer.tunnelProfileId;
  if (!profileId) {
    return stripTunnelRuntime(cloneValue(layer));
  }
  const profileSource = { ...source, profileId };
  if (profileStack.includes(profileId)) {
    addIssue(
      state,
      "cycle",
      "error",
      `Tunnel-profile cycle detected: ${[...profileStack, profileId].join(
        " -> ",
      )}.`,
      profileSource,
    );
    return undefined;
  }
  const profile = state.tunnelProfiles.get(profileId);
  if (!profile) {
    addIssue(
      state,
      "missing-reference",
      "error",
      `Tunnel profile "${profileId}" does not exist in the supplied collection.`,
      profileSource,
    );
    return undefined;
  }
  const base = materializeTunnelProfile(profile.config, profileSource, state, [
    ...profileStack,
    profileId,
  ]);
  if (!base) return undefined;

  const override = cloneValue(layer);
  delete override.tunnelProfileId;
  return stripTunnelRuntime(deepMerge(base, override) as TunnelChainLayer);
}

function appendTunnelLayer(
  layer: TunnelChainLayer,
  source: NetworkPathLayerSource,
  state: ResolutionState,
  scope: ResolutionScope,
): void {
  if (layer.type === "proxy" || layer.type === "shadowsocks") {
    if (!layer.proxy) {
      addIssue(
        state,
        "invalid-layer",
        "error",
        `Enabled ${layer.type} layer has no proxy configuration.`,
        source,
      );
      return;
    }
    appendProxyConfig(
      {
        type:
          layer.type === "shadowsocks" ? "shadowsocks" : layer.proxy.proxyType,
        host: layer.proxy.host,
        port: layer.proxy.port,
        username: layer.proxy.username,
        password: layer.proxy.password,
        enabled: true,
        shadowsocksMethod: layer.proxy.method,
        shadowsocksPlugin: layer.proxy.plugin,
      },
      source,
      state,
    );
    return;
  }

  if (isSshTunnelType(layer.type)) {
    if (!layer.sshTunnel) {
      addIssue(
        state,
        "invalid-layer",
        "error",
        `Enabled ${layer.type} layer has no SSH configuration.`,
        source,
      );
      return;
    }
    appendSshConfig(layer.type, layer.sshTunnel, source, state, scope);
    return;
  }

  if (VPN_TUNNEL_TYPES.has(layer.type)) {
    appendLayer(state, {
      kind: "vpn",
      transport: layer.type,
      source,
      config: {
        connectionId: layer.id,
        vpn: cloneValue(layer.vpn),
        mesh: cloneValue(layer.mesh),
      },
    });
    return;
  }

  appendLayer(state, {
    kind: "tunnel",
    transport: layer.type,
    source,
    config: {
      localBindHost: layer.localBindHost,
      localBindPort: layer.localBindPort,
      tunnel: cloneValue(layer.tunnel),
      nodeChainConfig: cloneValue(layer.nodeChainConfig),
    },
  });
}

function isSshTunnelType(
  type: TunnelType,
): type is CanonicalSshPathLayer["transport"] {
  return SSH_TUNNEL_TYPES.has(type);
}

function appendSshConfig(
  transport: CanonicalSshPathLayer["transport"],
  sshConfig: NonNullable<TunnelChainLayer["sshTunnel"]>,
  source: NetworkPathLayerSource,
  state: ResolutionState,
  scope: ResolutionScope,
): void {
  if (sshConfig.jumpHosts?.length) {
    sshConfig.jumpHosts.forEach((jumpHost, index) => {
      appendSingleSshConfig(
        transport,
        {
          ...sshConfig,
          jumpHosts: undefined,
          connectionId: jumpHost.connectionId,
          host: jumpHost.host,
          port: jumpHost.port,
          username: jumpHost.username,
        },
        { ...source, layerId: `${source.layerId ?? "ssh"}:jump-${index}` },
        state,
        scope,
      );
    });
    return;
  }
  appendSingleSshConfig(transport, sshConfig, source, state, scope);
}

function appendSingleSshConfig(
  transport: CanonicalSshPathLayer["transport"],
  sshConfig: NonNullable<TunnelChainLayer["sshTunnel"]>,
  source: NetworkPathLayerSource,
  state: ResolutionState,
  scope: ResolutionScope,
): void {
  const config = cloneValue(sshConfig);
  if (config.connectionId) {
    if (scope.connectionStack.includes(config.connectionId)) {
      addIssue(
        state,
        "cycle",
        "error",
        `Connection-reference cycle detected: ${[
          ...scope.connectionStack,
          config.connectionId,
        ].join(" -> ")}.`,
        source,
      );
      return;
    }
    const referencedConnection = state.connections.get(config.connectionId);
    if (!referencedConnection) {
      addIssue(
        state,
        "missing-reference",
        "error",
        `SSH connection reference "${config.connectionId}" does not exist in the supplied connection snapshot.`,
        source,
      );
      return;
    }
    const errorCountBeforeReference = countErrors(state);
    const layerCountBeforeReference = state.layers.length;
    appendConnectionSources(referencedConnection, state, {
      ...scope,
      connectionStack: [...scope.connectionStack, config.connectionId],
    });
    if (countErrors(state) > errorCountBeforeReference) {
      state.layers.splice(layerCountBeforeReference);
      return;
    }
    config.host ||= referencedConnection.hostname;
    config.port ??= referencedConnection.port;
    config.username ??= referencedConnection.username;
    config.password ??= referencedConnection.password;
    config.privateKey ??= referencedConnection.privateKey;
    config.passphrase ??= referencedConnection.passphrase;
  }

  if (!config.host) {
    addIssue(
      state,
      "invalid-layer",
      "error",
      `Enabled ${transport} layer has no host or resolvable connection reference.`,
      source,
    );
    return;
  }
  config.port ??= 22;
  appendLayer(state, {
    kind: "ssh",
    transport,
    source,
    config,
  });
}

function countErrors(state: ResolutionState): number {
  return state.issues.reduce(
    (count, issue) => count + (issue.severity === "error" ? 1 : 0),
    0,
  );
}

function appendLegacyProxy(
  proxy: ProxyConfig,
  ownerConnectionId: string,
  state: ResolutionState,
): void {
  const source: NetworkPathLayerSource = {
    kind: "legacy-proxy",
    ownerConnectionId,
    layerId: "security.proxy",
  };
  if (!proxy.enabled) {
    addIssue(
      state,
      "disabled-layer",
      "warning",
      "The per-connection legacy proxy is disabled and was omitted.",
      source,
    );
    return;
  }
  appendProxyConfig(proxy, source, state);
}

function appendProxyConfig(
  proxy: ProxyConfig,
  source: NetworkPathLayerSource,
  state: ResolutionState,
): void {
  if (!proxy.enabled) {
    addIssue(
      state,
      source.profileId ? "disabled-reference" : "disabled-layer",
      source.profileId ? "error" : "warning",
      source.profileId
        ? `Proxy profile "${source.profileId}" is disabled.`
        : "Disabled proxy configuration was omitted.",
      source,
    );
    return;
  }
  if (!proxy.host || !Number.isFinite(proxy.port) || proxy.port <= 0) {
    addIssue(
      state,
      "invalid-layer",
      "error",
      "Enabled proxy configuration requires a host and positive port.",
      source,
    );
    return;
  }
  appendLayer(state, {
    kind: "proxy",
    transport: proxy.type,
    source,
    config: cloneValue(proxy),
  });
}

function appendLayer(
  state: ResolutionState,
  layer: Omit<CanonicalNetworkPathLayer, "key" | "order">,
): void {
  const seed = [
    layer.source.kind,
    layer.source.ownerConnectionId,
    layer.source.referenceId,
    layer.source.layerId,
    layer.source.profileId,
    layer.kind,
    layer.transport,
  ]
    .filter(Boolean)
    .join(":");
  const occurrence = state.keyCounts.get(seed) ?? 0;
  state.keyCounts.set(seed, occurrence + 1);
  const key = occurrence === 0 ? seed : `${seed}#${occurrence}`;
  state.layers.push({
    ...layer,
    key,
    order: state.layers.length,
  } as CanonicalNetworkPathLayer);
}

function addIssue(
  state: ResolutionState,
  code: NetworkPathIssueCode,
  severity: NetworkPathIssueSeverity,
  message: string,
  source: NetworkPathLayerSource,
): void {
  state.issues.push({
    code,
    severity,
    message,
    source: { ...source },
  });
}

function buildSummary(
  layers: readonly CanonicalNetworkPathLayer[],
  validation: NetworkPathValidation,
): NetworkPathSummary {
  const sourceKinds = Array.from(
    new Set(layers.map((layer) => layer.source.kind)),
  );
  const status = validation.valid
    ? layers.length > 0
      ? "ready"
      : "direct"
    : "invalid";
  const pathText =
    layers.length === 0
      ? "Direct to target"
      : `${layers.map((layer) => layer.transport).join(" -> ")} -> target`;
  return {
    status,
    description:
      status === "invalid" ? `Invalid network path: ${pathText}` : pathText,
    layerCount: layers.length,
    sourceKinds,
    layers: layers.map((layer) => ({
      order: layer.order,
      kind: layer.kind,
      transport: layer.transport,
      source: { ...layer.source },
    })),
  };
}

function stablePositionSort<T extends { position: number }>(
  layers: readonly T[],
  source: NetworkPathLayerSource,
  state: ResolutionState,
): T[] {
  const positions = new Set<number>();
  let duplicate = false;
  layers.forEach((layer) => {
    if (positions.has(layer.position)) duplicate = true;
    positions.add(layer.position);
  });
  if (duplicate) {
    addIssue(
      state,
      "duplicate-position",
      "warning",
      "Duplicate chain positions were resolved using the persisted array order.",
      source,
    );
  }
  return layers
    .map((layer, index) => ({ layer, index }))
    .sort((a, b) => a.layer.position - b.layer.position || a.index - b.index)
    .map(({ layer }) => layer);
}

function indexById<T extends { id: string }>(
  items: readonly T[],
): Map<string, T> {
  const result = new Map<string, T>();
  items.forEach((item) => {
    if (item.id && !result.has(item.id)) result.set(item.id, item);
  });
  return result;
}

function isProxyConfig(value: unknown): value is ProxyConfig {
  if (!isRecord(value)) return false;
  return (
    typeof value.type === "string" &&
    typeof value.host === "string" &&
    typeof value.port === "number" &&
    typeof value.enabled === "boolean"
  );
}

function isSshJumpConfig(value: unknown): value is SSHJumpConfig {
  if (!isRecord(value)) return false;
  return (
    typeof value.host === "string" || typeof value.connectionId === "string"
  );
}

function sshJumpToTunnelConfig(
  config: SSHJumpConfig,
): NonNullable<TunnelChainLayer["sshTunnel"]> {
  return {
    connectionId: config.connectionId,
    host: config.host,
    port: config.port,
    username: config.username,
    password: config.password,
    privateKey: config.privateKey,
    passphrase: config.passphrase,
    forwardType: "local",
    proxyCommand: config.proxyCommand
      ? { command: config.proxyCommand, template: "custom" }
      : config.proxyCommandTemplate
        ? { template: config.proxyCommandTemplate }
        : undefined,
    jumpHosts: config.jumpChain?.map((jump) => ({ ...jump })),
  };
}

function stripTunnelRuntime(layer: TunnelChainLayer): TunnelChainLayer {
  const result = cloneValue(layer);
  delete result.status;
  delete result.actualLocalPort;
  delete result.error;
  return result;
}

function deepMerge(base: unknown, override: unknown): unknown {
  if (!isRecord(base) || !isRecord(override)) return cloneValue(override);
  const result: Record<string, unknown> = cloneValue(base);
  Object.entries(override).forEach(([key, value]) => {
    if (value === undefined) return;
    result[key] =
      isRecord(result[key]) && isRecord(value)
        ? deepMerge(result[key], value)
        : cloneValue(value);
  });
  return result;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function cloneValue<T>(value: T): T {
  if (Array.isArray(value)) {
    return value.map((item) => cloneValue(item)) as T;
  }
  if (isRecord(value)) {
    return Object.fromEntries(
      Object.entries(value).map(([key, item]) => [key, cloneValue(item)]),
    ) as T;
  }
  return value;
}

const SECRET_KEY =
  /(?:password|passphrase|secret|token|private.?key|preshared.?key|auth.?key|tunnel.?key|client.?key|credential|custom.?headers|command|extra.?args|custom.?options)/i;

/**
 * Produce a deep diagnostic copy with credential-bearing values replaced.
 * The canonical runtime layers deliberately retain credentials; this helper
 * is the only supported way to inspect them in logs or generic UI tooling.
 */
export function redactNetworkPathSecrets(value: unknown): unknown {
  if (Array.isArray(value)) {
    return value.map((item) => redactNetworkPathSecrets(item));
  }
  if (!isRecord(value)) return value;

  return Object.fromEntries(
    Object.entries(value).map(([key, item]) => [
      key,
      SECRET_KEY.test(key)
        ? NETWORK_PATH_REDACTED
        : redactNetworkPathSecrets(item),
    ]),
  );
}
