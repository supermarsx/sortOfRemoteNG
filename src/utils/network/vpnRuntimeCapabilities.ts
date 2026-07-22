import { invoke } from "@tauri-apps/api/core";
import {
  VPN_PROVIDER_CATALOG,
  type KnownVpnProviderType,
  type VpnRuntimeCapability,
} from "./vpnProviderCatalog";

const knownProviders = new Set<string>(
  VPN_PROVIDER_CATALOG.map((provider) => provider.type),
);

/** Load and strictly validate the backend's platform-scoped VPN contract. */
export async function loadVpnRuntimeCapabilities(): Promise<
  VpnRuntimeCapability[]
> {
  const response = await invoke<unknown>("get_vpn_runtime_capabilities");
  if (!Array.isArray(response)) {
    throw new Error("VPN runtime capability response is malformed");
  }

  const capabilities = new Map<KnownVpnProviderType, VpnRuntimeCapability>();
  for (const item of response) {
    if (!item || typeof item !== "object") {
      throw new Error("VPN runtime capability response is malformed");
    }
    const value = item as Record<string, unknown>;
    if (
      typeof value.vpnType !== "string" ||
      !knownProviders.has(value.vpnType) ||
      typeof value.executable !== "boolean" ||
      (value.reason !== undefined && typeof value.reason !== "string")
    ) {
      throw new Error("VPN runtime capability response is malformed");
    }
    const vpnType = value.vpnType as KnownVpnProviderType;
    if (capabilities.has(vpnType)) {
      throw new Error("VPN runtime capability response contains duplicates");
    }
    capabilities.set(vpnType, {
      vpnType,
      executable: value.executable,
      ...(value.reason ? { reason: value.reason } : {}),
    });
  }

  return VPN_PROVIDER_CATALOG.map((provider) => {
    const capability = capabilities.get(provider.type);
    return (
      capability ?? {
        vpnType: provider.type,
        executable: false,
        reason:
          "The backend did not report an executable runtime capability for this provider.",
      }
    );
  });
}
