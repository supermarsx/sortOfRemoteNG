import React, { useCallback, useEffect, useMemo, useState } from "react";
import { X, RefreshCw, Link2, Network, PlugZap, Tunnel, Plus, Trash2, Play, Square, Edit2 } from "lucide-react";
import { invoke } from "@tauri-apps/api/core";
import { useConnections } from "../contexts/useConnections";
import { ProxyOpenVPNManager } from "../utils/proxyOpenVPNManager";
import { sshTunnelService, SSHTunnelConfig, SSHTunnelCreateParams } from "../utils/sshTunnelService";

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
  const [activeTab, setActiveTab] = useState<"chains" | "tunnels" | "associations">("chains");
  const [connectionChains, setConnectionChains] = useState<ConnectionChainSummary[]>([]);
  const [proxyChains, setProxyChains] = useState<ProxyChainSummary[]>([]);
  const [sshTunnels, setSshTunnels] = useState<SSHTunnelConfig[]>([]);
  const [isLoading, setIsLoading] = useState(false);
  
  // SSH Tunnel form state
  const [showTunnelForm, setShowTunnelForm] = useState(false);
  const [editingTunnelId, setEditingTunnelId] = useState<string | null>(null);
  const [tunnelForm, setTunnelForm] = useState<SSHTunnelCreateParams>({
    name: "",
    sshConnectionId: "",
    localPort: 0,
    remoteHost: "localhost",
    remotePort: 22,
    type: "local",
    autoConnect: false,
  });

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
        if (showTunnelForm) {
          setShowTunnelForm(false);
          setEditingTunnelId(null);
        } else {
          onClose();
        }
      }
    };
    document.addEventListener("keydown", handleKeyDown);
    return () => document.removeEventListener("keydown", handleKeyDown);
  }, [isOpen, onClose, showTunnelForm]);

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
  const resetTunnelForm = () => {
    setTunnelForm({
      name: "",
      sshConnectionId: "",
      localPort: 0,
      remoteHost: "localhost",
      remotePort: 22,
      type: "local",
      autoConnect: false,
    });
    setEditingTunnelId(null);
    setShowTunnelForm(false);
  };

  const handleCreateTunnel = async () => {
    if (!tunnelForm.name || !tunnelForm.sshConnectionId) return;
    
    try {
      if (editingTunnelId) {
        await sshTunnelService.updateTunnel(editingTunnelId, tunnelForm);
      } else {
        await sshTunnelService.createTunnel(tunnelForm);
      }
      resetTunnelForm();
    } catch (error) {
      console.error("Failed to create/update SSH tunnel:", error);
    }
  };

  const handleEditTunnel = (tunnel: SSHTunnelConfig) => {
    setTunnelForm({
      name: tunnel.name,
      sshConnectionId: tunnel.sshConnectionId,
      localPort: tunnel.localPort,
      remoteHost: tunnel.remoteHost,
      remotePort: tunnel.remotePort,
      type: tunnel.type,
      autoConnect: tunnel.autoConnect,
    });
    setEditingTunnelId(tunnel.id);
    setShowTunnelForm(true);
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
              <Tunnel size={16} />
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
            {activeTab === "chains" && (
              <>
                <div className="flex items-center justify-between">
                  <h3 className="text-lg font-medium text-white">Active Chains</h3>
                  {isLoading && <span className="text-xs text-gray-400">Refreshing...</span>}
                </div>

                <div className="space-y-4">
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
              </>
            )}

            {activeTab === "tunnels" && (
              <div className="space-y-4">
                <div className="flex items-center justify-between">
                  <h3 className="text-lg font-medium text-white">SSH Tunnels</h3>
                  <button
                    onClick={() => setShowTunnelForm(true)}
                    className="flex items-center gap-2 px-3 py-1.5 text-sm rounded-md bg-blue-600 hover:bg-blue-700 text-white"
                  >
                    <Plus size={14} />
                    New Tunnel
                  </button>
                </div>

                <div className="text-sm text-gray-400">
                  Create SSH tunnels using existing SSH connections to forward ports securely.
                </div>

                {showTunnelForm && (
                  <div className="rounded-lg border border-blue-500/50 bg-blue-900/20 p-4 space-y-4">
                    <div className="text-sm font-semibold text-blue-300">
                      {editingTunnelId ? "Edit SSH Tunnel" : "Create SSH Tunnel"}
                    </div>
                    
                    <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                      <div>
                        <label className="block text-xs text-gray-400 mb-1">Tunnel Name</label>
                        <input
                          type="text"
                          value={tunnelForm.name}
                          onChange={(e) => setTunnelForm({ ...tunnelForm, name: e.target.value })}
                          placeholder="My SSH Tunnel"
                          className="w-full px-3 py-2 bg-gray-700 border border-gray-600 rounded-md text-white text-sm"
                        />
                      </div>
                      
                      <div>
                        <label className="block text-xs text-gray-400 mb-1">SSH Connection</label>
                        <select
                          value={tunnelForm.sshConnectionId}
                          onChange={(e) => setTunnelForm({ ...tunnelForm, sshConnectionId: e.target.value })}
                          className="w-full px-3 py-2 bg-gray-700 border border-gray-600 rounded-md text-white text-sm"
                        >
                          <option value="">Select SSH connection...</option>
                          {sshConnections.map((conn) => (
                            <option key={conn.id} value={conn.id}>
                              {conn.name} ({conn.hostname}:{conn.port})
                            </option>
                          ))}
                        </select>
                      </div>

                      <div>
                        <label className="block text-xs text-gray-400 mb-1">Local Port (0 = auto)</label>
                        <input
                          type="number"
                          value={tunnelForm.localPort}
                          onChange={(e) => setTunnelForm({ ...tunnelForm, localPort: parseInt(e.target.value) || 0 })}
                          min={0}
                          max={65535}
                          className="w-full px-3 py-2 bg-gray-700 border border-gray-600 rounded-md text-white text-sm"
                        />
                      </div>

                      <div>
                        <label className="block text-xs text-gray-400 mb-1">Tunnel Type</label>
                        <select
                          value={tunnelForm.type}
                          onChange={(e) => setTunnelForm({ ...tunnelForm, type: e.target.value as 'local' | 'remote' | 'dynamic' })}
                          className="w-full px-3 py-2 bg-gray-700 border border-gray-600 rounded-md text-white text-sm"
                        >
                          <option value="local">Local (forward local port to remote)</option>
                          <option value="remote">Remote (forward remote port to local)</option>
                          <option value="dynamic">Dynamic (SOCKS proxy)</option>
                        </select>
                      </div>

                      <div>
                        <label className="block text-xs text-gray-400 mb-1">Remote Host</label>
                        <input
                          type="text"
                          value={tunnelForm.remoteHost}
                          onChange={(e) => setTunnelForm({ ...tunnelForm, remoteHost: e.target.value })}
                          placeholder="localhost"
                          className="w-full px-3 py-2 bg-gray-700 border border-gray-600 rounded-md text-white text-sm"
                        />
                      </div>

                      <div>
                        <label className="block text-xs text-gray-400 mb-1">Remote Port</label>
                        <input
                          type="number"
                          value={tunnelForm.remotePort}
                          onChange={(e) => setTunnelForm({ ...tunnelForm, remotePort: parseInt(e.target.value) || 22 })}
                          min={1}
                          max={65535}
                          className="w-full px-3 py-2 bg-gray-700 border border-gray-600 rounded-md text-white text-sm"
                        />
                      </div>
                    </div>

                    <div className="flex items-center gap-2">
                      <input
                        type="checkbox"
                        id="autoConnect"
                        checked={tunnelForm.autoConnect}
                        onChange={(e) => setTunnelForm({ ...tunnelForm, autoConnect: e.target.checked })}
                        className="rounded border-gray-600 bg-gray-700 text-blue-500"
                      />
                      <label htmlFor="autoConnect" className="text-sm text-gray-300">
                        Auto-connect when associated connection starts
                      </label>
                    </div>

                    <div className="flex justify-end gap-2">
                      <button
                        onClick={resetTunnelForm}
                        className="px-4 py-2 text-sm rounded-md bg-gray-700 hover:bg-gray-600 text-gray-200"
                      >
                        Cancel
                      </button>
                      <button
                        onClick={handleCreateTunnel}
                        disabled={!tunnelForm.name || !tunnelForm.sshConnectionId}
                        className="px-4 py-2 text-sm rounded-md bg-blue-600 hover:bg-blue-700 text-white disabled:opacity-50 disabled:cursor-not-allowed"
                      >
                        {editingTunnelId ? "Save Changes" : "Create Tunnel"}
                      </button>
                    </div>
                  </div>
                )}

                <div className="space-y-2">
                  {sshTunnels.length === 0 ? (
                    <div className="text-sm text-gray-400 py-8 text-center">
                      No SSH tunnels configured. Click "New Tunnel" to create one.
                    </div>
                  ) : (
                    sshTunnels.map((tunnel) => {
                      const sshConn = state.connections.find(c => c.id === tunnel.sshConnectionId);
                      return (
                        <div
                          key={tunnel.id}
                          className="flex items-center justify-between rounded-md border border-gray-700 bg-gray-800/60 px-4 py-3"
                        >
                          <div className="flex-1">
                            <div className="flex items-center gap-2">
                              <div className="text-sm font-medium text-white">{tunnel.name}</div>
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
                              via {sshConn?.name || 'Unknown'} → {tunnel.remoteHost}:{tunnel.remotePort}
                              {tunnel.actualLocalPort && ` (local: ${tunnel.actualLocalPort})`}
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
    </div>
  );
};
