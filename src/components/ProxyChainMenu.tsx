import React, { useCallback, useEffect, useMemo, useState } from "react";
import { X, RefreshCw, Link2, Network, PlugZap, Route, Plus, Trash2, Play, Square, Edit2, Wifi, Copy, Search, Download, Upload } from "lucide-react";
import { invoke } from "@tauri-apps/api/core";
import { useConnections } from "../contexts/useConnections";
import { ProxyOpenVPNManager } from "../utils/proxyOpenVPNManager";
import { proxyCollectionManager } from "../utils/proxyCollectionManager";
import { sshTunnelService, SSHTunnelConfig, SSHTunnelCreateParams } from "../utils/sshTunnelService";
import { SSHTunnelDialog } from "./SSHTunnelDialog";
import { ProxyProfileEditor } from "./ProxyProfileEditor";
import { ProxyChainEditor } from "./ProxyChainEditor";
import { SavedProxyProfile, SavedProxyChain } from "../types/settings";

interface ProxyChainMenuProps {
  isOpen: boolean;
  onClose: () => void;
}

interface ConnectionChainSummary {
  id: string;
  name: string;
  status: string;
  layers: Array<unknown>;
}

interface ProxyChainSummary {
  id: string;
  name: string;
  status: string;
  layers: Array<unknown>;
}

export const ProxyChainMenu: React.FC<ProxyChainMenuProps> = ({ isOpen, onClose }) => {
  const { state, dispatch } = useConnections();
  const proxyManager = ProxyOpenVPNManager.getInstance();
  const [activeTab, setActiveTab] = useState<"profiles" | "chains" | "tunnels" | "associations">("profiles");
  const [connectionChains, setConnectionChains] = useState<ConnectionChainSummary[]>([]);
  const [proxyChains, setProxyChains] = useState<ProxyChainSummary[]>([]);
  const [sshTunnels, setSshTunnels] = useState<SSHTunnelConfig[]>([]);
  const [savedProfiles, setSavedProfiles] = useState<SavedProxyProfile[]>([]);
  const [savedChains, setSavedChains] = useState<SavedProxyChain[]>([]);
  const [isLoading, setIsLoading] = useState(false);
  const [profileSearch, setProfileSearch] = useState('');
  const [chainSearch, setChainSearch] = useState('');
  
  // SSH Tunnel dialog state
  const [showTunnelDialog, setShowTunnelDialog] = useState(false);
  const [editingTunnel, setEditingTunnel] = useState<SSHTunnelConfig | null>(null);
  
  // Profile editor dialog state
  const [showProfileEditor, setShowProfileEditor] = useState(false);
  const [editingProfile, setEditingProfile] = useState<SavedProxyProfile | null>(null);
  
  // Chain editor dialog state
  const [showChainEditor, setShowChainEditor] = useState(false);
  const [editingChain, setEditingChain] = useState<SavedProxyChain | null>(null);

  const sshConnections = useMemo(
    () => state.connections.filter((conn) => conn.protocol === "ssh" && !conn.isGroup),
    [state.connections]
  );

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

  useEffect(() => {
    if (isOpen) {
      reloadChains();
    }
  }, [isOpen, reloadChains]);
  
  // Subscribe to SSH tunnel changes
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

  // SSH Tunnel handlers
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
    
    const sshConnection = state.connections.find(c => c.id === tunnel.sshConnectionId);
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

  // Proxy Profile handlers
  const handleNewProfile = () => {
    setEditingProfile(null);
    setShowProfileEditor(true);
  };

  const handleEditProfile = (profile: SavedProxyProfile) => {
    setEditingProfile(profile);
    setShowProfileEditor(true);
  };

  const handleSaveProfile = async (profileData: Omit<SavedProxyProfile, 'id' | 'createdAt' | 'updatedAt'>) => {
    try {
      if (editingProfile) {
        await proxyCollectionManager.updateProfile(editingProfile.id, profileData);
      } else {
        await proxyCollectionManager.createProfile(profileData.name, profileData.config, {
          description: profileData.description,
          tags: profileData.tags,
          isDefault: profileData.isDefault,
        });
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
        alert(error instanceof Error ? error.message : "Failed to delete profile");
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
      const blob = new Blob([data], { type: 'application/json' });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = 'proxy-profiles.json';
      a.click();
      URL.revokeObjectURL(url);
    } catch (error) {
      console.error("Failed to export profiles:", error);
    }
  };

  const handleImportProfiles = async () => {
    const input = document.createElement('input');
    input.type = 'file';
    input.accept = '.json';
    input.onchange = async (e) => {
      const file = (e.target as HTMLInputElement).files?.[0];
      if (file) {
        try {
          const text = await file.text();
          await proxyCollectionManager.importData(text, true);
          setSavedProfiles(proxyCollectionManager.getProfiles());
          setSavedChains(proxyCollectionManager.getChains());
        } catch (error) {
          alert("Failed to import profiles: " + (error instanceof Error ? error.message : "Unknown error"));
        }
      }
    };
    input.click();
  };

  // Saved Chain handlers
  const handleNewChain = () => {
    setEditingChain(null);
    setShowChainEditor(true);
  };

  const handleEditChain = (chain: SavedProxyChain) => {
    setEditingChain(chain);
    setShowChainEditor(true);
  };

  const handleSaveChain = async (chainData: Omit<SavedProxyChain, 'id' | 'createdAt' | 'updatedAt'>) => {
    try {
      if (editingChain) {
        await proxyCollectionManager.updateChain(editingChain.id, chainData);
      } else {
        await proxyCollectionManager.createChain(chainData.name, chainData.layers, {
          description: chainData.description,
          tags: chainData.tags,
        });
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
        alert(error instanceof Error ? error.message : "Failed to delete chain");
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

  const updateConnectionChain = (connectionId: string, value: string) => {
    const connection = state.connections.find((conn) => conn.id === connectionId);
    if (!connection) return;
    dispatch({
      type: "UPDATE_CONNECTION",
      payload: {
        ...connection,
        connectionChainId: value || undefined,
      },
    });
  };

  const updateProxyChain = (connectionId: string, value: string) => {
    const connection = state.connections.find((conn) => conn.id === connectionId);
    if (!connection) return;
    dispatch({
      type: "UPDATE_CONNECTION",
      payload: {
        ...connection,
        proxyChainId: value || undefined,
      },
    });
  };

  if (!isOpen) return null;

  return (
    <div
      className="fixed inset-0 bg-black/50 flex items-center justify-center z-50"
      onClick={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
    >
      <div className="bg-[var(--color-surface)] rounded-xl shadow-xl w-full max-w-4xl mx-4 h-[85vh] overflow-hidden flex flex-col border border-[var(--color-border)]">
        <div className="sticky top-0 z-10 border-b border-[var(--color-border)] px-5 py-4 flex items-center justify-between bg-[var(--color-surface)]">
          <div className="flex items-center space-x-3">
            <div className="p-2 bg-blue-500/20 rounded-lg">
              <Network size={18} className="text-blue-500" />
            </div>
            <h2 className="text-lg font-semibold text-[var(--color-text)]">Proxy & VPN Chains</h2>
          </div>
          <div className="flex items-center gap-2">
            <button
              onClick={reloadChains}
              className="p-2 text-[var(--color-textSecondary)] bg-[var(--color-surfaceHover)] hover:bg-[var(--color-border)] rounded-lg transition-colors"
              data-tooltip="Refresh"
              aria-label="Refresh"
            >
              <RefreshCw size={16} />
            </button>
            <button
              onClick={onClose}
              className="p-2 hover:bg-[var(--color-surfaceHover)] rounded-lg transition-colors text-[var(--color-textSecondary)] hover:text-[var(--color-text)]"
              data-tooltip="Close"
              aria-label="Close"
            >
              <X size={16} />
            </button>
          </div>
        </div>

        <div className="flex flex-1 min-h-0">
          <div className="w-56 bg-gray-900 border-r border-gray-700 p-4 space-y-2">
            <button
              onClick={() => setActiveTab("profiles")}
              className={`w-full flex items-center gap-2 px-3 py-2 rounded-md text-left transition-colors ${
                activeTab === "profiles" ? "bg-blue-600 text-white" : "text-gray-300 hover:bg-gray-700"
              }`}
            >
              <Wifi size={16} />
              Profiles
            </button>
            <button
              onClick={() => setActiveTab("chains")}
              className={`w-full flex items-center gap-2 px-3 py-2 rounded-md text-left transition-colors ${
                activeTab === "chains" ? "bg-blue-600 text-white" : "text-gray-300 hover:bg-gray-700"
              }`}
            >
              <Link2 size={16} />
              Chains
            </button>
            <button
              onClick={() => setActiveTab("tunnels")}
              className={`w-full flex items-center gap-2 px-3 py-2 rounded-md text-left transition-colors ${
                activeTab === "tunnels" ? "bg-blue-600 text-white" : "text-gray-300 hover:bg-gray-700"
              }`}
            >
              <Route size={16} />
              SSH Tunnels
            </button>
            <button
              onClick={() => setActiveTab("associations")}
              className={`w-full flex items-center gap-2 px-3 py-2 rounded-md text-left transition-colors ${
                activeTab === "associations"
                  ? "bg-blue-600 text-white"
                  : "text-gray-300 hover:bg-gray-700"
              }`}
            >
              <PlugZap size={16} />
              Associations
            </button>
          </div>

          <div className="flex-1 overflow-y-auto p-6 space-y-6">
            {/* Profiles Tab */}
            {activeTab === "profiles" && (
              <div className="space-y-4">
                <div className="flex items-center justify-between">
                  <h3 className="text-lg font-medium text-white">Saved Proxy Profiles</h3>
                  <div className="flex items-center gap-2">
                    <button
                      onClick={handleImportProfiles}
                      className="flex items-center gap-1 px-2 py-1.5 text-xs rounded-md bg-gray-700 hover:bg-gray-600 text-gray-200"
                      title="Import Profiles"
                    >
                      <Upload size={12} />
                      Import
                    </button>
                    <button
                      onClick={handleExportProfiles}
                      className="flex items-center gap-1 px-2 py-1.5 text-xs rounded-md bg-gray-700 hover:bg-gray-600 text-gray-200"
                      title="Export Profiles"
                    >
                      <Download size={12} />
                      Export
                    </button>
                    <button
                      onClick={handleNewProfile}
                      className="flex items-center gap-2 px-3 py-1.5 text-sm rounded-md bg-blue-600 hover:bg-blue-700 text-white"
                    >
                      <Plus size={14} />
                      New Profile
                    </button>
                  </div>
                </div>

                <div className="text-sm text-gray-400">
                  Create and manage reusable proxy configurations that can be used across connections and chains.
                </div>

                {/* Search */}
                <div className="relative">
                  <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-400" />
                  <input
                    type="text"
                    value={profileSearch}
                    onChange={(e) => setProfileSearch(e.target.value)}
                    placeholder="Search profiles..."
                    className="w-full pl-9 pr-4 py-2 bg-gray-800 border border-gray-700 rounded-lg text-white text-sm placeholder:text-gray-500 focus:ring-2 focus:ring-blue-500"
                  />
                </div>

                {/* Profile List */}
                <div className="space-y-2">
                  {filteredProfiles.length === 0 ? (
                    <div className="text-sm text-gray-400 py-8 text-center">
                      {profileSearch 
                        ? "No profiles match your search."
                        : "No proxy profiles saved. Click \"New Profile\" to create one."}
                    </div>
                  ) : (
                    filteredProfiles.map((profile) => (
                      <div
                        key={profile.id}
                        className="flex items-center justify-between rounded-md border border-gray-700 bg-gray-800/60 px-4 py-3"
                      >
                        <div className="flex-1">
                          <div className="flex items-center gap-2">
                            <div className="text-sm font-medium text-white">{profile.name}</div>
                            <span className="px-2 py-0.5 text-xs rounded-full bg-purple-500/20 text-purple-400 uppercase">
                              {profile.config.type}
                            </span>
                            {profile.isDefault && (
                              <span className="px-2 py-0.5 text-xs rounded-full bg-yellow-500/20 text-yellow-400">
                                Default
                              </span>
                            )}
                          </div>
                          <div className="text-xs text-gray-400 mt-1 font-mono">
                            {profile.config.host}:{profile.config.port}
                            {profile.config.username && ` (${profile.config.username})`}
                          </div>
                          {profile.description && (
                            <div className="text-xs text-gray-500 mt-1">{profile.description}</div>
                          )}
                          {profile.tags && profile.tags.length > 0 && (
                            <div className="flex gap-1 mt-2">
                              {profile.tags.map(tag => (
                                <span key={tag} className="px-2 py-0.5 text-xs rounded-full bg-blue-500/20 text-blue-300">
                                  {tag}
                                </span>
                              ))}
                            </div>
                          )}
                        </div>
                        <div className="flex items-center gap-2">
                          <button
                            onClick={() => handleDuplicateProfile(profile.id)}
                            className="p-2 text-gray-400 hover:text-blue-400 hover:bg-gray-700 rounded-md"
                            title="Duplicate"
                          >
                            <Copy size={14} />
                          </button>
                          <button
                            onClick={() => handleEditProfile(profile)}
                            className="p-2 text-gray-400 hover:text-blue-400 hover:bg-gray-700 rounded-md"
                            title="Edit"
                          >
                            <Edit2 size={14} />
                          </button>
                          <button
                            onClick={() => handleDeleteProfile(profile.id)}
                            className="p-2 text-gray-400 hover:text-red-400 hover:bg-gray-700 rounded-md"
                            title="Delete"
                          >
                            <Trash2 size={14} />
                          </button>
                        </div>
                      </div>
                    ))
                  )}
                </div>
              </div>
            )}

            {activeTab === "chains" && (
              <div className="space-y-6">
                {/* Saved Chains Section */}
                <div className="space-y-4">
                  <div className="flex items-center justify-between">
                    <h3 className="text-lg font-medium text-white">Saved Chains</h3>
                    <button
                      onClick={handleNewChain}
                      className="flex items-center gap-2 px-3 py-1.5 text-sm rounded-md bg-blue-600 hover:bg-blue-700 text-white"
                    >
                      <Plus size={14} />
                      New Chain
                    </button>
                  </div>

                  <div className="text-sm text-gray-400">
                    Create reusable proxy chains that route traffic through multiple layers.
                  </div>

                  {/* Search */}
                  <div className="relative">
                    <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-400" />
                    <input
                      type="text"
                      value={chainSearch}
                      onChange={(e) => setChainSearch(e.target.value)}
                      placeholder="Search chains..."
                      className="w-full pl-9 pr-4 py-2 bg-gray-800 border border-gray-700 rounded-lg text-white text-sm placeholder:text-gray-500 focus:ring-2 focus:ring-blue-500"
                    />
                  </div>

                  {/* Saved Chains List */}
                  <div className="space-y-2">
                    {filteredSavedChains.length === 0 ? (
                      <div className="text-sm text-gray-400 py-6 text-center">
                        {chainSearch 
                          ? "No chains match your search."
                          : "No proxy chains saved. Click \"New Chain\" to create one."}
                      </div>
                    ) : (
                      filteredSavedChains.map((chain) => (
                        <div
                          key={chain.id}
                          className="flex items-center justify-between rounded-md border border-gray-700 bg-gray-800/60 px-4 py-3"
                        >
                          <div className="flex-1">
                            <div className="flex items-center gap-2">
                              <div className="text-sm font-medium text-white">{chain.name}</div>
                              <span className="px-2 py-0.5 text-xs rounded-full bg-purple-500/20 text-purple-400">
                                {chain.layers.length} layer{chain.layers.length !== 1 ? 's' : ''}
                              </span>
                            </div>
                            {chain.description && (
                              <div className="text-xs text-gray-500 mt-1">{chain.description}</div>
                            )}
                            <div className="text-xs text-gray-400 mt-1 font-mono">
                              {chain.layers.map((layer, i) => {
                                const profile = layer.proxyProfileId 
                                  ? savedProfiles.find(p => p.id === layer.proxyProfileId)
                                  : null;
                                return (
                                  <span key={i}>
                                    {i > 0 && ' → '}
                                    {layer.type === 'proxy' && profile 
                                      ? `${profile.name}` 
                                      : layer.type}
                                  </span>
                                );
                              })}
                            </div>
                            {chain.tags && chain.tags.length > 0 && (
                              <div className="flex gap-1 mt-2">
                                {chain.tags.map(tag => (
                                  <span key={tag} className="px-2 py-0.5 text-xs rounded-full bg-blue-500/20 text-blue-300">
                                    {tag}
                                  </span>
                                ))}
                              </div>
                            )}
                          </div>
                          <div className="flex items-center gap-2">
                            <button
                              onClick={() => handleDuplicateChain(chain.id)}
                              className="p-2 text-gray-400 hover:text-blue-400 hover:bg-gray-700 rounded-md"
                              title="Duplicate"
                            >
                              <Copy size={14} />
                            </button>
                            <button
                              onClick={() => handleEditChain(chain)}
                              className="p-2 text-gray-400 hover:text-blue-400 hover:bg-gray-700 rounded-md"
                              title="Edit"
                            >
                              <Edit2 size={14} />
                            </button>
                            <button
                              onClick={() => handleDeleteChain(chain.id)}
                              className="p-2 text-gray-400 hover:text-red-400 hover:bg-gray-700 rounded-md"
                              title="Delete"
                            >
                              <Trash2 size={14} />
                            </button>
                          </div>
                        </div>
                      ))
                    )}
                  </div>
                </div>

                {/* Active Chains Section */}
                <div className="border-t border-gray-700 pt-6 space-y-4">
                  <div className="flex items-center justify-between">
                    <h3 className="text-lg font-medium text-white">Active Chains</h3>
                    {isLoading && <span className="text-xs text-gray-400">Refreshing...</span>}
                  </div>

                  <div className="rounded-lg border border-gray-700/70 bg-gray-900/40 p-4">
                    <div className="text-sm font-semibold text-gray-200 mb-3">Connection Chains</div>
                    {connectionChains.length === 0 ? (
                      <div className="text-sm text-gray-400">No connection chains available.</div>
                    ) : (
                      connectionChains.map((chain) => (
                        <div
                          key={chain.id}
                          className="flex items-center justify-between rounded-md border border-gray-700 bg-gray-800/60 px-3 py-2 mb-2 last:mb-0"
                        >
                          <div>
                            <div className="text-sm font-medium text-white">{chain.name}</div>
                            <div className="text-xs text-gray-400">
                              {chain.layers.length} layers · {chain.status}
                            </div>
                          </div>
                          <div className="flex items-center gap-2">
                            {String(chain.status).toLowerCase() === "connected" ? (
                              <button
                                onClick={() => handleDisconnectChain(chain.id)}
                                className="px-3 py-1 text-xs rounded-md bg-gray-700 hover:bg-gray-600 text-gray-200"
                              >
                                Disconnect
                              </button>
                            ) : (
                              <button
                                onClick={() => handleConnectChain(chain.id)}
                                className="px-3 py-1 text-xs rounded-md bg-blue-600 hover:bg-blue-700 text-white"
                              >
                                Connect
                              </button>
                            )}
                          </div>
                        </div>
                      ))
                    )}
                  </div>

                  <div className="rounded-lg border border-gray-700/70 bg-gray-900/40 p-4">
                    <div className="text-sm font-semibold text-gray-200 mb-3">Proxy Chains</div>
                    {proxyChains.length === 0 ? (
                      <div className="text-sm text-gray-400">No proxy chains available.</div>
                    ) : (
                      proxyChains.map((chain) => (
                        <div
                          key={chain.id}
                          className="flex items-center justify-between rounded-md border border-gray-700 bg-gray-800/60 px-3 py-2 mb-2 last:mb-0"
                        >
                          <div>
                            <div className="text-sm font-medium text-white">{chain.name}</div>
                            <div className="text-xs text-gray-400">
                              {chain.layers.length} layers · {chain.status}
                            </div>
                          </div>
                          <div className="flex items-center gap-2">
                            {String(chain.status).toLowerCase() === "connected" ? (
                              <button
                                onClick={() => handleDisconnectProxyChain(chain.id)}
                                className="px-3 py-1 text-xs rounded-md bg-gray-700 hover:bg-gray-600 text-gray-200"
                              >
                                Disconnect
                              </button>
                            ) : (
                              <button
                                onClick={() => handleConnectProxyChain(chain.id)}
                                className="px-3 py-1 text-xs rounded-md bg-blue-600 hover:bg-blue-700 text-white"
                              >
                                Connect
                              </button>
                            )}
                          </div>
                        </div>
                      ))
                    )}
                  </div>
                </div>
              </div>
            )}

            {activeTab === "tunnels" && (
              <div className="space-y-4">
                <div className="flex items-center justify-between">
                  <h3 className="text-lg font-medium text-white">SSH Tunnels</h3>
                  <button
                    onClick={handleNewTunnel}
                    className="flex items-center gap-2 px-3 py-1.5 text-sm rounded-md bg-blue-600 hover:bg-blue-700 text-white"
                  >
                    <Plus size={14} />
                    New Tunnel
                  </button>
                </div>

                <div className="text-sm text-gray-400">
                  Create SSH tunnels using existing SSH connections to forward ports securely.
                </div>

                <div className="space-y-2">
                  {sshTunnels.length === 0 ? (
                    <div className="text-sm text-gray-400 py-8 text-center">
                      No SSH tunnels configured. Click "New Tunnel" to create one.
                    </div>
                  ) : (
                    sshTunnels.map((tunnel) => {
                      const sshConn = state.connections.find(c => c.id === tunnel.sshConnectionId);
                      const localPort = tunnel.actualLocalPort || tunnel.localPort || '?';
                      
                      // Format tunnel info based on type
                      const getTunnelInfo = () => {
                        switch (tunnel.type) {
                          case 'dynamic':
                            return `SOCKS5 proxy on localhost:${localPort}`;
                          case 'remote':
                            return `${tunnel.remoteHost}:${tunnel.remotePort} → localhost:${localPort}`;
                          case 'local':
                          default:
                            return `localhost:${localPort} → ${tunnel.remoteHost}:${tunnel.remotePort}`;
                        }
                      };
                      
                      const getTypeLabel = () => {
                        switch (tunnel.type) {
                          case 'dynamic': return 'Dynamic';
                          case 'remote': return 'Remote';
                          case 'local':
                          default: return 'Local';
                        }
                      };
                      
                      return (
                        <div
                          key={tunnel.id}
                          className="flex items-center justify-between rounded-md border border-gray-700 bg-gray-800/60 px-4 py-3"
                        >
                          <div className="flex-1">
                            <div className="flex items-center gap-2">
                              <div className="text-sm font-medium text-white">{tunnel.name}</div>
                              <span className="px-2 py-0.5 text-xs rounded-full bg-blue-500/20 text-blue-400">
                                {getTypeLabel()}
                              </span>
                              <span className={`px-2 py-0.5 text-xs rounded-full ${
                                tunnel.status === 'connected' ? 'bg-green-500/20 text-green-400' :
                                tunnel.status === 'connecting' ? 'bg-yellow-500/20 text-yellow-400' :
                                tunnel.status === 'error' ? 'bg-red-500/20 text-red-400' :
                                'bg-gray-500/20 text-gray-400'
                              }`}>
                                {tunnel.status}
                              </span>
                            </div>
                            <div className="text-xs text-gray-400 mt-1">
                              <span className="text-gray-500">via</span> {sshConn?.name || 'Unknown SSH'}
                            </div>
                            <div className="text-xs text-gray-300 mt-0.5 font-mono">
                              {getTunnelInfo()}
                            </div>
                            {tunnel.error && (
                              <div className="text-xs text-red-400 mt-1">{tunnel.error}</div>
                            )}
                          </div>
                          <div className="flex items-center gap-2">
                            {tunnel.status === 'connected' ? (
                              <button
                                onClick={() => handleDisconnectTunnel(tunnel.id)}
                                className="p-2 text-gray-400 hover:text-white hover:bg-gray-700 rounded-md"
                                title="Disconnect"
                              >
                                <Square size={14} />
                              </button>
                            ) : (
                              <button
                                onClick={() => handleConnectTunnel(tunnel.id)}
                                disabled={tunnel.status === 'connecting'}
                                className="p-2 text-gray-400 hover:text-green-400 hover:bg-gray-700 rounded-md disabled:opacity-50"
                                title="Connect"
                              >
                                <Play size={14} />
                              </button>
                            )}
                            <button
                              onClick={() => handleEditTunnel(tunnel)}
                              disabled={tunnel.status === 'connected'}
                              className="p-2 text-gray-400 hover:text-blue-400 hover:bg-gray-700 rounded-md disabled:opacity-50"
                              title="Edit"
                            >
                              <Edit2 size={14} />
                            </button>
                            <button
                              onClick={() => handleDeleteTunnel(tunnel.id)}
                              disabled={tunnel.status === 'connected'}
                              className="p-2 text-gray-400 hover:text-red-400 hover:bg-gray-700 rounded-md disabled:opacity-50"
                              title="Delete"
                            >
                              <Trash2 size={14} />
                            </button>
                          </div>
                        </div>
                      );
                    })
                  )}
                </div>
              </div>
            )}

            {activeTab === "associations" && (
              <div className="space-y-4">
                <div className="text-sm text-gray-400">
                  Associate chains with individual connections. These choices will be used when launching sessions.
                </div>
                <div className="space-y-3">
                  {connectionOptions.map((connection) => (
                    <div
                      key={connection.id}
                      className="rounded-lg border border-gray-700 bg-gray-900/40 p-3"
                    >
                      <div className="text-sm font-medium text-white mb-2">
                        {connection.name}
                      </div>
                      <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                        <div>
                          <label className="block text-xs text-gray-400 mb-1">
                            Connection Chain
                          </label>
                          <select
                            value={connection.connectionChainId || ""}
                            onChange={(e) => updateConnectionChain(connection.id, e.target.value)}
                            className="w-full px-3 py-2 bg-gray-700 border border-gray-600 rounded-md text-white text-sm"
                          >
                            <option value="">None</option>
                            {connectionChains.map((chain) => (
                              <option key={chain.id} value={chain.id}>
                                {chain.name}
                              </option>
                            ))}
                          </select>
                        </div>
                        <div>
                          <label className="block text-xs text-gray-400 mb-1">Proxy Chain</label>
                          <select
                            value={connection.proxyChainId || ""}
                            onChange={(e) => updateProxyChain(connection.id, e.target.value)}
                            className="w-full px-3 py-2 bg-gray-700 border border-gray-600 rounded-md text-white text-sm"
                          >
                            <option value="">None</option>
                            {proxyChains.map((chain) => (
                              <option key={chain.id} value={chain.id}>
                                {chain.name}
                              </option>
                            ))}
                          </select>
                        </div>
                      </div>
                    </div>
                  ))}
                  {connectionOptions.length === 0 && (
                    <div className="text-sm text-gray-400">No connections available.</div>
                  )}
                </div>
              </div>
            )}
          </div>
        </div>
      </div>

      {/* SSH Tunnel Dialog */}
      <SSHTunnelDialog
        isOpen={showTunnelDialog}
        onClose={() => {
          setShowTunnelDialog(false);
          setEditingTunnel(null);
        }}
        onSave={handleSaveTunnel}
        sshConnections={sshConnections}
        editingTunnel={editingTunnel}
      />

      {/* Proxy Profile Editor Dialog */}
      <ProxyProfileEditor
        isOpen={showProfileEditor}
        onClose={() => {
          setShowProfileEditor(false);
          setEditingProfile(null);
        }}
        onSave={handleSaveProfile}
        editingProfile={editingProfile}
      />

      {/* Proxy Chain Editor Dialog */}
      <ProxyChainEditor
        isOpen={showChainEditor}
        onClose={() => {
          setShowChainEditor(false);
          setEditingChain(null);
        }}
        onSave={handleSaveChain}
        editingChain={editingChain}
      />
    </div>
  );
};
