// Nginx Proxy Manager — Redirection Hosts tab (t65-e4).

import React, { useEffect } from "react";
import { Loader2, Power, RefreshCw } from "lucide-react";
import { useTranslation } from "react-i18next";
import type { NginxProxyMgrManager } from "../../../hooks/integration/useNginxProxyMgr";
import { EmptyRow, EnabledBadge, isEnabled, npmBtn } from "./shared";

const NpmRedirectionsTab: React.FC<{ mgr: NginxProxyMgrManager }> = ({
  mgr,
}) => {
  const { t } = useTranslation();

  useEffect(() => {
    if (mgr.isConnected) void mgr.loadRedirectionHosts().catch(() => {});
    // eslint-disable-next-line react-hooks/exhaustive-deps, react/exhaustive-deps
  }, [mgr.isConnected]);

  return (
    <div className="flex flex-col gap-2" data-testid="npm-redirections-tab">
      <div className="flex items-center justify-between">
        <span className="text-xs text-[var(--color-textSecondary)]">
          {t(
            "integrations.nginxProxyMgr.redirections.count",
            "{{count}} redirections",
            { count: mgr.redirectionHosts.length },
          )}
        </span>
        <button
          type="button"
          className={npmBtn}
          disabled={mgr.busy}
          onClick={() => void mgr.loadRedirectionHosts().catch(() => {})}
          data-testid="npm-redirections-refresh"
        >
          {mgr.busy ? (
            <Loader2 className="h-3 w-3 animate-spin" />
          ) : (
            <RefreshCw className="h-3 w-3" />
          )}
          {t("integrations.nginxProxyMgr.refresh", "Refresh")}
        </button>
      </div>
      {mgr.redirectionHosts.length === 0 ? (
        <EmptyRow
          text={t(
            "integrations.nginxProxyMgr.redirections.empty",
            "No redirection hosts",
          )}
        />
      ) : (
        <table className="w-full text-xs">
          <thead className="text-left text-[var(--color-textSecondary)]">
            <tr>
              <th className="py-1">
                {t("integrations.nginxProxyMgr.proxyHosts.domains", "Domains")}
              </th>
              <th className="py-1">
                {t("integrations.nginxProxyMgr.redirections.target", "Target")}
              </th>
              <th className="py-1">
                {t("integrations.nginxProxyMgr.status", "Status")}
              </th>
              <th className="py-1" />
            </tr>
          </thead>
          <tbody>
            {mgr.redirectionHosts.map((h) => {
              const enabled = isEnabled(h.enabled);
              return (
                <tr
                  key={h.id}
                  data-testid="npm-redirection-row"
                  className="border-t border-[var(--color-border)]"
                >
                  <td className="py-1 text-[var(--color-text)]">
                    {h.domain_names.join(", ")}
                  </td>
                  <td className="py-1 text-[var(--color-textSecondary)]">
                    {h.forward_http_code} → {h.forward_scheme}://
                    {h.forward_domain_name}
                  </td>
                  <td className="py-1">
                    <EnabledBadge
                      enabled={enabled}
                      onLabel={t(
                        "integrations.nginxProxyMgr.enabled",
                        "Enabled",
                      )}
                      offLabel={t(
                        "integrations.nginxProxyMgr.disabled",
                        "Disabled",
                      )}
                    />
                  </td>
                  <td className="py-1 text-right">
                    <button
                      type="button"
                      className={npmBtn}
                      disabled={mgr.busy}
                      data-testid="npm-redirection-toggle"
                      onClick={() =>
                        void mgr
                          .toggleRedirectionHost(h.id, !enabled)
                          .catch(() => {})
                      }
                    >
                      <Power className="h-3 w-3" />
                      {enabled
                        ? t("integrations.nginxProxyMgr.disable", "Disable")
                        : t("integrations.nginxProxyMgr.enable", "Enable")}
                    </button>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      )}
    </div>
  );
};

export default NpmRedirectionsTab;
