import { useTranslation } from "react-i18next";
import { Copy, Edit2, Plus, Search, Trash2 } from "lucide-react";
import { Mgr } from "./types";

function ChainsTab({ mgr }: { mgr: Mgr }) {
  const { t } = useTranslation();

  const layerCountLabel = (count: number) =>
    count === 1
      ? t("proxyChainMenu.shared.layerCountOne", "{{count}} layer", { count })
      : t("proxyChainMenu.shared.layerCountOther", "{{count}} layers", {
          count,
        });

  return (
    <div className="space-y-6">
      {/* Saved Chains Section */}
      <div className="space-y-4">
        <div className="flex items-center justify-between">
          <h3 className="text-lg font-medium text-[var(--color-text)]">
            {t("proxyChainMenu.chains.savedTitle", "Saved Chains")}
          </h3>
          <button onClick={mgr.handleNewChain} className="sor-btn-primary-sm">
            <Plus size={14} />
            {t("proxyChainMenu.chains.newChain", "New Chain")}
          </button>
        </div>

        <div className="text-sm text-[var(--color-textSecondary)]">
          {t(
            "proxyChainMenu.chains.description",
            "Reusable proxy chains that route traffic through multiple proxy layers. Chains built from tunnel layers such as SSH, VPN or mesh live in the Tunnel Chains tab.",
          )}
        </div>

        {/* Search */}
        <div className="relative">
          <Search className="sor-search-icon-abs" />
          <input
            type="text"
            value={mgr.chainSearch}
            onChange={(e) => mgr.setChainSearch(e.target.value)}
            placeholder={t(
              "proxyChainMenu.chains.searchPlaceholder",
              "Search chains...",
            )}
            className="sor-search-input"
          />
        </div>

        {/* Saved Chains List */}
        <div className="space-y-2">
          {mgr.filteredSavedChains.length === 0 ? (
            <div className="text-sm text-[var(--color-textSecondary)] py-6 text-center">
              {mgr.chainSearch
                ? t(
                    "proxyChainMenu.chains.noMatches",
                    "No chains match your search.",
                  )
                : t(
                    "proxyChainMenu.chains.empty",
                    'No proxy chains saved. Click "New Chain" to create one.',
                  )}
            </div>
          ) : (
            mgr.filteredSavedChains.map((chain) => (
              <div key={chain.id} className="sor-selection-row">
                <div className="flex-1">
                  <div className="flex items-center gap-2">
                    <div className="text-sm font-medium text-[var(--color-text)]">
                      {chain.name}
                    </div>
                    <span className="sor-badge sor-badge-purple">
                      {layerCountLabel(chain.layers.length)}
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
            ))
          )}
        </div>
      </div>

      {/* Active Chains Section */}
      <div className="border-t border-[var(--color-border)] pt-6 space-y-4">
        <div className="flex items-center justify-between">
          <h3 className="text-lg font-medium text-[var(--color-text)]">
            {t("proxyChainMenu.chains.activeTitle", "Active Chains")}
          </h3>
          {mgr.isLoading && (
            <span className="text-xs text-[var(--color-textSecondary)]">
              {t("proxyChainMenu.chains.refreshing", "Refreshing...")}
            </span>
          )}
        </div>

        <div className="rounded-lg border border-[var(--color-border)]/70 bg-[var(--color-background)]/40 p-4">
          <div className="text-sm font-semibold text-[var(--color-textSecondary)] mb-3">
            {t("proxyChainMenu.chains.connectionChains", "Connection Chains")}
          </div>
          {mgr.connectionChains.length === 0 ? (
            <div className="text-sm text-[var(--color-textSecondary)]">
              {t(
                "proxyChainMenu.chains.noConnectionChains",
                "No connection chains available.",
              )}
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
                    {layerCountLabel(chain.layers.length)} · {chain.status}
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
            ))
          )}
        </div>

        <div className="rounded-lg border border-[var(--color-border)]/70 bg-[var(--color-background)]/40 p-4">
          <div className="text-sm font-semibold text-[var(--color-textSecondary)] mb-3">
            {t("proxyChainMenu.chains.proxyChains", "Proxy Chains")}
          </div>
          {mgr.proxyChains.length === 0 ? (
            <div className="text-sm text-[var(--color-textSecondary)]">
              {t(
                "proxyChainMenu.chains.noProxyChains",
                "No proxy chains available.",
              )}
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
                    {layerCountLabel(chain.layers.length)} · {chain.status}
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
            ))
          )}
        </div>
      </div>
    </div>
  );
}

export default ChainsTab;
