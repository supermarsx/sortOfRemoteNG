import { useState, useCallback, useEffect, useMemo } from "react";
import { listen, type UnlistenFn } from "@tauri-apps/api/event";
import { ProxyOpenVPNManager } from "../../utils/network/proxyOpenVPNManager";
import {
  getVpnProviderLabel,
  normalizeExecutableVpnType,
  type ExecutableVpnType,
  type VpnProfileCatalogSnapshot,
  type VpnProfileSummary,
} from "../../utils/network/vpnProviderCatalog";
import { loadVpnProfileCatalog } from "../../utils/network/vpnProfiles";

// ─── Types ─────────────────────────────────────────────────────────

export type VpnTypeFilter = "all" | ExecutableVpnType;
export type NormalizedVpnConnection = VpnProfileSummary;

const EMPTY_VPN_CONNECTIONS: readonly NormalizedVpnConnection[] = [];

// ─── Hook ──────────────────────────────────────────────────────────

export function useVpnManager(isOpen: boolean) {
  const mgr = ProxyOpenVPNManager.getInstance();

  const [profileCatalog, setProfileCatalog] =
    useState<VpnProfileCatalogSnapshot>();

  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [searchTerm, setSearchTerm] = useState("");
  const [typeFilter, setTypeFilter] = useState<VpnTypeFilter>("all");

  // ── Load all connections ─────────────────────────────────────────

  const loadConnections = useCallback(async () => {
    setIsLoading(true);
    setError(null);
    try {
      const nextCatalog = await loadVpnProfileCatalog(mgr);
      setProfileCatalog(nextCatalog);
      const failedProviders = Object.entries(nextCatalog.providerStatus)
        .filter(([, status]) => status === "error")
        .map(([vpnType]) => getVpnProviderLabel(vpnType));
      if (failedProviders.length > 0) {
        setError(
          `Could not load ${failedProviders.join(", ")} profiles. Their saved associations cannot be verified yet.`,
        );
      }
    } catch (err) {
      setError(
        err instanceof Error ? err.message : "Failed to load VPN connections",
      );
    } finally {
      setIsLoading(false);
    }
  }, [mgr]);

  useEffect(() => {
    if (isOpen) {
      loadConnections();
    }
  }, [isOpen, loadConnections]);

  // ── Listen for backend status-changed events ────────────────────

  useEffect(() => {
    if (!isOpen) return;
    let unlisten: UnlistenFn | undefined;

    listen("vpn::status-changed", () => {
      loadConnections();
    }).then((fn) => {
      unlisten = fn;
    });

    return () => {
      unlisten?.();
    };
  }, [isOpen, loadConnections]);

  // ── Poll status at a regular interval ───────────────────────────

  useEffect(() => {
    if (!isOpen) return;
    const interval = setInterval(() => {
      loadConnections();
    }, 10000); // 10 second default polling

    return () => clearInterval(interval);
  }, [isOpen, loadConnections]);

  // ── Normalize into a single list ─────────────────────────────────

  const allConnections = profileCatalog?.profiles ?? EMPTY_VPN_CONNECTIONS;

  // ── Filter connections ───────────────────────────────────────────

  const connections = useMemo(() => {
    let filtered = allConnections;

    if (typeFilter !== "all") {
      filtered = filtered.filter((c) => c.vpnType === typeFilter);
    }

    if (searchTerm.trim()) {
      const term = searchTerm.toLowerCase();
      filtered = filtered.filter(
        (c) =>
          c.name.toLowerCase().includes(term) ||
          c.host?.toLowerCase().includes(term) ||
          c.vpnType.toLowerCase().includes(term),
      );
    }

    return filtered;
  }, [allConnections, typeFilter, searchTerm]);

  // ── Actions ──────────────────────────────────────────────────────

  const connectVpn = useCallback(
    async (id: string, vpnType: string) => {
      try {
        setError(null);
        const provider = requireExecutableProvider(vpnType);
        switch (provider) {
          case "openvpn":
            await mgr.connectOpenVPN(id);
            break;
          case "wireguard":
            await mgr.connectWireGuard(id);
            break;
          case "tailscale":
            await mgr.connectTailscale(id);
            break;
          case "zerotier":
            await mgr.connectZeroTier(id);
            break;
        }
        await loadConnections();
      } catch (err) {
        setError(
          err instanceof Error ? err.message : `Failed to connect ${vpnType}`,
        );
      }
    },
    [mgr, loadConnections],
  );

  const disconnectVpn = useCallback(
    async (id: string, vpnType: string) => {
      try {
        setError(null);
        const provider = requireExecutableProvider(vpnType);
        switch (provider) {
          case "openvpn":
            await mgr.disconnectOpenVPN(id);
            break;
          case "wireguard":
            await mgr.disconnectWireGuard(id);
            break;
          case "tailscale":
            await mgr.disconnectTailscale(id);
            break;
          case "zerotier":
            await mgr.disconnectZeroTier(id);
            break;
        }
        await loadConnections();
      } catch (err) {
        setError(
          err instanceof Error
            ? err.message
            : `Failed to disconnect ${vpnType}`,
        );
      }
    },
    [mgr, loadConnections],
  );

  const deleteVpn = useCallback(
    async (id: string, vpnType: string) => {
      try {
        setError(null);
        const provider = requireExecutableProvider(vpnType);
        switch (provider) {
          case "openvpn":
            await mgr.deleteOpenVPNConnection(id);
            break;
          case "wireguard":
            await mgr.deleteWireGuardConnection(id);
            break;
          case "tailscale":
            await mgr.deleteTailscaleConnection(id);
            break;
          case "zerotier":
            await mgr.deleteZeroTierConnection(id);
            break;
        }
        await loadConnections();
      } catch (err) {
        setError(
          err instanceof Error
            ? err.message
            : `Failed to delete ${vpnType} connection`,
        );
      }
    },
    [mgr, loadConnections],
  );

  const importOvpn = useCallback(
    async (name: string, configContent: string) => {
      try {
        setError(null);
        await mgr.createOpenVPNConnectionFromOvpn(name, configContent);
        await loadConnections();
      } catch (err) {
        setError(
          err instanceof Error
            ? err.message
            : "Failed to import OpenVPN config",
        );
      }
    },
    [mgr, loadConnections],
  );

  const importWireGuard = useCallback(
    async (name: string, configContent: string) => {
      try {
        setError(null);
        await mgr.createWireGuardConnectionFromConf(name, configContent);
        await loadConnections();
      } catch (err) {
        setError(
          err instanceof Error
            ? err.message
            : "Failed to import WireGuard config",
        );
        throw err;
      }
    },
    [mgr, loadConnections],
  );

  const createVpn = useCallback(
    async (name: string, vpnType: string, config: Record<string, unknown>) => {
      try {
        setError(null);
        const provider = requireExecutableProvider(vpnType);
        switch (provider) {
          case "openvpn":
            await mgr.createOpenVPNConnection(name, config);
            break;
          case "wireguard":
            await mgr.createWireGuardConnection(name, config);
            break;
          case "tailscale":
            await mgr.createTailscaleConnection(name, config);
            break;
          case "zerotier":
            await mgr.createZeroTierConnection(name, config);
            break;
        }
        await loadConnections();
      } catch (err) {
        setError(
          err instanceof Error
            ? err.message
            : `Failed to create ${vpnType} connection`,
        );
        throw err;
      }
    },
    [mgr, loadConnections],
  );

  const updateVpn = useCallback(
    async (
      id: string,
      vpnType: string,
      name?: string,
      config?: Record<string, unknown>,
    ) => {
      try {
        setError(null);
        const provider = requireExecutableProvider(vpnType);
        switch (provider) {
          case "openvpn":
            await mgr.updateOpenVPNConnection(id, name, config);
            break;
          case "wireguard":
            await mgr.updateWireGuardConnection(id, name, config);
            break;
          case "tailscale":
            await mgr.updateTailscaleConnection(id, name, config);
            break;
          case "zerotier":
            await mgr.updateZeroTierConnection(id, name, config);
            break;
        }
        await loadConnections();
      } catch (err) {
        setError(
          err instanceof Error
            ? err.message
            : `Failed to update ${vpnType} connection`,
        );
        throw err;
      }
    },
    [mgr, loadConnections],
  );

  return {
    connections,
    profileCatalog,
    isLoading,
    error,
    searchTerm,
    setSearchTerm,
    typeFilter,
    setTypeFilter,
    loadConnections,
    connectVpn,
    disconnectVpn,
    deleteVpn,
    importOvpn,
    importWireGuard,
    createVpn,
    updateVpn,
  };
}

function requireExecutableProvider(vpnType: string): ExecutableVpnType {
  const provider = normalizeExecutableVpnType(vpnType);
  if (!provider) throw new Error(`Unsupported VPN type: ${vpnType}`);
  return provider;
}
