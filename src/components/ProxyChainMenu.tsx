import React, { useCallback, useEffect, useMemo, useState } from "react";
import { X, RefreshCw, Link2, ShieldCheck, PlugZap } from "lucide-react";
import { invoke } from "@tauri-apps/api/core";
import { useConnections } from "../contexts/useConnections";
import { ProxyOpenVPNManager } from "../utils/proxyOpenVPNManager";

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
  const [activeTab, setActiveTab] = useState<"chains" | "associations">("chains");
  const [connectionChains, setConnectionChains] = useState<ConnectionChainSummary[]>([]);
  const [proxyChains, setProxyChains] = useState<ProxyChainSummary[]>([]);
  const [isLoading, setIsLoading] = useState(false);

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

  useEffect(() => {
    if (!isOpen) return;
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        onClose();
      }
    };
    document.addEventListener("keydown", handleKeyDown);
    return () => document.removeEventListener("keydown", handleKeyDown);
  }, [isOpen, onClose]);

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
              <ShieldCheck size={18} className="text-blue-500" />
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
