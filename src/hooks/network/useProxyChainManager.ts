import { useState, useCallback, useEffect, useMemo } from "react";
import { invoke } from "@tauri-apps/api/core";
import { useConnections } from "../../contexts/useConnections";
import { ProxyOpenVPNManager } from "../../utils/proxyOpenVPNManager";
import { proxyCollectionManager } from "../../utils/proxyCollectionManager";
import {
  sshTunnelService,
  SSHTunnelConfig,
  SSHTunnelCreateParams,
} from "../../utils/sshTunnelService";
import { SavedProxyProfile, SavedProxyChain } from "../../types/settings";

// ─── Types ─────────────────────────────────────────────────────────

export interface ConnectionChainSummary {
  id: string;
  name: string;
  status: string;
  layers: Array<unknown>;
}

export interface ProxyChainSummary {
  id: string;
  name: string;
  status: string;
  layers: Array<unknown>;
}

export type ProxyTab = "profiles" | "chains" | "tunnels" | "associations";

// ─── Hook ──────────────────────────────────────────────────────────

export function useProxyChainManager(isOpen: boolean, onClose: () => void) {
  const { state, dispatch } = useConnections();
  const proxyManager = ProxyOpenVPNManager.getInstance();

  const [activeTab, setActiveTab] = useState<ProxyTab>("profiles");
  const [connectionChains, setConnectionChains] = useState<
    ConnectionChainSummary[]
  >([]);
  const [proxyChains, setProxyChains] = useState<ProxyChainSummary[]>([]);
  const [sshTunnels, setSshTunnels] = useState<SSHTunnelConfig[]>([]);
  const [savedProfiles, setSavedProfiles] = useState<SavedProxyProfile[]>([]);
  const [savedChains, setSavedChains] = useState<SavedProxyChain[]>([]);
  const [isLoading, setIsLoading] = useState(false);
  const [profileSearch, setProfileSearch] = useState("");
  const [chainSearch, setChainSearch] = useState("");

  // SSH Tunnel dialog state
  const [showTunnelDialog, setShowTunnelDialog] = useState(false);
  const [editingTunnel, setEditingTunnel] = useState<SSHTunnelConfig | null>(
    null,
  );

  // Profile editor dialog state
  const [showProfileEditor, setShowProfileEditor] = useState(false);
  const [editingProfile, setEditingProfile] =
    useState<SavedProxyProfile | null>(null);

  // Chain editor dialog state
  const [showChainEditor, setShowChainEditor] = useState(false);
  const [editingChain, setEditingChain] = useState<SavedProxyChain | null>(
    null,
  );

  const sshConnections = useMemo(
    () =>
      state.connections.filter(
        (conn) => conn.protocol === "ssh" && !conn.isGroup,
      ),
    [state.connections],
  );

  // ─── Data loading ───────────────────────────────────────────────

  const reloadChains = useCallback(async () => {
    setIsLoading(true);
    try {
      const [chains, proxies] = await Promise.all([
        proxyManager.listConnectionChains(),
        invoke<ProxyChainSummary[]>("list_proxy_chains"),
      ]);
      setConnectionChains(
        chains.map((chain: any) => ({
          id: chain.id,
          name: chain.name,
          status: chain.status,
          layers: chain.layers ?? [],
        })),
      );
      setProxyChains(
        (proxies ?? []).map((chain) => ({
          id: chain.id,
          name: chain.name,
          status: chain.status,
          layers: chain.layers ?? [],
        })),
      );
      setSshTunnels(sshTunnelService.getTunnels());
      setSavedProfiles(proxyCollectionManager.getProfiles());
      setSavedChains(proxyCollectionManager.getChains());
    } catch (error) {
      console.error("Failed to load proxy/vpn chains:", error);
    } finally {
      setIsLoading(false);
    }
  }, [proxyManager]);

  // ─── Effects ────────────────────────────────────────────────────

  useEffect(() => {
    if (isOpen) reloadChains();
  }, [isOpen, reloadChains]);

  useEffect(() => {
    const unsubscribe = sshTunnelService.subscribe(() => {
      setSshTunnels(sshTunnelService.getTunnels());
    });
    return unsubscribe;
  }, []);

  useEffect(() => {
    if (!isOpen) return;
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        if (showTunnelDialog) {
          setShowTunnelDialog(false);
          setEditingTunnel(null);
        } else if (showProfileEditor) {
          setShowProfileEditor(false);
          setEditingProfile(null);
        } else if (showChainEditor) {
          setShowChainEditor(false);
          setEditingChain(null);
        } else {
          onClose();
        }
      }
    };
    document.addEventListener("keydown", handleKeyDown);
    return () => document.removeEventListener("keydown", handleKeyDown);
  }, [isOpen, onClose, showTunnelDialog, showProfileEditor, showChainEditor]);

  // ─── Connection chain handlers ─────────────────────────────────

  const handleConnectChain = async (chainId: string) => {
    await proxyManager.connectConnectionChain(chainId);
    reloadChains();
  };

  const handleDisconnectChain = async (chainId: string) => {
    await proxyManager.disconnectConnectionChain(chainId);
    reloadChains();
  };

  const handleConnectProxyChain = async (chainId: string) => {
    const targetHost = prompt("Target host for this proxy chain:");
    if (!targetHost) return;
    const rawPort = prompt("Target port for this proxy chain:", "22");
    const targetPort = rawPort ? parseInt(rawPort, 10) : 0;
    if (!targetPort || Number.isNaN(targetPort)) return;
    await invoke("connect_proxy_chain", {
      chainId,
      targetHost,
      targetPort,
    });
    reloadChains();
  };

  const handleDisconnectProxyChain = async (chainId: string) => {
    await invoke("disconnect_proxy_chain", { chainId });
    reloadChains();
  };

  // ─── SSH Tunnel handlers ───────────────────────────────────────

  const handleSaveTunnel = async (params: SSHTunnelCreateParams) => {
    try {
      if (editingTunnel) {
        await sshTunnelService.updateTunnel(editingTunnel.id, params);
      } else {
        await sshTunnelService.createTunnel(params);
      }
      setShowTunnelDialog(false);
      setEditingTunnel(null);
    } catch (error) {
      console.error("Failed to create/update SSH tunnel:", error);
    }
  };

  const handleEditTunnel = (tunnel: SSHTunnelConfig) => {
    setEditingTunnel(tunnel);
    setShowTunnelDialog(true);
  };

  const handleNewTunnel = () => {
    setEditingTunnel(null);
    setShowTunnelDialog(true);
  };

  const handleDeleteTunnel = async (tunnelId: string) => {
    if (confirm("Are you sure you want to delete this SSH tunnel?")) {
      await sshTunnelService.deleteTunnel(tunnelId);
    }
  };

  const handleConnectTunnel = async (tunnelId: string) => {
    const tunnel = sshTunnelService.getTunnel(tunnelId);
    if (!tunnel) return;
    const sshConnection = state.connections.find(
      (c) => c.id === tunnel.sshConnectionId,
    );
    if (!sshConnection) {
      alert("SSH connection not found for this tunnel");
      return;
    }
    try {
      await sshTunnelService.connectTunnel(tunnelId, sshConnection);
    } catch (error) {
      console.error("Failed to connect SSH tunnel:", error);
    }
  };

  const handleDisconnectTunnel = async (tunnelId: string) => {
    await sshTunnelService.disconnectTunnel(tunnelId);
  };

  // ─── Proxy Profile handlers ────────────────────────────────────

  const handleNewProfile = () => {
    setEditingProfile(null);
    setShowProfileEditor(true);
  };

  const handleEditProfile = (profile: SavedProxyProfile) => {
    setEditingProfile(profile);
    setShowProfileEditor(true);
  };

  const handleSaveProfile = async (
    profileData: Omit<SavedProxyProfile, "id" | "createdAt" | "updatedAt">,
  ) => {
    try {
      if (editingProfile) {
        await proxyCollectionManager.updateProfile(
          editingProfile.id,
          profileData,
        );
      } else {
        await proxyCollectionManager.createProfile(
          profileData.name,
          profileData.config,
          {
            description: profileData.description,
            tags: profileData.tags,
            isDefault: profileData.isDefault,
          },
        );
      }
      setShowProfileEditor(false);
      setEditingProfile(null);
      setSavedProfiles(proxyCollectionManager.getProfiles());
    } catch (error) {
      console.error("Failed to save proxy profile:", error);
    }
  };

  const handleDeleteProfile = async (profileId: string) => {
    if (confirm("Are you sure you want to delete this proxy profile?")) {
      try {
        await proxyCollectionManager.deleteProfile(profileId);
        setSavedProfiles(proxyCollectionManager.getProfiles());
      } catch (error) {
        alert(
          error instanceof Error ? error.message : "Failed to delete profile",
        );
      }
    }
  };

  const handleDuplicateProfile = async (profileId: string) => {
    try {
      await proxyCollectionManager.duplicateProfile(profileId);
      setSavedProfiles(proxyCollectionManager.getProfiles());
    } catch (error) {
      console.error("Failed to duplicate profile:", error);
    }
  };

  const handleExportProfiles = async () => {
    try {
      const data = await proxyCollectionManager.exportData();
      const blob = new Blob([data], { type: "application/json" });
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = "proxy-profiles.json";
      a.click();
      URL.revokeObjectURL(url);
    } catch (error) {
      console.error("Failed to export profiles:", error);
    }
  };

  const handleImportProfiles = async () => {
    const input = document.createElement("input");
    input.type = "file";
    input.accept = ".json";
    input.onchange = async (e) => {
      const file = (e.target as HTMLInputElement).files?.[0];
      if (file) {
        try {
          const text = await file.text();
          await proxyCollectionManager.importData(text, true);
          setSavedProfiles(proxyCollectionManager.getProfiles());
          setSavedChains(proxyCollectionManager.getChains());
        } catch (error) {
          alert(
            "Failed to import profiles: " +
              (error instanceof Error ? error.message : "Unknown error"),
          );
        }
      }
    };
    input.click();
  };

  // ─── Saved Chain handlers ─────────────────────────────────────

  const handleNewChain = () => {
    setEditingChain(null);
    setShowChainEditor(true);
  };

  const handleEditChain = (chain: SavedProxyChain) => {
    setEditingChain(chain);
    setShowChainEditor(true);
  };

  const handleSaveChain = async (
    chainData: Omit<SavedProxyChain, "id" | "createdAt" | "updatedAt">,
  ) => {
    try {
      if (editingChain) {
        await proxyCollectionManager.updateChain(editingChain.id, chainData);
      } else {
        await proxyCollectionManager.createChain(
          chainData.name,
          chainData.layers,
          {
            description: chainData.description,
            tags: chainData.tags,
          },
        );
      }
      setShowChainEditor(false);
      setEditingChain(null);
      setSavedChains(proxyCollectionManager.getChains());
    } catch (error) {
      console.error("Failed to save proxy chain:", error);
    }
  };

  const handleDeleteChain = async (chainId: string) => {
    if (confirm("Are you sure you want to delete this proxy chain?")) {
      try {
        await proxyCollectionManager.deleteChain(chainId);
        setSavedChains(proxyCollectionManager.getChains());
      } catch (error) {
        alert(
          error instanceof Error ? error.message : "Failed to delete chain",
        );
      }
    }
  };

  const handleDuplicateChain = async (chainId: string) => {
    try {
      await proxyCollectionManager.duplicateChain(chainId);
      setSavedChains(proxyCollectionManager.getChains());
    } catch (error) {
      console.error("Failed to duplicate chain:", error);
    }
  };

  // ─── Derived data ─────────────────────────────────────────────

  const filteredProfiles = useMemo(() => {
    if (!profileSearch.trim()) return savedProfiles;
    return proxyCollectionManager.searchProfiles(profileSearch);
  }, [savedProfiles, profileSearch]);

  const filteredSavedChains = useMemo(() => {
    if (!chainSearch.trim()) return savedChains;
    return proxyCollectionManager.searchChains(chainSearch);
  }, [savedChains, chainSearch]);

  const connectionOptions = useMemo(
    () => state.connections.filter((conn) => !conn.isGroup),
    [state.connections],
  );

  // ─── Association helpers ──────────────────────────────────────

  const updateConnectionChain = (connectionId: string, value: string) => {
    const connection = state.connections.find(
      (conn) => conn.id === connectionId,
    );
    if (!connection) return;
    dispatch({
      type: "UPDATE_CONNECTION",
      payload: { ...connection, connectionChainId: value || undefined },
    });
  };

  const updateProxyChain = (connectionId: string, value: string) => {
    const connection = state.connections.find(
      (conn) => conn.id === connectionId,
    );
    if (!connection) return;
    dispatch({
      type: "UPDATE_CONNECTION",
      payload: { ...connection, proxyChainId: value || undefined },
    });
  };

  // ─── Dialog closers ───────────────────────────────────────────

  const closeTunnelDialog = () => {
    setShowTunnelDialog(false);
    setEditingTunnel(null);
  };

  const closeProfileEditor = () => {
    setShowProfileEditor(false);
    setEditingProfile(null);
  };

  const closeChainEditor = () => {
    setShowChainEditor(false);
    setEditingChain(null);
  };

  return {
    // Tab
    activeTab,
    setActiveTab,

    // Data
    connectionChains,
    proxyChains,
    sshTunnels,
    savedProfiles,
    savedChains,
    sshConnections,
    connectionOptions,
    connections: state.connections,
    isLoading,

    // Search
    profileSearch,
    setProfileSearch,
    chainSearch,
    setChainSearch,
    filteredProfiles,
    filteredSavedChains,

    // Connection chain actions
    reloadChains,
    handleConnectChain,
    handleDisconnectChain,
    handleConnectProxyChain,
    handleDisconnectProxyChain,

    // SSH Tunnel actions
    showTunnelDialog,
    editingTunnel,
    handleNewTunnel,
    handleEditTunnel,
    handleSaveTunnel,
    handleDeleteTunnel,
    handleConnectTunnel,
    handleDisconnectTunnel,
    closeTunnelDialog,

    // Profile actions
    showProfileEditor,
    editingProfile,
    handleNewProfile,
    handleEditProfile,
    handleSaveProfile,
    handleDeleteProfile,
    handleDuplicateProfile,
    handleExportProfiles,
    handleImportProfiles,
    closeProfileEditor,

    // Chain actions
    showChainEditor,
    editingChain,
    handleNewChain,
    handleEditChain,
    handleSaveChain,
    handleDeleteChain,
    handleDuplicateChain,
    closeChainEditor,

    // Association
    updateConnectionChain,
    updateProxyChain,
  };
}
