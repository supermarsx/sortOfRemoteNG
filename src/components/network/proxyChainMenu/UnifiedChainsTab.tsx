import React from "react";
import { Plus, Trash2, Copy, Edit2, Search } from "lucide-react";
import { useTranslation } from "react-i18next";
import type { TunnelChainManager } from "../../../hooks/network/useTunnelChainManager";
import type { Mgr } from "./types";
import { TunnelChainRow } from "./tunnelChainShared";

interface UnifiedChainsTabProps {
  isOpen: boolean;
  tunnelMgr: TunnelChainManager;
  mgr: Mgr;
}

const UnifiedChainsTab: React.FC<UnifiedChainsTabProps> = ({
  isOpen,
  tunnelMgr,
  mgr,
}) => {
  const { t } = useTranslation();

  if (!isOpen) return null;

  // This tab is the union view: data.chains ∪ data.tunnelChains. One box must
  // therefore drive both collections' searches, or half the list ignores it.
  const handleSearchChange = (value: string) => {
    tunnelMgr.setChainSearch(value);
    mgr.setChainSearch(value);
  };

  return (
    <div className="space-y-6">
      {/* ═══ Chains Library ══════════════════════════════════════ */}
      <div className="space-y-4">
        <div className="flex items-center justify-between">
          <h3 className="text-lg font-medium text-[var(--color-text)]">
            {t("proxyChainMenu.unifiedChains.title", "Chains")}
          </h3>
          <button
            onClick={tunnelMgr.handleNewChain}
            className="sor-btn-primary-sm"
          >
            <Plus size={14} />
            {t("proxyChainMenu.unifiedChains.newChain", "New Chain")}
          </button>
        </div>

        <div className="text-sm text-[var(--color-textSecondary)]">
          {t(
            "proxyChainMenu.unifiedChains.description",
            "Create and manage multi-hop chains that route traffic through VPNs, SSH tunnels, and proxies. Each layer wraps the next, with the first layer being the outermost hop.",
          )}
        </div>

        {/* Search — drives both the tunnel chains and the legacy proxy chains */}
        <div className="relative">
          <Search className="sor-search-icon-abs" />
          <input
            type="text"
            value={tunnelMgr.chainSearch}
            onChange={(e) => handleSearchChange(e.target.value)}
            placeholder={t(
              "proxyChainMenu.unifiedChains.searchPlaceholder",
              "Search chains...",
            )}
            className="sor-search-input"
          />
        </div>

        {/* Chain list — tunnel chains + legacy proxy chains */}
        <div className="space-y-2">
          {tunnelMgr.filteredChains.length === 0 &&
          mgr.filteredSavedChains.length === 0 ? (
            <div className="text-sm text-[var(--color-textSecondary)] py-6 text-center">
              {tunnelMgr.chainSearch
                ? t(
                    "proxyChainMenu.unifiedChains.noMatches",
                    "No chains match your search.",
                  )
                : t(
                    "proxyChainMenu.unifiedChains.empty",
                    'No chains saved. Click "New Chain" to create one.',
                  )}
            </div>
          ) : (
            <>
              {/* Tunnel chains (full-featured rows with status, guarded connect) */}
              {tunnelMgr.filteredChains.map((chain) => (
                <TunnelChainRow
                  key={chain.id}
                  chain={chain}
                  tunnelMgr={tunnelMgr}
                />
              ))}

              {/* Legacy saved proxy chains (from proxyCollectionManager) */}
              {mgr.filteredSavedChains.map((chain) => (
                <div key={`legacy-${chain.id}`} className="sor-selection-row">
                  <div className="flex-1">
                    <div className="flex items-center gap-2">
                      <div className="text-sm font-medium text-[var(--color-text)]">
                        {chain.name}
                      </div>
                      <span className="sor-badge sor-badge-purple">
                        {chain.layers.length === 1
                          ? t(
                              "proxyChainMenu.shared.layerCountOne",
                              "{{count}} layer",
                              { count: chain.layers.length },
                            )
                          : t(
                              "proxyChainMenu.shared.layerCountOther",
                              "{{count}} layers",
                              { count: chain.layers.length },
                            )}
                      </span>
                      <span className="text-[10px] px-1.5 py-0.5 rounded bg-[var(--color-textMuted)]/10 text-[var(--color-textMuted)]">
                        {t(
                          "proxyChainMenu.unifiedChains.proxyChainBadge",
                          "Proxy Chain",
                        )}
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
                          <span key={tag} className="sor-badge sor-badge-blue">
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
                      title={t("proxyChainMenu.common.duplicate", "Duplicate")}
                    >
                      <Copy size={14} />
                    </button>
                    <button
                      onClick={() => mgr.handleEditChain(chain)}
                      className="sor-icon-btn"
                      title={t("proxyChainMenu.common.edit", "Edit")}
                    >
                      <Edit2 size={14} />
                    </button>
                    <button
                      onClick={() => mgr.handleDeleteChain(chain.id)}
                      className="sor-icon-btn-danger"
                      title={t("proxyChainMenu.common.delete", "Delete")}
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
              {t(
                "proxyChainMenu.unifiedChains.activeBackendChains",
                "Active Backend Chains",
              )}
            </h3>
            {mgr.isLoading && (
              <span className="text-xs text-[var(--color-textSecondary)]">
                {t("proxyChainMenu.unifiedChains.refreshing", "Refreshing...")}
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
                      {chain.layers.length === 1
                        ? t(
                            "proxyChainMenu.shared.layerCountOne",
                            "{{count}} layer",
                            { count: chain.layers.length },
                          )
                        : t(
                            "proxyChainMenu.shared.layerCountOther",
                            "{{count}} layers",
                            { count: chain.layers.length },
                          )}{" "}
                      · {chain.status}
                    </div>
                  </div>
                  <div className="flex items-center gap-2">
                    {String(chain.status).toLowerCase() === "connected" ? (
                      <button
                        onClick={() => mgr.handleDisconnectChain(chain.id)}
                        className="px-3 py-1 text-xs rounded-md bg-[var(--color-border)] hover:bg-[var(--color-border)] text-[var(--color-textSecondary)]"
                      >
                        {t("proxyChainMenu.common.disconnect", "Disconnect")}
                      </button>
                    ) : (
                      <button
                        onClick={() => mgr.handleConnectChain(chain.id)}
                        className="px-3 py-1 text-xs rounded-md bg-primary hover:bg-primary/90 text-[var(--color-text)]"
                      >
                        {t("proxyChainMenu.common.connect", "Connect")}
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
                      {chain.layers.length === 1
                        ? t(
                            "proxyChainMenu.shared.layerCountOne",
                            "{{count}} layer",
                            { count: chain.layers.length },
                          )
                        : t(
                            "proxyChainMenu.shared.layerCountOther",
                            "{{count}} layers",
                            { count: chain.layers.length },
                          )}{" "}
                      · {chain.status}
                    </div>
                  </div>
                  <div className="flex items-center gap-2">
                    {String(chain.status).toLowerCase() === "connected" ? (
                      <button
                        onClick={() => mgr.handleDisconnectProxyChain(chain.id)}
                        className="px-3 py-1 text-xs rounded-md bg-[var(--color-border)] hover:bg-[var(--color-border)] text-[var(--color-textSecondary)]"
                      >
                        {t("proxyChainMenu.common.disconnect", "Disconnect")}
                      </button>
                    ) : (
                      <button
                        onClick={() => mgr.handleConnectProxyChain(chain.id)}
                        className="px-3 py-1 text-xs rounded-md bg-primary hover:bg-primary/90 text-[var(--color-text)]"
                      >
                        {t("proxyChainMenu.common.connect", "Connect")}
                      </button>
                    )}
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      )}

      {/* Info box */}
      <div className="rounded-lg border border-[var(--color-border)] bg-[var(--color-backgroundSecondary)]/50 p-3">
        <div className="text-xs text-[var(--color-textSecondary)]">
          <strong>
            {t("proxyChainMenu.unifiedChains.info.chainsTerm", "Chains")}
          </strong>{" "}
          {t(
            "proxyChainMenu.unifiedChains.info.body",
            "define an ordered sequence of tunnels (VPN, SSH jump hosts, proxies) that traffic traverses before reaching the target. Each layer wraps the next, with the first layer being the outermost hop. Assign chains to connections in the",
          )}{" "}
          <strong>
            {t(
              "proxyChainMenu.unifiedChains.info.associationsTerm",
              "Associations",
            )}
          </strong>{" "}
          {t(
            "proxyChainMenu.unifiedChains.info.bodyEnd",
            "tab or activate them using the Connect button.",
          )}
        </div>
      </div>
    </div>
  );
};

export default UnifiedChainsTab;
