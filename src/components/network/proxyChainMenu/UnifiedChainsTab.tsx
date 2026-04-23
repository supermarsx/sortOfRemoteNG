import React from "react";
import {
  Plus, Trash2, Copy, Edit2, Search, Zap, ZapOff,
  AlertCircle,
} from "lucide-react";
import type { TunnelChainManager } from "../../../hooks/network/useTunnelChainManager";
import type { Mgr } from "./types";
import {
  getTypeIcon,
  getTypeLabel,
  getProfileConfigSummary,
} from "./tunnelChainShared.helpers";
import { ChainPreviewInline } from "./tunnelChainShared";

interface UnifiedChainsTabProps {
  isOpen: boolean;
  tunnelMgr: TunnelChainManager;
  mgr: Mgr;
}

function ChainStatusBadge({ status }: { status: string }) {
  switch (status) {
    case "connected":
      return (
        <span className="text-[10px] px-1.5 py-0.5 rounded bg-[var(--color-success)]/15 text-[var(--color-success)]">
          Connected
        </span>
      );
    case "connecting":
      return (
        <span className="text-[10px] px-1.5 py-0.5 rounded bg-[var(--color-warning)]/15 text-[var(--color-warning)]">
          Connecting...
        </span>
      );
    case "disconnecting":
      return (
        <span className="text-[10px] px-1.5 py-0.5 rounded bg-[var(--color-warning)]/15 text-[var(--color-warning)]">
          Disconnecting...
        </span>
      );
    case "error":
      return (
        <span className="text-[10px] px-1.5 py-0.5 rounded bg-[var(--color-danger)]/15 text-[var(--color-danger)] inline-flex items-center gap-1">
          <AlertCircle size={10} /> Error
        </span>
      );
    default:
      return null;
  }
}

const UnifiedChainsTab: React.FC<UnifiedChainsTabProps> = ({ isOpen, tunnelMgr, mgr }) => {
  if (!isOpen) return null;

  return (
    <div className="space-y-6">
      {/* ═══ Chains Library ══════════════════════════════════════ */}
      <div className="space-y-4">
        <div className="flex items-center justify-between">
          <h3 className="text-lg font-medium text-[var(--color-text)]">
            Chains
          </h3>
          <button
            onClick={tunnelMgr.handleNewChain}
            className="sor-btn-primary-sm"
          >
            <Plus size={14} />
            New Chain
          </button>
        </div>

        <div className="text-sm text-[var(--color-textSecondary)]">
          Create and manage multi-hop chains that route traffic through VPNs, SSH
          tunnels, and proxies. Each layer wraps the next, with the first layer
          being the outermost hop.
        </div>

        {/* Search */}
        <div className="relative">
          <Search className="sor-search-icon-abs" />
          <input
            type="text"
            value={tunnelMgr.chainSearch}
            onChange={e => tunnelMgr.setChainSearch(e.target.value)}
            placeholder="Search chains..."
            className="sor-search-input"
          />
        </div>

        {/* Chain list — tunnel chains (the primary chain type) */}
        <div className="space-y-2">
          {tunnelMgr.filteredChains.length === 0 && mgr.filteredSavedChains.length === 0 ? (
            <div className="text-sm text-[var(--color-textSecondary)] py-6 text-center">
              {tunnelMgr.chainSearch
                ? "No chains match your search."
                : 'No chains saved. Click "New Chain" to create one.'}
            </div>
          ) : (
            <>
              {/* Tunnel chains (full-featured rows with status, connect/disconnect) */}
              {tunnelMgr.filteredChains.map(chain => {
                const activeStatus = tunnelMgr.activeStatuses.get(chain.id);
                const isConnected = activeStatus?.status === "connected";
                const isConnecting = activeStatus?.status === "connecting";

                return (
                  <div
                    key={chain.id}
                    className="sor-selection-row"
                  >
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-2">
                        <div className="text-sm font-medium text-[var(--color-text)] truncate">
                          {chain.name}
                        </div>
                        <span className="sor-badge sor-badge-purple shrink-0">
                          {chain.layers.length} layer{chain.layers.length !== 1 ? "s" : ""}
                        </span>
                        {activeStatus && <ChainStatusBadge status={activeStatus.status} />}
                      </div>
                      {chain.description && (
                        <div className="text-xs text-[var(--color-textMuted)] mt-1 truncate">
                          {chain.description}
                        </div>
                      )}
                      <div className="mt-1.5">
                        <ChainPreviewInline layers={chain.layers} />
                      </div>
                      {chain.tags && chain.tags.length > 0 && (
                        <div className="flex gap-1 mt-2">
                          {chain.tags.map(tag => (
                            <span key={tag} className="sor-badge sor-badge-blue">
                              {tag}
                            </span>
                          ))}
                        </div>
                      )}
                      {activeStatus?.error && (
                        <div className="text-xs text-[var(--color-danger)] mt-1 truncate">
                          {activeStatus.error}
                        </div>
                      )}
                    </div>
                    <div className="flex items-center gap-2 shrink-0">
                      {isConnected ? (
                        <button
                          onClick={() => tunnelMgr.handleDisconnectChain(chain.id)}
                          disabled={tunnelMgr.isLoading}
                          className="inline-flex items-center gap-1 px-2.5 py-1 text-xs rounded-md bg-[var(--color-border)] hover:bg-[var(--color-border)] text-[var(--color-textSecondary)] transition-colors disabled:opacity-50"
                        >
                          <ZapOff size={12} /> Disconnect
                        </button>
                      ) : (
                        <button
                          onClick={() => tunnelMgr.handleConnectChain(chain.id)}
                          disabled={tunnelMgr.isLoading || isConnecting}
                          className="inline-flex items-center gap-1 px-2.5 py-1 text-xs rounded-md bg-[var(--color-success)]/15 hover:bg-[var(--color-success)]/25 text-[var(--color-success)] transition-colors disabled:opacity-50"
                        >
                          <Zap size={12} /> Connect
                        </button>
                      )}
                      <button
                        onClick={() => tunnelMgr.handleDuplicateChain(chain.id)}
                        className="sor-icon-btn"
                        title="Duplicate"
                      >
                        <Copy size={14} />
                      </button>
                      <button
                        onClick={() => tunnelMgr.handleEditChain(chain)}
                        className="sor-icon-btn"
                        title="Edit"
                      >
                        <Edit2 size={14} />
                      </button>
                      <button
                        onClick={() => tunnelMgr.handleDeleteChain(chain.id)}
                        className="sor-icon-btn-danger"
                        title="Delete"
                      >
                        <Trash2 size={14} />
                      </button>
                    </div>
                  </div>
                );
              })}

              {/* Legacy saved proxy chains (from proxyCollectionManager) */}
              {mgr.filteredSavedChains.map((chain) => (
                <div
                  key={`legacy-${chain.id}`}
                  className="sor-selection-row"
                >
                  <div className="flex-1">
                    <div className="flex items-center gap-2">
                      <div className="text-sm font-medium text-[var(--color-text)]">
                        {chain.name}
                      </div>
                      <span className="sor-badge sor-badge-purple">
                        {chain.layers.length} layer
                        {chain.layers.length !== 1 ? "s" : ""}
                      </span>
                      <span className="text-[10px] px-1.5 py-0.5 rounded bg-[var(--color-textMuted)]/10 text-[var(--color-textMuted)]">
                        Proxy Chain
                      </span>
                    </div>
                    {chain.description && (
                      <div className="text-xs text-[var(--color-textMuted)] mt-1">
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
                            {i > 0 && " \u2192 "}
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
                            className="sor-badge sor-badge-blue"
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
                      className="sor-icon-btn"
                      title="Duplicate"
                    >
                      <Copy size={14} />
                    </button>
                    <button
                      onClick={() => mgr.handleEditChain(chain)}
                      className="sor-icon-btn"
                      title="Edit"
                    >
                      <Edit2 size={14} />
                    </button>
                    <button
                      onClick={() => mgr.handleDeleteChain(chain.id)}
                      className="sor-icon-btn-danger"
                      title="Delete"
                    >
                      <Trash2 size={14} />
                    </button>
                  </div>
                </div>
              ))}
            </>
          )}
        </div>
      </div>

      {/* ═══ Active Backend Chains ══════════════════════════════ */}
      {(mgr.connectionChains.length > 0 || mgr.proxyChains.length > 0) && (
        <div className="border-t border-[var(--color-border)] pt-6 space-y-4">
          <div className="flex items-center justify-between">
            <h3 className="text-lg font-medium text-[var(--color-text)]">
              Active Backend Chains
            </h3>
            {mgr.isLoading && (
              <span className="text-xs text-[var(--color-textSecondary)]">
                Refreshing...
              </span>
            )}
          </div>

          {/* Connection Chains */}
          {mgr.connectionChains.length > 0 && (
            <div className="space-y-2">
              {mgr.connectionChains.map((chain) => (
                <div
                  key={chain.id}
                  className="flex items-center justify-between rounded-md border border-[var(--color-border)] bg-[var(--color-surface)]/60 px-3 py-2"
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
                        className="px-3 py-1 text-xs rounded-md bg-[var(--color-border)] hover:bg-[var(--color-border)] text-[var(--color-textSecondary)]"
                      >
                        Disconnect
                      </button>
                    ) : (
                      <button
                        onClick={() => mgr.handleConnectChain(chain.id)}
                        className="px-3 py-1 text-xs rounded-md bg-primary hover:bg-primary/90 text-[var(--color-text)]"
                      >
                        Connect
                      </button>
                    )}
                  </div>
                </div>
              ))}
            </div>
          )}

          {/* Proxy Chains */}
          {mgr.proxyChains.length > 0 && (
            <div className="space-y-2">
              {mgr.proxyChains.map((chain) => (
                <div
                  key={chain.id}
                  className="flex items-center justify-between rounded-md border border-[var(--color-border)] bg-[var(--color-surface)]/60 px-3 py-2"
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
                        onClick={() => mgr.handleDisconnectProxyChain(chain.id)}
                        className="px-3 py-1 text-xs rounded-md bg-[var(--color-border)] hover:bg-[var(--color-border)] text-[var(--color-textSecondary)]"
                      >
                        Disconnect
                      </button>
                    ) : (
                      <button
                        onClick={() => mgr.handleConnectProxyChain(chain.id)}
                        className="px-3 py-1 text-xs rounded-md bg-primary hover:bg-primary/90 text-[var(--color-text)]"
                      >
                        Connect
                      </button>
                    )}
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      )}

      {/* ═══ Layer Profiles ═════════════════════════════════════ */}
      <div className="border-t border-[var(--color-border)] pt-6 space-y-4">
        <div className="flex items-center justify-between">
          <h3 className="text-lg font-medium text-[var(--color-text)]">
            Layer Profiles
          </h3>
          <button
            onClick={tunnelMgr.handleNewProfile}
            className="sor-btn-primary-sm"
          >
            <Plus size={14} />
            New Profile
          </button>
        </div>

        <div className="text-sm text-[var(--color-textSecondary)]">
          Reusable tunnel configurations. Add profiles to chains to compose
          complex multi-hop paths.
        </div>

        {/* Search */}
        <div className="relative">
          <Search className="sor-search-icon-abs" />
          <input
            type="text"
            value={tunnelMgr.profileSearch}
            onChange={e => tunnelMgr.setProfileSearch(e.target.value)}
            placeholder="Search profiles..."
            className="sor-search-input"
          />
        </div>

        {/* Profile list */}
        <div className="space-y-2">
          {tunnelMgr.filteredProfiles.length === 0 ? (
            <div className="text-sm text-[var(--color-textSecondary)] py-6 text-center">
              {tunnelMgr.profileSearch
                ? "No profiles match your search."
                : 'No profiles saved. Click "New Profile" to create one.'}
            </div>
          ) : (
            tunnelMgr.filteredProfiles.map(profile => (
              <div
                key={profile.id}
                className="sor-selection-row"
              >
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2">
                    <span className="text-[var(--color-textSecondary)]">
                      {getTypeIcon(profile.type)}
                    </span>
                    <div className="text-sm font-medium text-[var(--color-text)] truncate">
                      {profile.name}
                    </div>
                    <span className="sor-badge sor-badge-purple shrink-0">
                      {getTypeLabel(profile.type)}
                    </span>
                  </div>
                  {profile.description && (
                    <div className="text-xs text-[var(--color-textMuted)] mt-1 truncate">
                      {profile.description}
                    </div>
                  )}
                  <div className="text-xs text-[var(--color-textSecondary)] mt-1 font-mono truncate">
                    {getProfileConfigSummary(profile.config)}
                  </div>
                  {profile.tags && profile.tags.length > 0 && (
                    <div className="flex gap-1 mt-2">
                      {profile.tags.map(tag => (
                        <span key={tag} className="sor-badge sor-badge-blue">
                          {tag}
                        </span>
                      ))}
                    </div>
                  )}
                </div>
                <div className="flex items-center gap-2 shrink-0">
                  <button
                    onClick={() => tunnelMgr.handleDuplicateProfile(profile.id)}
                    className="sor-icon-btn"
                    title="Duplicate"
                  >
                    <Copy size={14} />
                  </button>
                  <button
                    onClick={() => tunnelMgr.handleEditProfile(profile)}
                    className="sor-icon-btn"
                    title="Edit"
                  >
                    <Edit2 size={14} />
                  </button>
                  <button
                    onClick={() => tunnelMgr.handleDeleteProfile(profile.id)}
                    className="sor-icon-btn-danger"
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

      {/* Info box */}
      <div className="rounded-lg border border-[var(--color-border)] bg-[var(--color-backgroundSecondary)]/50 p-3">
        <div className="text-xs text-[var(--color-textSecondary)]">
          <strong>Chains</strong> define an ordered sequence of tunnels (VPN, SSH
          jump hosts, proxies) that traffic traverses before reaching the target.
          Each layer wraps the next, with the first layer being the outermost hop.
          Assign chains to connections in the <strong>Associations</strong> tab or
          activate them using the Connect button.
        </div>
      </div>
    </div>
  );
};

export default UnifiedChainsTab;
