import type {
  OpenVPNConnection,
  TailscaleConnection,
  WireGuardConnection,
  ZeroTierConnection,
} from "./proxyOpenVPNManager";
import type {
  ExecutableVpnType,
  VpnProfileCatalogSnapshot,
  VpnProfileSummary,
} from "./vpnProviderCatalog";
import { EXECUTABLE_VPN_PROVIDERS } from "./vpnProviderCatalog";

export interface VpnProfileManager {
  listOpenVPNConnections(): Promise<OpenVPNConnection[]>;
  listWireGuardConnections(): Promise<WireGuardConnection[]>;
  listTailscaleConnections(): Promise<TailscaleConnection[]>;
  listZeroTierConnections(): Promise<ZeroTierConnection[]>;
}

/**
 * Load every executable provider independently. The returned per-provider
 * status lets callers distinguish a genuinely deleted profile from a provider
 * store that is still loading or could not be read.
 */
export async function loadVpnProfileCatalog(
  manager: VpnProfileManager,
): Promise<VpnProfileCatalogSnapshot> {
  const loaders: Record<ExecutableVpnType, () => Promise<VpnProfileSummary[]>> =
    {
      openvpn: async () =>
        (await manager.listOpenVPNConnections()).map(normalizeOpenVpn),
      wireguard: async () =>
        (await manager.listWireGuardConnections()).map(normalizeWireGuard),
      tailscale: async () =>
        (await manager.listTailscaleConnections()).map(normalizeTailscale),
      zerotier: async () =>
        (await manager.listZeroTierConnections()).map(normalizeZeroTier),
    };
  const settled = await Promise.allSettled(
    EXECUTABLE_VPN_PROVIDERS.map((provider) => loaders[provider.type]()),
  );

  const profiles: VpnProfileSummary[] = [];
  const providerStatus: VpnProfileCatalogSnapshot["providerStatus"] = {};
  const providerErrors: NonNullable<
    VpnProfileCatalogSnapshot["providerErrors"]
  > = {};

  settled.forEach((result, index) => {
    const vpnType = EXECUTABLE_VPN_PROVIDERS[index].type;
    if (result.status === "rejected") {
      providerStatus[vpnType] = "error";
      providerErrors[vpnType] = errorMessage(result.reason);
      return;
    }

    providerStatus[vpnType] = "loaded";
    profiles.push(...result.value);
  });

  const providerOrder = new Map(
    EXECUTABLE_VPN_PROVIDERS.map((provider, index) => [provider.type, index]),
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

function common(
  connection: {
    id: string;
    name: string;
    status: string;
    createdAt: Date;
    connectedAt?: Date;
  },
  vpnType: ExecutableVpnType,
  details: Pick<
    VpnProfileSummary,
    "host" | "port" | "localIp" | "connectDisabledReason"
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
