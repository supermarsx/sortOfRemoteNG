import type {
  IKEv2Connection,
  IPsecConnection,
  L2TPConnection,
  OpenVPNConnection,
  PPTPConnection,
  SSTPConnection,
  TailscaleConnection,
  WireGuardConnection,
  ZeroTierConnection,
} from "./proxyOpenVPNManager";
import type {
  KnownVpnProviderType,
  SessionVpnType,
  VpnProfileCatalogSnapshot,
  VpnProfileSummary,
  VpnRuntimeCapability,
} from "./vpnProviderCatalog";
import {
  SESSION_VPN_PROVIDERS,
  VPN_PROVIDER_CATALOG,
} from "./vpnProviderCatalog";
import { resolveVpnRoutingPolicy } from "./vpnRoutingPolicy";
import { loadVpnRuntimeCapabilities } from "./vpnRuntimeCapabilities";

export interface VpnProfileManager {
  listOpenVPNConnections(): Promise<OpenVPNConnection[]>;
  listWireGuardConnections(): Promise<WireGuardConnection[]>;
  listTailscaleConnections(): Promise<TailscaleConnection[]>;
  listZeroTierConnections(): Promise<ZeroTierConnection[]>;
  listPPTPConnections(): Promise<PPTPConnection[]>;
  listL2TPConnections(): Promise<L2TPConnection[]>;
  listIKEv2Connections(): Promise<IKEv2Connection[]>;
  listIPsecConnections(): Promise<IPsecConnection[]>;
  listSSTPConnections(): Promise<SSTPConnection[]>;
}

/**
 * Load every executable provider independently. The returned per-provider
 * status lets callers distinguish a genuinely deleted profile from a provider
 * store that is still loading or could not be read.
 */
export async function loadVpnProfileCatalog(
  manager: VpnProfileManager,
  capabilityLoader: () => Promise<
    VpnRuntimeCapability[]
  > = loadVpnRuntimeCapabilities,
): Promise<VpnProfileCatalogSnapshot> {
  const loaders: Record<SessionVpnType, () => Promise<VpnProfileSummary[]>> = {
    openvpn: async () =>
      (await manager.listOpenVPNConnections()).map(normalizeOpenVpn),
    wireguard: async () =>
      (await manager.listWireGuardConnections()).map(normalizeWireGuard),
    tailscale: async () =>
      (await manager.listTailscaleConnections()).map(normalizeTailscale),
    zerotier: async () =>
      (await manager.listZeroTierConnections()).map(normalizeZeroTier),
    pptp: async () =>
      (await manager.listPPTPConnections()).map((connection) =>
        normalizeLegacy(connection, "pptp"),
      ),
    l2tp: async () =>
      (await manager.listL2TPConnections()).map((connection) =>
        normalizeLegacy(connection, "l2tp"),
      ),
    ikev2: async () =>
      (await manager.listIKEv2Connections()).map((connection) =>
        normalizeLegacy(connection, "ikev2"),
      ),
    ipsec: async () =>
      (await manager.listIPsecConnections()).map((connection) =>
        normalizeLegacy(connection, "ipsec"),
      ),
    sstp: async () =>
      (await manager.listSSTPConnections()).map((connection) =>
        normalizeLegacy(connection, "sstp"),
      ),
  };
  const [capabilityResult, ...settled] = await Promise.allSettled([
    capabilityLoader(),
    ...SESSION_VPN_PROVIDERS.map((provider) => loaders[provider.type]()),
  ]);

  const profiles: VpnProfileSummary[] = [];
  const providerStatus: VpnProfileCatalogSnapshot["providerStatus"] = {};
  const providerErrors: NonNullable<
    VpnProfileCatalogSnapshot["providerErrors"]
  > = {};
  const runtimeCapabilities: NonNullable<
    VpnProfileCatalogSnapshot["runtimeCapabilities"]
  > = {};

  if (capabilityResult.status === "fulfilled") {
    for (const capability of capabilityResult.value) {
      if (
        VPN_PROVIDER_CATALOG.some(
          (provider) => provider.type === capability.vpnType,
        )
      ) {
        runtimeCapabilities[capability.vpnType as KnownVpnProviderType] = {
          ...capability,
        };
      }
    }
  }

  settled.forEach((result, index) => {
    const vpnType = SESSION_VPN_PROVIDERS[index].type;
    if (result.status === "rejected") {
      providerStatus[vpnType] = "error";
      providerErrors[vpnType] = errorMessage(result.reason);
      return;
    }

    const capability = runtimeCapabilities[vpnType];
    let runtimeDisabledReason: string | undefined;
    if (capabilityResult.status === "rejected" || !capability) {
      providerStatus[vpnType] = "error";
      providerErrors[vpnType] =
        "VPN runtime capabilities could not be verified for this platform.";
    } else if (!capability.executable) {
      providerStatus[vpnType] = "unsupported";
      runtimeDisabledReason =
        capability.reason ?? `${vpnType} is not executable on this platform.`;
      providerErrors[vpnType] = runtimeDisabledReason;
    } else {
      providerStatus[vpnType] = "loaded";
    }
    profiles.push(
      ...result.value.map((profile) =>
        runtimeDisabledReason && !profile.connectDisabledReason
          ? { ...profile, connectDisabledReason: runtimeDisabledReason }
          : profile,
      ),
    );
  });

  const providerOrder = new Map(
    SESSION_VPN_PROVIDERS.map((provider, index) => [provider.type, index]),
  );
  profiles.sort(
    (left, right) =>
      (providerOrder.get(left.vpnType) ?? 0) -
        (providerOrder.get(right.vpnType) ?? 0) ||
      left.name.localeCompare(right.name, undefined, { sensitivity: "base" }) ||
      left.id.localeCompare(right.id),
  );

  return {
    profiles,
    providerStatus,
    ...(Object.keys(providerErrors).length > 0 ? { providerErrors } : {}),
    runtimeCapabilities,
  };
}

function normalizeOpenVpn(connection: OpenVPNConnection): VpnProfileSummary {
  return common(connection, "openvpn", {
    host: connection.config?.remoteHost,
    port: connection.config?.remotePort,
    localIp: connection.localIp,
  });
}

function normalizeWireGuard(
  connection: WireGuardConnection,
): VpnProfileSummary {
  const endpoint = splitEndpoint(connection.config?.peer?.endpoint);
  return common(connection, "wireguard", {
    host: endpoint.host,
    port: endpoint.port,
    localIp: connection.localIp,
    connectDisabledReason:
      connection.secretPresence?.privateKey === false &&
      !connection.config?.configFile
        ? "WireGuard private key is not stored. Edit the profile and supply a key before connecting."
        : undefined,
  });
}

function normalizeTailscale(
  connection: TailscaleConnection,
): VpnProfileSummary {
  return common(connection, "tailscale", {
    host: connection.config?.loginServer,
    localIp: connection.tailnetIp,
  });
}

function normalizeZeroTier(connection: ZeroTierConnection): VpnProfileSummary {
  return common(connection, "zerotier", {
    host: connection.config?.networkId,
  });
}

function normalizeLegacy(
  connection:
    | PPTPConnection
    | L2TPConnection
    | IKEv2Connection
    | IPsecConnection
    | SSTPConnection,
  vpnType: Extract<
    SessionVpnType,
    "pptp" | "l2tp" | "ikev2" | "ipsec" | "sstp"
  >,
): VpnProfileSummary {
  const routingResult =
    vpnType === "ikev2" || vpnType === "ipsec"
      ? resolveVpnRoutingPolicy(connection.config)
      : {};
  return common(connection, vpnType, {
    host: connection.config.server,
    localIp: connection.localIp,
    ...(routingResult.policy ? { routing: routingResult.policy } : {}),
    ...(routingResult.connectDisabledReason
      ? { connectDisabledReason: routingResult.connectDisabledReason }
      : {}),
  });
}

function common(
  connection: {
    id: string;
    name: string;
    status: string;
    createdAt: Date;
    connectedAt?: Date;
  },
  vpnType: SessionVpnType,
  details: Pick<
    VpnProfileSummary,
    "host" | "port" | "localIp" | "connectDisabledReason" | "routing"
  >,
): VpnProfileSummary {
  return {
    id: connection.id,
    name: connection.name,
    vpnType,
    status: connection.status,
    createdAt: connection.createdAt,
    connectedAt: connection.connectedAt,
    ...details,
  };
}

function splitEndpoint(endpoint?: string): { host?: string; port?: number } {
  if (!endpoint) return {};
  const bracketed = endpoint.match(/^\[([^\]]+)](?::(\d+))?$/);
  if (bracketed) {
    return {
      host: bracketed[1],
      port: bracketed[2] ? Number(bracketed[2]) : undefined,
    };
  }
  const separator = endpoint.lastIndexOf(":");
  if (separator <= 0 || endpoint.indexOf(":") !== separator) {
    return { host: endpoint };
  }
  const port = Number(endpoint.slice(separator + 1));
  return {
    host: endpoint.slice(0, separator),
    port: Number.isInteger(port) && port > 0 ? port : undefined,
  };
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
