import React from "react";
import { Plus, Search } from "lucide-react";
import { useTranslation } from "react-i18next";
import type { TunnelChainManager } from "../../../hooks/network/useTunnelChainManager";
import { TunnelChainRow } from "./tunnelChainShared";

interface TunnelChainTabProps {
  isOpen: boolean;
  tunnelMgr: TunnelChainManager;
}

const TunnelChainTab: React.FC<TunnelChainTabProps> = ({
  isOpen,
  tunnelMgr,
}) => {
  const { t } = useTranslation();

  if (!isOpen) return null;

  return (
    <div className="space-y-6">
      {/* ═══ Tunnel Chains Library ═══════════════════════════════ */}
      <div className="space-y-4">
        <div className="flex items-center justify-between">
          <h3 className="text-lg font-medium text-[var(--color-text)]">
            {t("proxyChainMenu.tunnelChains.title", "Tunnel Chains")}
          </h3>
          <button
            onClick={tunnelMgr.handleNewChain}
            className="sor-btn-primary-sm"
          >
            <Plus size={14} />
            {t("proxyChainMenu.tunnelChains.newChain", "New Chain")}
          </button>
        </div>

        <div className="text-sm text-[var(--color-textSecondary)]">
          {t(
            "proxyChainMenu.tunnelChains.description",
            "Create and manage reusable tunnel chains — distinct from the proxy chains on the Chains tab. Each chain defines an ordered sequence of tunnels (VPN, SSH, proxy) that traffic traverses before reaching the target. Chains can be associated with connections; only proxy, VPN, and mesh layers can be activated independently.",
          )}
        </div>

        {/* Search */}
        <div className="relative">
          <Search className="sor-search-icon-abs" />
          <input
            type="text"
            value={tunnelMgr.chainSearch}
            onChange={(e) => tunnelMgr.setChainSearch(e.target.value)}
            placeholder={t(
              "proxyChainMenu.tunnelChains.searchPlaceholder",
              "Search tunnel chains...",
            )}
            className="sor-search-input"
          />
        </div>

        {/* Chain list */}
        <div className="space-y-2">
          {tunnelMgr.filteredChains.length === 0 ? (
            <div className="text-sm text-[var(--color-textSecondary)] py-6 text-center">
              {tunnelMgr.chainSearch
                ? t(
                    "proxyChainMenu.tunnelChains.emptySearch",
                    "No chains match your search.",
                  )
                : t(
                    "proxyChainMenu.tunnelChains.emptyLibrary",
                    'No tunnel chains saved. Click "New Chain" to create one.',
                  )}
            </div>
          ) : (
            tunnelMgr.filteredChains.map((chain) => (
              <TunnelChainRow
                key={chain.id}
                chain={chain}
                tunnelMgr={tunnelMgr}
              />
            ))
          )}
        </div>
      </div>

      {/* Info box */}
      <div className="rounded-lg border border-[var(--color-border)] bg-[var(--color-backgroundSecondary)]/50 p-3">
        <div className="text-xs text-[var(--color-textSecondary)]">
          <strong>
            {t("proxyChainMenu.tunnelChains.title", "Tunnel Chains")}
          </strong>{" "}
          {t(
            "proxyChainMenu.tunnelChains.infoBody",
            "define an ordered sequence of tunnels (VPN, SSH jump hosts, proxies) that traffic traverses before reaching the target host. Each layer wraps the next, with the first layer being the outermost hop. Assign chains to connections in the Associations tab or activate them independently using the Connect button.",
          )}
        </div>
      </div>
    </div>
  );
};

export default TunnelChainTab;
