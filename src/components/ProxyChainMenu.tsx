import React from "react";
import {
  X,
  RefreshCw,
  Link2,
  Network,
  PlugZap,
  Route,
  Plus,
  Trash2,
  Play,
  Square,
  Edit2,
  Wifi,
  Copy,
  Search,
  Download,
  Upload,
} from "lucide-react";
import { SSHTunnelDialog } from "./SSHTunnelDialog";
import { ProxyProfileEditor } from "./ProxyProfileEditor";
import { ProxyChainEditor } from "./ProxyChainEditor";
import { Modal } from "./ui/overlays/Modal";import { DialogHeader } from './ui/overlays/DialogHeader';import { useProxyChainManager } from "../hooks/network/useProxyChainManager";
import { Select } from './ui/forms';

interface ProxyChainMenuProps {
  isOpen: boolean;
  onClose: () => void;
}

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

// ─── Tab sub-components ──────────────────────────────────────────

type Mgr = ReturnType<typeof useProxyChainManager>;

function ProfilesTab({ mgr }: { mgr: Mgr }) {
  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <h3 className="text-lg font-medium text-[var(--color-text)]">
          Saved Proxy Profiles
        </h3>
        <div className="flex items-center gap-2">
          <button
            onClick={mgr.handleImportProfiles}
            className="flex items-center gap-1 px-2 py-1.5 text-xs rounded-md bg-[var(--color-border)] hover:bg-[var(--color-border)] text-gray-200"
            title="Import Profiles"
          >
            <Upload size={12} />
            Import
          </button>
          <button
            onClick={mgr.handleExportProfiles}
            className="flex items-center gap-1 px-2 py-1.5 text-xs rounded-md bg-[var(--color-border)] hover:bg-[var(--color-border)] text-gray-200"
            title="Export Profiles"
          >
            <Download size={12} />
            Export
          </button>
          <button
            onClick={mgr.handleNewProfile}
            className="flex items-center gap-2 px-3 py-1.5 text-sm rounded-md bg-blue-600 hover:bg-blue-700 text-[var(--color-text)]"
          >
            <Plus size={14} />
            New Profile
          </button>
        </div>
      </div>

      <div className="text-sm text-[var(--color-textSecondary)]">
        Create and manage reusable proxy configurations that can be used across
        connections and chains.
      </div>

      {/* Search */}
      <div className="relative">
        <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-[var(--color-textSecondary)]" />
        <input
          type="text"
          value={mgr.profileSearch}
          onChange={(e) => mgr.setProfileSearch(e.target.value)}
          placeholder="Search profiles..."
          className="w-full pl-9 pr-4 py-2 bg-[var(--color-surface)] border border-[var(--color-border)] rounded-lg text-[var(--color-text)] text-sm placeholder:text-gray-500 focus:ring-2 focus:ring-blue-500"
        />
      </div>

      {/* Profile List */}
      <div className="space-y-2">
        {mgr.filteredProfiles.length === 0 ? (
          <div className="text-sm text-[var(--color-textSecondary)] py-8 text-center">
            {mgr.profileSearch
              ? "No profiles match your search."
              : 'No proxy profiles saved. Click "New Profile" to create one.'}
          </div>
        ) : (
          mgr.filteredProfiles.map((profile) => (
            <div
              key={profile.id}
              className="flex items-center justify-between rounded-md border border-[var(--color-border)] bg-[var(--color-surface)]/60 px-4 py-3"
            >
              <div className="flex-1">
                <div className="flex items-center gap-2">
                  <div className="text-sm font-medium text-[var(--color-text)]">
                    {profile.name}
                  </div>
                  <span className="px-2 py-0.5 text-xs rounded-full bg-purple-500/20 text-purple-400 uppercase">
                    {profile.config.type}
                  </span>
                  {profile.isDefault && (
                    <span className="px-2 py-0.5 text-xs rounded-full bg-yellow-500/20 text-yellow-400">
                      Default
                    </span>
                  )}
                </div>
                <div className="text-xs text-[var(--color-textSecondary)] mt-1 font-mono">
                  {profile.config.host}:{profile.config.port}
                  {profile.config.username &&
                    ` (${profile.config.username})`}
                </div>
                {profile.description && (
                  <div className="text-xs text-gray-500 mt-1">
                    {profile.description}
                  </div>
                )}
                {profile.tags && profile.tags.length > 0 && (
                  <div className="flex gap-1 mt-2">
                    {profile.tags.map((tag) => (
                      <span
                        key={tag}
                        className="px-2 py-0.5 text-xs rounded-full bg-blue-500/20 text-blue-300"
                      >
                        {tag}
                      </span>
                    ))}
                  </div>
                )}
              </div>
              <div className="flex items-center gap-2">
                <button
                  onClick={() => mgr.handleDuplicateProfile(profile.id)}
                  className="p-2 text-[var(--color-textSecondary)] hover:text-blue-400 hover:bg-[var(--color-border)] rounded-md"
                  title="Duplicate"
                >
                  <Copy size={14} />
                </button>
                <button
                  onClick={() => mgr.handleEditProfile(profile)}
                  className="p-2 text-[var(--color-textSecondary)] hover:text-blue-400 hover:bg-[var(--color-border)] rounded-md"
                  title="Edit"
                >
                  <Edit2 size={14} />
                </button>
                <button
                  onClick={() => mgr.handleDeleteProfile(profile.id)}
                  className="p-2 text-[var(--color-textSecondary)] hover:text-red-400 hover:bg-[var(--color-border)] rounded-md"
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
  );
}

function ChainsTab({ mgr }: { mgr: Mgr }) {
  return (
    <div className="space-y-6">
      {/* Saved Chains Section */}
      <div className="space-y-4">
        <div className="flex items-center justify-between">
          <h3 className="text-lg font-medium text-[var(--color-text)]">
            Saved Chains
          </h3>
          <button
            onClick={mgr.handleNewChain}
            className="flex items-center gap-2 px-3 py-1.5 text-sm rounded-md bg-blue-600 hover:bg-blue-700 text-[var(--color-text)]"
          >
            <Plus size={14} />
            New Chain
          </button>
        </div>

        <div className="text-sm text-[var(--color-textSecondary)]">
          Create reusable proxy chains that route traffic through multiple
          layers.
        </div>

        {/* Search */}
        <div className="relative">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-[var(--color-textSecondary)]" />
          <input
            type="text"
            value={mgr.chainSearch}
            onChange={(e) => mgr.setChainSearch(e.target.value)}
            placeholder="Search chains..."
            className="w-full pl-9 pr-4 py-2 bg-[var(--color-surface)] border border-[var(--color-border)] rounded-lg text-[var(--color-text)] text-sm placeholder:text-gray-500 focus:ring-2 focus:ring-blue-500"
          />
        </div>

        {/* Saved Chains List */}
        <div className="space-y-2">
          {mgr.filteredSavedChains.length === 0 ? (
            <div className="text-sm text-[var(--color-textSecondary)] py-6 text-center">
              {mgr.chainSearch
                ? "No chains match your search."
                : 'No proxy chains saved. Click "New Chain" to create one.'}
            </div>
          ) : (
            mgr.filteredSavedChains.map((chain) => (
              <div
                key={chain.id}
                className="flex items-center justify-between rounded-md border border-[var(--color-border)] bg-[var(--color-surface)]/60 px-4 py-3"
              >
                <div className="flex-1">
                  <div className="flex items-center gap-2">
                    <div className="text-sm font-medium text-[var(--color-text)]">
                      {chain.name}
                    </div>
                    <span className="px-2 py-0.5 text-xs rounded-full bg-purple-500/20 text-purple-400">
                      {chain.layers.length} layer
                      {chain.layers.length !== 1 ? "s" : ""}
                    </span>
                  </div>
                  {chain.description && (
                    <div className="text-xs text-gray-500 mt-1">
                      {chain.description}
                    </div>
                  )}
                  <div className="text-xs text-[var(--color-textSecondary)] mt-1 font-mono">
                    {chain.layers.map((layer, i) => {
                      const profile = layer.proxyProfileId
                        ? mgr.savedProfiles.find(
                            (p) => p.id === layer.proxyProfileId,
                          )
                        : null;
                      return (
                        <span key={i}>
                          {i > 0 && " → "}
                          {layer.type === "proxy" && profile
                            ? `${profile.name}`
                            : layer.type}
                        </span>
                      );
                    })}
                  </div>
                  {chain.tags && chain.tags.length > 0 && (
                    <div className="flex gap-1 mt-2">
                      {chain.tags.map((tag) => (
                        <span
                          key={tag}
                          className="px-2 py-0.5 text-xs rounded-full bg-blue-500/20 text-blue-300"
                        >
                          {tag}
                        </span>
                      ))}
                    </div>
                  )}
                </div>
                <div className="flex items-center gap-2">
                  <button
                    onClick={() => mgr.handleDuplicateChain(chain.id)}
                    className="p-2 text-[var(--color-textSecondary)] hover:text-blue-400 hover:bg-[var(--color-border)] rounded-md"
                    title="Duplicate"
                  >
                    <Copy size={14} />
                  </button>
                  <button
                    onClick={() => mgr.handleEditChain(chain)}
                    className="p-2 text-[var(--color-textSecondary)] hover:text-blue-400 hover:bg-[var(--color-border)] rounded-md"
                    title="Edit"
                  >
                    <Edit2 size={14} />
                  </button>
                  <button
                    onClick={() => mgr.handleDeleteChain(chain.id)}
                    className="p-2 text-[var(--color-textSecondary)] hover:text-red-400 hover:bg-[var(--color-border)] rounded-md"
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
      <div className="border-t border-[var(--color-border)] pt-6 space-y-4">
        <div className="flex items-center justify-between">
          <h3 className="text-lg font-medium text-[var(--color-text)]">
            Active Chains
          </h3>
          {mgr.isLoading && (
            <span className="text-xs text-[var(--color-textSecondary)]">
              Refreshing...
            </span>
          )}
        </div>

        <div className="rounded-lg border border-[var(--color-border)]/70 bg-[var(--color-background)]/40 p-4">
          <div className="text-sm font-semibold text-gray-200 mb-3">
            Connection Chains
          </div>
          {mgr.connectionChains.length === 0 ? (
            <div className="text-sm text-[var(--color-textSecondary)]">
              No connection chains available.
            </div>
          ) : (
            mgr.connectionChains.map((chain) => (
              <div
                key={chain.id}
                className="flex items-center justify-between rounded-md border border-[var(--color-border)] bg-[var(--color-surface)]/60 px-3 py-2 mb-2 last:mb-0"
              >
                <div>
                  <div className="text-sm font-medium text-[var(--color-text)]">
                    {chain.name}
                  </div>
                  <div className="text-xs text-[var(--color-textSecondary)]">
                    {chain.layers.length} layers · {chain.status}
                  </div>
                </div>
                <div className="flex items-center gap-2">
                  {String(chain.status).toLowerCase() === "connected" ? (
                    <button
                      onClick={() => mgr.handleDisconnectChain(chain.id)}
                      className="px-3 py-1 text-xs rounded-md bg-[var(--color-border)] hover:bg-[var(--color-border)] text-gray-200"
                    >
                      Disconnect
                    </button>
                  ) : (
                    <button
                      onClick={() => mgr.handleConnectChain(chain.id)}
                      className="px-3 py-1 text-xs rounded-md bg-blue-600 hover:bg-blue-700 text-[var(--color-text)]"
                    >
                      Connect
                    </button>
                  )}
                </div>
              </div>
            ))
          )}
        </div>

        <div className="rounded-lg border border-[var(--color-border)]/70 bg-[var(--color-background)]/40 p-4">
          <div className="text-sm font-semibold text-gray-200 mb-3">
            Proxy Chains
          </div>
          {mgr.proxyChains.length === 0 ? (
            <div className="text-sm text-[var(--color-textSecondary)]">
              No proxy chains available.
            </div>
          ) : (
            mgr.proxyChains.map((chain) => (
              <div
                key={chain.id}
                className="flex items-center justify-between rounded-md border border-[var(--color-border)] bg-[var(--color-surface)]/60 px-3 py-2 mb-2 last:mb-0"
              >
                <div>
                  <div className="text-sm font-medium text-[var(--color-text)]">
                    {chain.name}
                  </div>
                  <div className="text-xs text-[var(--color-textSecondary)]">
                    {chain.layers.length} layers · {chain.status}
                  </div>
                </div>
                <div className="flex items-center gap-2">
                  {String(chain.status).toLowerCase() === "connected" ? (
                    <button
                      onClick={() =>
                        mgr.handleDisconnectProxyChain(chain.id)
                      }
                      className="px-3 py-1 text-xs rounded-md bg-[var(--color-border)] hover:bg-[var(--color-border)] text-gray-200"
                    >
                      Disconnect
                    </button>
                  ) : (
                    <button
                      onClick={() => mgr.handleConnectProxyChain(chain.id)}
                      className="px-3 py-1 text-xs rounded-md bg-blue-600 hover:bg-blue-700 text-[var(--color-text)]"
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
  );
}

function TunnelsTab({ mgr }: { mgr: Mgr }) {
  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <h3 className="text-lg font-medium text-[var(--color-text)]">
          SSH Tunnels
        </h3>
        <button
          onClick={mgr.handleNewTunnel}
          className="flex items-center gap-2 px-3 py-1.5 text-sm rounded-md bg-blue-600 hover:bg-blue-700 text-[var(--color-text)]"
        >
          <Plus size={14} />
          New Tunnel
        </button>
      </div>

      <div className="text-sm text-[var(--color-textSecondary)]">
        Create SSH tunnels using existing SSH connections to forward ports
        securely.
      </div>

      <div className="space-y-2">
        {mgr.sshTunnels.length === 0 ? (
          <div className="text-sm text-[var(--color-textSecondary)] py-8 text-center">
            No SSH tunnels configured. Click "New Tunnel" to create one.
          </div>
        ) : (
          mgr.sshTunnels.map((tunnel) => {
            const sshConn = mgr.connections.find(
              (c) => c.id === tunnel.sshConnectionId,
            );
            const localPort =
              tunnel.actualLocalPort || tunnel.localPort || "?";

            const getTunnelInfo = () => {
              switch (tunnel.type) {
                case "dynamic":
                  return `SOCKS5 proxy on localhost:${localPort}`;
                case "remote":
                  return `${tunnel.remoteHost}:${tunnel.remotePort} → localhost:${localPort}`;
                case "local":
                default:
                  return `localhost:${localPort} → ${tunnel.remoteHost}:${tunnel.remotePort}`;
              }
            };

            const getTypeLabel = () => {
              switch (tunnel.type) {
                case "dynamic":
                  return "Dynamic";
                case "remote":
                  return "Remote";
                case "local":
                default:
                  return "Local";
              }
            };

            return (
              <div
                key={tunnel.id}
                className="flex items-center justify-between rounded-md border border-[var(--color-border)] bg-[var(--color-surface)]/60 px-4 py-3"
              >
                <div className="flex-1">
                  <div className="flex items-center gap-2">
                    <div className="text-sm font-medium text-[var(--color-text)]">
                      {tunnel.name}
                    </div>
                    <span className="px-2 py-0.5 text-xs rounded-full bg-blue-500/20 text-blue-400">
                      {getTypeLabel()}
                    </span>
                    <span
                      className={`px-2 py-0.5 text-xs rounded-full ${
                        tunnel.status === "connected"
                          ? "bg-green-500/20 text-green-400"
                          : tunnel.status === "connecting"
                            ? "bg-yellow-500/20 text-yellow-400"
                            : tunnel.status === "error"
                              ? "bg-red-500/20 text-red-400"
                              : "bg-gray-500/20 text-[var(--color-textSecondary)]"
                      }`}
                    >
                      {tunnel.status}
                    </span>
                  </div>
                  <div className="text-xs text-[var(--color-textSecondary)] mt-1">
                    <span className="text-gray-500">via</span>{" "}
                    {sshConn?.name || "Unknown SSH"}
                  </div>
                  <div className="text-xs text-[var(--color-textSecondary)] mt-0.5 font-mono">
                    {getTunnelInfo()}
                  </div>
                  {tunnel.error && (
                    <div className="text-xs text-red-400 mt-1">
                      {tunnel.error}
                    </div>
                  )}
                </div>
                <div className="flex items-center gap-2">
                  {tunnel.status === "connected" ? (
                    <button
                      onClick={() => mgr.handleDisconnectTunnel(tunnel.id)}
                      className="p-2 text-[var(--color-textSecondary)] hover:text-[var(--color-text)] hover:bg-[var(--color-border)] rounded-md"
                      title="Disconnect"
                    >
                      <Square size={14} />
                    </button>
                  ) : (
                    <button
                      onClick={() => mgr.handleConnectTunnel(tunnel.id)}
                      disabled={tunnel.status === "connecting"}
                      className="p-2 text-[var(--color-textSecondary)] hover:text-green-400 hover:bg-[var(--color-border)] rounded-md disabled:opacity-50"
                      title="Connect"
                    >
                      <Play size={14} />
                    </button>
                  )}
                  <button
                    onClick={() => mgr.handleEditTunnel(tunnel)}
                    disabled={tunnel.status === "connected"}
                    className="p-2 text-[var(--color-textSecondary)] hover:text-blue-400 hover:bg-[var(--color-border)] rounded-md disabled:opacity-50"
                    title="Edit"
                  >
                    <Edit2 size={14} />
                  </button>
                  <button
                    onClick={() => mgr.handleDeleteTunnel(tunnel.id)}
                    disabled={tunnel.status === "connected"}
                    className="p-2 text-[var(--color-textSecondary)] hover:text-red-400 hover:bg-[var(--color-border)] rounded-md disabled:opacity-50"
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
  );
}

function AssociationsTab({ mgr }: { mgr: Mgr }) {
  return (
    <div className="space-y-4">
      <div className="text-sm text-[var(--color-textSecondary)]">
        Associate chains with individual connections. These choices will be used
        when launching sessions.
      </div>
      <div className="space-y-3">
        {mgr.connectionOptions.map((connection) => (
          <div
            key={connection.id}
            className="rounded-lg border border-[var(--color-border)] bg-[var(--color-background)]/40 p-3"
          >
            <div className="text-sm font-medium text-[var(--color-text)] mb-2">
              {connection.name}
            </div>
            <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
              <div>
                <label className="block text-xs text-[var(--color-textSecondary)] mb-1">
                  Connection Chain
                </label>
                <Select value={connection.connectionChainId || ""} onChange={(v: string) =>
                    mgr.updateConnectionChain(connection.id, v)} options={[{ value: '', label: 'None' }, ...mgr.connectionChains.map((chain) => ({ value: chain.id, label: chain.name }))]} className="w-full px-3 py-2 bg-[var(--color-border)] border border-[var(--color-border)] rounded-md text-[var(--color-text)] text-sm" />
              </div>
              <div>
                <label className="block text-xs text-[var(--color-textSecondary)] mb-1">
                  Proxy Chain
                </label>
                <Select value={connection.proxyChainId || ""} onChange={(v: string) =>
                    mgr.updateProxyChain(connection.id, v)} options={[{ value: '', label: 'None' }, ...mgr.proxyChains.map((chain) => ({ value: chain.id, label: chain.name }))]} className="w-full px-3 py-2 bg-[var(--color-border)] border border-[var(--color-border)] rounded-md text-[var(--color-text)] text-sm" />
              </div>
            </div>
          </div>
        ))}
        {mgr.connectionOptions.length === 0 && (
          <div className="text-sm text-[var(--color-textSecondary)]">
            No connections available.
          </div>
        )}
      </div>
    </div>
  );
}
