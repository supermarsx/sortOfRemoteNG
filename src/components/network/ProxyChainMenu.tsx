import React from "react";
import { Network, RefreshCw, Wifi, Link2, Route, PlugZap } from "lucide-react";
import { useProxyChainManager } from "../../hooks/network/useProxyChainManager";
import Modal from "../shared/Modal";
import DialogHeader from "../ui/DialogHeader";
import SSHTunnelDialog from "./SSHTunnelDialog";
import ProxyProfileEditor from "./ProxyProfileEditor";
import ProxyChainEditor from "./ProxyChainEditor";
import { ProxyChainMenuProps } from "./proxyChainMenu/types";
import ProfilesTab from "./proxyChainMenu/ProfilesTab";
import ChainsTab from "./proxyChainMenu/ChainsTab";
import TunnelsTab from "./proxyChainMenu/TunnelsTab";
import AssociationsTab from "./proxyChainMenu/AssociationsTab";

export const ProxyChainMenu: React.FC<ProxyChainMenuProps> = ({
  isOpen,
  onClose,
}) => {
  const mgr = useProxyChainManager(isOpen, onClose);

  if (!isOpen) return null;

  return (
    <Modal
      isOpen={isOpen}
      onClose={onClose}
      closeOnEscape={false}
      panelClassName="max-w-4xl mx-4 h-[85vh]"
      contentClassName="overflow-hidden"
      dataTestId="proxy-chain-menu-modal"
    >
      <div className="bg-[var(--color-surface)] rounded-xl shadow-xl w-full h-[85vh] overflow-hidden flex flex-col border border-[var(--color-border)]">
        {/* Header */}
        <DialogHeader
          icon={Network}
          iconColor="text-blue-500"
          iconBg="bg-blue-500/20"
          title="Proxy & VPN Chains"
          onClose={onClose}
          sticky
          actions={
            <button
              onClick={mgr.reloadChains}
              className="p-2 text-[var(--color-textSecondary)] bg-[var(--color-surfaceHover)] hover:bg-[var(--color-border)] rounded-lg transition-colors"
              data-tooltip="Refresh"
              aria-label="Refresh"
            >
              <RefreshCw size={16} />
            </button>
          }
        />

        <div className="flex flex-1 min-h-0">
          {/* Sidebar */}
          <div className="w-56 bg-[var(--color-background)] border-r border-[var(--color-border)] p-4 space-y-2">
            <button
              onClick={() => mgr.setActiveTab("profiles")}
              className={`w-full flex items-center gap-2 px-3 py-2 rounded-md text-left transition-colors ${
                mgr.activeTab === "profiles"
                  ? "bg-blue-600 text-[var(--color-text)]"
                  : "text-[var(--color-textSecondary)] hover:bg-[var(--color-border)]"
              }`}
            >
              <Wifi size={16} />
              Profiles
            </button>
            <button
              onClick={() => mgr.setActiveTab("chains")}
              className={`w-full flex items-center gap-2 px-3 py-2 rounded-md text-left transition-colors ${
                mgr.activeTab === "chains"
                  ? "bg-blue-600 text-[var(--color-text)]"
                  : "text-[var(--color-textSecondary)] hover:bg-[var(--color-border)]"
              }`}
            >
              <Link2 size={16} />
              Chains
            </button>
            <button
              onClick={() => mgr.setActiveTab("tunnels")}
              className={`w-full flex items-center gap-2 px-3 py-2 rounded-md text-left transition-colors ${
                mgr.activeTab === "tunnels"
                  ? "bg-blue-600 text-[var(--color-text)]"
                  : "text-[var(--color-textSecondary)] hover:bg-[var(--color-border)]"
              }`}
            >
              <Route size={16} />
              SSH Tunnels
            </button>
            <button
              onClick={() => mgr.setActiveTab("associations")}
              className={`w-full flex items-center gap-2 px-3 py-2 rounded-md text-left transition-colors ${
                mgr.activeTab === "associations"
                  ? "bg-blue-600 text-[var(--color-text)]"
                  : "text-[var(--color-textSecondary)] hover:bg-[var(--color-border)]"
              }`}
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
              <ChainsTab mgr={mgr} />
            )}
            {mgr.activeTab === "tunnels" && (
              <TunnelsTab mgr={mgr} />
            )}
            {mgr.activeTab === "associations" && (
              <AssociationsTab mgr={mgr} />
            )}
          </div>
        </div>
      </div>

      {/* Sub-dialogs */}
      <SSHTunnelDialog
        isOpen={mgr.showTunnelDialog}
        onClose={mgr.closeTunnelDialog}
        onSave={mgr.handleSaveTunnel}
        sshConnections={mgr.sshConnections}
        editingTunnel={mgr.editingTunnel}
      />
      <ProxyProfileEditor
        isOpen={mgr.showProfileEditor}
        onClose={mgr.closeProfileEditor}
        onSave={mgr.handleSaveProfile}
        editingProfile={mgr.editingProfile}
      />
      <ProxyChainEditor
        isOpen={mgr.showChainEditor}
        onClose={mgr.closeChainEditor}
        onSave={mgr.handleSaveChain}
        editingChain={mgr.editingChain}
      />
    </Modal>
  );
};

export { ProxyChainMenu };
export default ProxyChainMenu;
