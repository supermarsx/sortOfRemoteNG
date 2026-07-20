import type { TunnelChainLayer } from "../../types/connection/connection";

/**
 * Product-level VPN capability catalog.
 *
 * A provider is executable only when its profiles are persisted by the
 * backend, manageable from the VPN library, and consumable by session
 * lifecycle leases. Low-level provider commands alone are not enough to make
 * a provider user-selectable.
 */
export const VPN_PROVIDER_CATALOG = [
  {
    type: "openvpn",
    label: "OpenVPN",
    executable: true,
    importExtensions: ["ovpn", "conf"],
  },
  {
    type: "wireguard",
    label: "WireGuard",
    executable: true,
    importExtensions: ["conf"],
  },
  {
    type: "tailscale",
    label: "Tailscale",
    executable: true,
    importExtensions: [],
  },
  {
    type: "zerotier",
    label: "ZeroTier",
    executable: true,
    importExtensions: [],
  },
  {
    type: "pptp",
    label: "PPTP",
    executable: false,
    importExtensions: [],
  },
  {
    type: "l2tp",
    label: "L2TP/IPsec",
    executable: false,
    importExtensions: [],
  },
  {
    type: "ikev2",
    label: "IKEv2",
    executable: false,
    importExtensions: [],
  },
  {
    type: "ipsec",
    label: "IPsec",
    executable: false,
    importExtensions: [],
  },
  {
    type: "sstp",
    label: "SSTP",
    executable: false,
    importExtensions: [],
  },
  {
    type: "softether",
    label: "SoftEther",
    executable: false,
    importExtensions: [],
  },
] as const;

type VpnProviderDefinition = (typeof VPN_PROVIDER_CATALOG)[number];

export type KnownVpnProviderType = VpnProviderDefinition["type"];
export type ExecutableVpnType = Extract<
  VpnProviderDefinition,
  { executable: true }
>["type"];
export type LegacyVpnEditorType = Exclude<KnownVpnProviderType, "softether">;

export const EXECUTABLE_VPN_PROVIDERS = VPN_PROVIDER_CATALOG.filter(
  (
    provider,
  ): provider is Extract<VpnProviderDefinition, { executable: true }> =>
    provider.executable,
);

const executableTypes = new Set<string>(
  EXECUTABLE_VPN_PROVIDERS.map((provider) => provider.type),
);

export function normalizeExecutableVpnType(
  value: unknown,
): ExecutableVpnType | undefined {
  if (typeof value !== "string") return undefined;
  const normalized = value.trim().toLowerCase();
  return executableTypes.has(normalized)
    ? (normalized as ExecutableVpnType)
    : undefined;
}

export function isExecutableVpnType(
  value: unknown,
): value is ExecutableVpnType {
  return normalizeExecutableVpnType(value) !== undefined;
}

export function getVpnProviderLabel(value: string): string {
  const normalized = value.trim().toLowerCase();
  return (
    VPN_PROVIDER_CATALOG.find((provider) => provider.type === normalized)
      ?.label ?? value
  );
}

export interface VpnProfileSummary {
  id: string;
  name: string;
  vpnType: ExecutableVpnType;
  status: string;
  host?: string;
  port?: number;
  localIp?: string;
  createdAt: Date;
  connectedAt?: Date;
  /** Present when the saved profile is intentionally not runnable yet. */
  connectDisabledReason?: string;
}

export type VpnProviderSnapshotStatus = "loaded" | "error";

export interface VpnProfileCatalogSnapshot {
  profiles: readonly VpnProfileSummary[];
  providerStatus: Partial<Record<ExecutableVpnType, VpnProviderSnapshotStatus>>;
  providerErrors?: Partial<Record<ExecutableVpnType, string>>;
}

/**
 * Resolve a saved profile reference from modern and legacy tunnel layers.
 *
 * `vpn.configId` is the canonical profile ID. `mesh.networkId` was used by
 * older mesh imports. Falling back to `layer.id` preserves old data that used
 * the layer identity as the profile identity; new writes must not do that.
 */
export function resolveTunnelLayerVpnProfileId(
  layer: Pick<TunnelChainLayer, "id" | "type" | "vpn" | "mesh">,
): string | undefined {
  if (!isExecutableVpnType(layer.type)) return undefined;
  if (
    layer.vpn &&
    Object.prototype.hasOwnProperty.call(layer.vpn, "configId")
  ) {
    return nonEmpty(layer.vpn.configId);
  }
  if (
    layer.mesh &&
    Object.prototype.hasOwnProperty.call(layer.mesh, "networkId")
  ) {
    return nonEmpty(layer.mesh.networkId);
  }
  return nonEmpty(layer.id);
}

/** Write a canonical saved-profile reference without changing layer identity. */
export function withTunnelLayerVpnProfileId(
  layer: TunnelChainLayer,
  profileId: string,
): TunnelChainLayer {
  return {
    ...layer,
    vpn: {
      ...layer.vpn,
      configId: profileId,
    },
  };
}

function nonEmpty(value: string | undefined): string | undefined {
  const trimmed = value?.trim();
  return trimmed || undefined;
}
