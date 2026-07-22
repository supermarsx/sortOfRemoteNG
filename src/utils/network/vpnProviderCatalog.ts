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
    iconKey: "shield",
    importExtensions: ["ovpn", "conf"],
  },
  {
    type: "wireguard",
    label: "WireGuard",
    executable: true,
    iconKey: "route",
    importExtensions: ["conf"],
  },
  {
    type: "tailscale",
    label: "Tailscale",
    executable: true,
    iconKey: "waypoints",
    importExtensions: [],
  },
  {
    type: "zerotier",
    label: "ZeroTier",
    executable: true,
    iconKey: "network",
    importExtensions: [],
  },
  {
    type: "pptp",
    label: "PPTP",
    executable: false,
    iconKey: "cable",
    unsupportedReason:
      "PPTP profiles are not yet stored persistently, so session associations are disabled.",
    importExtensions: [],
  },
  {
    type: "l2tp",
    label: "L2TP/IPsec",
    executable: false,
    iconKey: "link",
    unsupportedReason:
      "L2TP/IPsec profiles are not yet stored persistently, so session associations are disabled.",
    importExtensions: [],
  },
  {
    type: "ikev2",
    label: "IKEv2",
    executable: false,
    iconKey: "key-round",
    unsupportedReason:
      "IKEv2 profiles are not yet stored persistently, so session associations are disabled.",
    importExtensions: [],
  },
  {
    type: "ipsec",
    label: "IPsec",
    executable: false,
    iconKey: "shield-check",
    unsupportedReason:
      "IPsec profiles are not yet stored persistently, so session associations are disabled.",
    importExtensions: [],
  },
  {
    type: "sstp",
    label: "SSTP",
    executable: false,
    iconKey: "lock",
    unsupportedReason:
      "SSTP profiles are not yet stored persistently, so session associations are disabled.",
    importExtensions: [],
  },
  {
    type: "softether",
    label: "SoftEther",
    executable: false,
    iconKey: "shield-alert",
    unsupportedReason:
      "SoftEther session associations are unavailable because the backend is feature-gated and does not expose the persisted profile and lease-runtime contract.",
    importExtensions: [],
  },
] as const;

type VpnProviderDefinition = (typeof VPN_PROVIDER_CATALOG)[number];

export type KnownVpnProviderType = VpnProviderDefinition["type"];
export type ExecutableVpnType = Extract<
  VpnProviderDefinition,
  { executable: true }
>["type"];
export type SessionVpnType = Exclude<KnownVpnProviderType, "softether">;
export type LegacyVpnEditorType = SessionVpnType;

export const EXECUTABLE_VPN_PROVIDERS = VPN_PROVIDER_CATALOG.filter(
  (
    provider,
  ): provider is Extract<VpnProviderDefinition, { executable: true }> =>
    provider.executable,
);

/** Providers understood by the session pipeline, including gated candidates. */
export const SESSION_VPN_PROVIDERS = VPN_PROVIDER_CATALOG.filter(
  (
    provider,
  ): provider is Exclude<VpnProviderDefinition, { type: "softether" }> =>
    provider.type !== "softether",
);

const executableTypes = new Set<string>(
  EXECUTABLE_VPN_PROVIDERS.map((provider) => provider.type),
);
const sessionTypes = new Set<string>(
  SESSION_VPN_PROVIDERS.map((provider) => provider.type),
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

export function normalizeSessionVpnType(
  value: unknown,
): SessionVpnType | undefined {
  if (typeof value !== "string") return undefined;
  const normalized = value.trim().toLowerCase();
  return sessionTypes.has(normalized)
    ? (normalized as SessionVpnType)
    : undefined;
}

export function isSessionVpnType(value: unknown): value is SessionVpnType {
  return normalizeSessionVpnType(value) !== undefined;
}

export function getVpnProviderLabel(value: string): string {
  const normalized = value.trim().toLowerCase();
  return (
    VPN_PROVIDER_CATALOG.find((provider) => provider.type === normalized)
      ?.label ?? value
  );
}

export function getVpnProviderDefinition(value: string) {
  const normalized = value.trim().toLowerCase();
  return VPN_PROVIDER_CATALOG.find((provider) => provider.type === normalized);
}

export function getVpnProviderUnsupportedReason(
  value: string,
): string | undefined {
  const provider = getVpnProviderDefinition(value);
  return provider && !provider.executable
    ? provider.unsupportedReason
    : undefined;
}

export type VpnRoutingMode = "full" | "split";

/**
 * Route ownership belongs to the saved VPN profile, never to an SSH/RDP
 * target. A split tunnel must name its remote CIDRs explicitly; a full tunnel
 * uses the provider's native default-route contract.
 */
export interface VpnRoutingPolicy {
  mode: VpnRoutingMode;
  remoteSubnets: readonly string[];
}

export interface VpnProfileSummary {
  id: string;
  name: string;
  vpnType: SessionVpnType;
  status: string;
  host?: string;
  port?: number;
  localIp?: string;
  createdAt: Date;
  connectedAt?: Date;
  routing?: VpnRoutingPolicy;
  /** Present when the saved profile is intentionally not runnable yet. */
  connectDisabledReason?: string;
}

export type VpnProviderSnapshotStatus = "loaded" | "error" | "unsupported";

export interface VpnRuntimeCapability {
  vpnType: KnownVpnProviderType;
  executable: boolean;
  reason?: string;
}

export interface VpnProfileCatalogSnapshot {
  profiles: readonly VpnProfileSummary[];
  providerStatus: Partial<Record<SessionVpnType, VpnProviderSnapshotStatus>>;
  providerErrors?: Partial<Record<SessionVpnType, string>>;
  runtimeCapabilities?: Partial<
    Record<KnownVpnProviderType, VpnRuntimeCapability>
  >;
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
  if (!isSessionVpnType(layer.type)) return undefined;
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
