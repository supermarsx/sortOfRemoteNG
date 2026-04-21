import { useState, useCallback, useEffect, useMemo } from "react";
import { invoke } from "@tauri-apps/api/core";
import { useConnections } from "../../contexts/useConnections";
import { proxyCollectionManager } from "../../utils/connection/proxyCollectionManager";
import { createToolSession } from "../../components/app/toolSession";
import type { SavedTunnelChain, SavedTunnelProfile } from "../../types/settings/vpnSettings";

// ── Types ─────────────────────────────────────────────────────────

export interface ActiveChainStatus {
  backendChainId: string;
  status: "disconnected" | "connecting" | "connected" | "disconnecting" | "error";
  error?: string;
}

// Map frontend TunnelType to backend ConnectionType for ad-hoc connect
function mapTunnelTypeToConnectionType(type: string): string | null {
  switch (type) {
    case "proxy":
    case "shadowsocks":
    case "tor":
      return "Proxy";
    case "openvpn":
      return "OpenVPN";
    case "wireguard":
      return "WireGuard";
    case "tailscale":
      return "Tailscale";
    case "zerotier":
      return "ZeroTier";
    default:
      return null; // SSH and generic tunnel types not supported for ad-hoc connect yet
  }
}

// ── Hook ──────────────────────────────────────────────────────────

export function useTunnelChainManager(isOpen: boolean) {
  const { dispatch } = useConnections();

  // ── State ──────────────────────────────────────────────────────
  const [tunnelChains, setTunnelChains] = useState<SavedTunnelChain[]>([]);
  const [tunnelProfiles, setTunnelProfiles] = useState<SavedTunnelProfile[]>([]);
  const [chainSearch, setChainSearch] = useState("");
  const [profileSearch, setProfileSearch] = useState("");
  const [activeStatuses, setActiveStatuses] = useState<Map<string, ActiveChainStatus>>(new Map());
  const [isLoading, setIsLoading] = useState(false);

  // ── Load data ──────────────────────────────────────────────────

  const reload = useCallback(() => {
    setTunnelChains(proxyCollectionManager.getTunnelChains());
    setTunnelProfiles(proxyCollectionManager.getTunnelProfiles());
  }, []);

  useEffect(() => {
    if (!isOpen) return;
    reload();

    const unsubscribe = proxyCollectionManager.subscribe(reload);
    return () => { unsubscribe(); };
  }, [isOpen, reload]);

  // ── Poll backend chain statuses ────────────────────────────────

  const refreshActiveStatuses = useCallback(async () => {
    try {
      const chains = await invoke<Array<{
        id: string;
        name: string;
        status: string | { Error: string };
        error?: string;
      }>>("list_connection_chains");

      const newStatuses = new Map<string, ActiveChainStatus>();
      for (const chain of chains) {
        // Match backend chain to frontend chain by name prefix
        const frontendChain = tunnelChains.find(tc =>
          chain.name === `adhoc:${tc.id}` || chain.name === tc.name
        );
        if (frontendChain) {
          const statusStr = typeof chain.status === "string"
            ? chain.status.toLowerCase()
            : "error";
          const errorStr = typeof chain.status === "object" && "Error" in chain.status
            ? chain.status.Error
            : chain.error;
          newStatuses.set(frontendChain.id, {
            backendChainId: chain.id,
            status: statusStr as ActiveChainStatus["status"],
            error: errorStr,
          });
        }
      }
      setActiveStatuses(newStatuses);
    } catch {
      // Backend may not be available
    }
  }, [tunnelChains]);

  useEffect(() => {
    if (!isOpen) return;
    refreshActiveStatuses();
    const interval = setInterval(refreshActiveStatuses, 5000);
    return () => clearInterval(interval);
  }, [isOpen, refreshActiveStatuses]);

  // ── Filtered lists ─────────────────────────────────────────────

  const filteredChains = useMemo(() => {
    if (!chainSearch.trim()) return tunnelChains;
    return proxyCollectionManager.searchTunnelChains(chainSearch);
  }, [tunnelChains, chainSearch]);

  const filteredProfiles = useMemo(() => {
    if (!profileSearch.trim()) return tunnelProfiles;
    return proxyCollectionManager.searchTunnelProfiles(profileSearch);
  }, [tunnelProfiles, profileSearch]);

  // ── Chain CRUD ─────────────────────────────────────────────────

  const handleNewChain = useCallback(() => {
    const session = createToolSession("tunnelChainEditor", { name: "New Tunnel Chain" });
    dispatch({ type: "ADD_SESSION", payload: session });
  }, [dispatch]);

  const handleEditChain = useCallback((chain: SavedTunnelChain) => {
    const session = createToolSession("tunnelChainEditor", {
      connectionId: chain.id,
      name: `Edit: ${chain.name}`,
    });
    dispatch({ type: "ADD_SESSION", payload: session });
  }, [dispatch]);

  const handleDuplicateChain = useCallback(async (id: string) => {
    await proxyCollectionManager.duplicateTunnelChain(id);
    reload();
  }, [reload]);

  const handleDeleteChain = useCallback(async (id: string) => {
    // Disconnect if active
    const status = activeStatuses.get(id);
    if (status && status.status === "connected") {
      try {
        await invoke("disconnect_connection_chain", { chainId: status.backendChainId });
        await invoke("delete_connection_chain", { chainId: status.backendChainId });
      } catch { /* ignore */ }
    }
    await proxyCollectionManager.deleteTunnelChain(id);
    reload();
  }, [activeStatuses, reload]);

  // ── Profile CRUD ───────────────────────────────────────────────

  const handleNewProfile = useCallback(() => {
    const session = createToolSession("tunnelProfileEditor", { name: "New Tunnel Profile" });
    dispatch({ type: "ADD_SESSION", payload: session });
  }, [dispatch]);

  const handleEditProfile = useCallback((profile: SavedTunnelProfile) => {
    const session = createToolSession("tunnelProfileEditor", {
      connectionId: profile.id,
      name: `Edit: ${profile.name}`,
    });
    dispatch({ type: "ADD_SESSION", payload: session });
  }, [dispatch]);

  const handleDuplicateProfile = useCallback(async (id: string) => {
    await proxyCollectionManager.duplicateTunnelProfile(id);
    reload();
  }, [reload]);

  const handleDeleteProfile = useCallback(async (id: string) => {
    try {
      await proxyCollectionManager.deleteTunnelProfile(id);
      reload();
    } catch (err) {
      console.error("Cannot delete tunnel profile:", err);
    }
  }, [reload]);

  // ── Ad-hoc connect/disconnect ──────────────────────────────────

  const handleConnectChain = useCallback(async (chainId: string) => {
    const chain = proxyCollectionManager.getTunnelChain(chainId);
    if (!chain) return;

    setIsLoading(true);
    try {
      // Build backend ChainLayer[] from frontend TunnelChainLayer[]
      const backendLayers = chain.layers
        .filter(l => l.enabled)
        .map((layer, idx) => {
          const connectionType = mapTunnelTypeToConnectionType(layer.type);
          if (!connectionType) {
            throw new Error(`Tunnel type "${layer.type}" does not support ad-hoc connect`);
          }
          return {
            id: layer.id,
            connection_type: connectionType,
            connection_id: layer.vpn?.configId || layer.mesh?.networkId || layer.proxy?.host || layer.id,
            position: idx,
            status: "Disconnected",
            local_port: null,
            error: null,
          };
        });

      if (backendLayers.length === 0) {
        throw new Error("No connectable layers in chain");
      }

      // Create chain in backend with a traceable name
      const backendChainId = await invoke<string>("create_connection_chain", {
        name: `adhoc:${chainId}`,
        description: chain.description,
        layers: backendLayers,
      });

      // Connect
      await invoke("connect_connection_chain", { chainId: backendChainId });

      setActiveStatuses(prev => {
        const next = new Map(prev);
        next.set(chainId, { backendChainId, status: "connected" });
        return next;
      });
    } catch (err) {
      const errorMsg = err instanceof Error ? err.message : String(err);
      setActiveStatuses(prev => {
        const next = new Map(prev);
        next.set(chainId, { backendChainId: "", status: "error", error: errorMsg });
        return next;
      });
    } finally {
      setIsLoading(false);
    }
  }, []);

  const handleDisconnectChain = useCallback(async (chainId: string) => {
    const status = activeStatuses.get(chainId);
    if (!status?.backendChainId) return;

    setIsLoading(true);
    try {
      await invoke("disconnect_connection_chain", { chainId: status.backendChainId });
      await invoke("delete_connection_chain", { chainId: status.backendChainId });

      setActiveStatuses(prev => {
        const next = new Map(prev);
        next.delete(chainId);
        return next;
      });
    } catch (err) {
      console.error("Failed to disconnect chain:", err);
    } finally {
      setIsLoading(false);
    }
  }, [activeStatuses]);

  // ── Return ─────────────────────────────────────────────────────

  return {
    // Data
    tunnelChains,
    tunnelProfiles,
    filteredChains,
    filteredProfiles,
    activeStatuses,
    isLoading,

    // Search
    chainSearch,
    setChainSearch,
    profileSearch,
    setProfileSearch,

    // Chain CRUD
    handleNewChain,
    handleEditChain,
    handleDuplicateChain,
    handleDeleteChain,

    // Profile CRUD
    handleNewProfile,
    handleEditProfile,
    handleDuplicateProfile,
    handleDeleteProfile,

    // Ad-hoc connect/disconnect
    handleConnectChain,
    handleDisconnectChain,

    // Reload
    reload,
    refreshActiveStatuses,
  };
}

export type TunnelChainManager = ReturnType<typeof useTunnelChainManager>;
