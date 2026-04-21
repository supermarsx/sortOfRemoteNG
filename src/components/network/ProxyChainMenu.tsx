import React from "react";
import { RefreshCw, Wifi, Route, PlugZap, Shield, Layers } from "lucide-react";
import { useProxyChainManager } from "../../hooks/network/useProxyChainManager";
import { useTunnelChainManager } from "../../hooks/network/useTunnelChainManager";
import { ProxyChainMenuProps } from "./proxyChainMenu/types";
import ProfilesTab from "./proxyChainMenu/ProfilesTab";
import TunnelsTab from "./proxyChainMenu/TunnelsTab";
import AssociationsTab from "./proxyChainMenu/AssociationsTab";
import VpnConnectionsTab from "./proxyChainMenu/VpnConnectionsTab";
import UnifiedChainsTab from "./proxyChainMenu/UnifiedChainsTab";

export const ProxyChainMenu: React.FC<ProxyChainMenuProps> = ({
  isOpen,
  onClose,
}) => {
  const mgr = useProxyChainManager(isOpen, onClose);
  const tunnelMgr = useTunnelChainManager(isOpen);

  if (!isOpen) return null;

  return (
    <>
    <div className="h-full flex flex-col bg-[var(--color-surface)] overflow-hidden">
      <div className="px-4 py-2 border-b border-[var(--color-border)] flex items-center justify-end flex-shrink-0">
        <button
          onClick={mgr.reloadChains}
          className="p-1.5 rounded-md hover:bg-[var(--color-surfaceHover)] text-[var(--color-textSecondary)] hover:text-[var(--color-text)] transition-colors"
          data-tooltip="Refresh"
          aria-label="Refresh"
        >
          <RefreshCw size={14} />
        </button>
      </div>

      <div className="flex flex-1 min-h-0">
        {/* Sidebar */}
        <div className="w-56 border-r border-[var(--color-border)] p-4 space-y-2">
            <button
              onClick={() => mgr.setActiveTab("profiles")}
              className={`sor-sidebar-tab ${mgr.activeTab === "profiles" ? "sor-sidebar-tab-active" : ""}`}
            >
              <Wifi size={16} />
              Profiles
            </button>
            <button
              onClick={() => mgr.setActiveTab("chains")}
              className={`sor-sidebar-tab ${mgr.activeTab === "chains" ? "sor-sidebar-tab-active" : ""}`}
            >
              <Layers size={16} />
              Chains
            </button>
            <button
              onClick={() => mgr.setActiveTab("tunnels")}
              className={`sor-sidebar-tab ${mgr.activeTab === "tunnels" ? "sor-sidebar-tab-active" : ""}`}
            >
              <Route size={16} />
              SSH Tunnels
            </button>
            <button
              onClick={() => mgr.setActiveTab("vpnConnections")}
              className={`sor-sidebar-tab ${mgr.activeTab === "vpnConnections" ? "sor-sidebar-tab-active" : ""}`}
            >
              <Shield size={16} />
              VPN Connections
            </button>
            <button
              onClick={() => mgr.setActiveTab("associations")}
              className={`sor-sidebar-tab ${mgr.activeTab === "associations" ? "sor-sidebar-tab-active" : ""}`}
            >
              <PlugZap size={16} />
              Associations
            </button>
          </div>

          {/* Tab Content */}
          <div className="flex-1 overflow-y-auto p-6 space-y-6">
            {mgr.activeTab === "profiles" && (
              <ProfilesTab mgr={mgr} />
            )}
            {mgr.activeTab === "chains" && (
              <UnifiedChainsTab
                isOpen={isOpen}
                tunnelMgr={tunnelMgr}
                mgr={mgr}
              />
            )}
            {mgr.activeTab === "tunnels" && (
              <TunnelsTab mgr={mgr} />
            )}
            {mgr.activeTab === "vpnConnections" && (
              <VpnConnectionsTab isOpen={isOpen} mgr={mgr} />
            )}
            {mgr.activeTab === "associations" && (
              <AssociationsTab mgr={mgr} />
            )}
          </div>
        </div>
    </div>

    </>
  );
};

export default ProxyChainMenu;
