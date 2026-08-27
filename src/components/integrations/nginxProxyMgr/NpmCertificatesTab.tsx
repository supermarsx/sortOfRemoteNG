// Nginx Proxy Manager — Certificates tab (t65-e4).

import React, { useEffect } from "react";
import { Loader2, RefreshCw, ShieldCheck } from "lucide-react";
import { useTranslation } from "react-i18next";
import type { NginxProxyMgrManager } from "../../../hooks/integration/useNginxProxyMgr";
import { EmptyRow, npmBtn } from "./shared";

const NpmCertificatesTab: React.FC<{ mgr: NginxProxyMgrManager }> = ({
  mgr,
}) => {
  const { t } = useTranslation();

  useEffect(() => {
    if (mgr.isConnected) void mgr.loadCertificates().catch(() => {});
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [mgr.isConnected]);

  return (
    <div className="flex flex-col gap-2" data-testid="npm-certificates-tab">
      <div className="flex items-center justify-between">
        <span className="text-xs text-[var(--color-textSecondary)]">
          {t(
            "integrations.nginxProxyMgr.certificates.count",
            "{{count}} certificates",
            { count: mgr.certificates.length },
          )}
        </span>
        <button
          type="button"
          className={npmBtn}
          disabled={mgr.busy}
          onClick={() => void mgr.loadCertificates().catch(() => {})}
          data-testid="npm-certificates-refresh"
        >
          {mgr.busy ? (
            <Loader2 className="h-3 w-3 animate-spin" />
          ) : (
            <RefreshCw className="h-3 w-3" />
          )}
          {t("integrations.nginxProxyMgr.refresh", "Refresh")}
        </button>
      </div>
      {mgr.certificates.length === 0 ? (
        <EmptyRow
          text={t(
            "integrations.nginxProxyMgr.certificates.empty",
            "No certificates",
          )}
        />
      ) : (
        <table className="w-full text-xs">
          <thead className="text-left text-[var(--color-textSecondary)]">
            <tr>
              <th className="py-1">
                {t("integrations.nginxProxyMgr.certificates.name", "Name")}
              </th>
              <th className="py-1">
                {t("integrations.nginxProxyMgr.proxyHosts.domains", "Domains")}
              </th>
              <th className="py-1">
                {t(
                  "integrations.nginxProxyMgr.certificates.provider",
                  "Provider",
                )}
              </th>
              <th className="py-1">
                {t(
                  "integrations.nginxProxyMgr.certificates.expires",
                  "Expires",
                )}
              </th>
              <th className="py-1" />
            </tr>
          </thead>
          <tbody>
            {mgr.certificates.map((c) => (
              <tr
                key={c.id}
                data-testid="npm-certificate-row"
                className="border-t border-[var(--color-border)]"
              >
                <td className="py-1 text-[var(--color-text)]">{c.nice_name}</td>
                <td className="py-1 text-[var(--color-textSecondary)]">
                  {c.domain_names.join(", ")}
                </td>
                <td className="py-1 text-[var(--color-textSecondary)]">
                  {c.provider}
                </td>
                <td className="py-1 text-[var(--color-textSecondary)]">
                  {c.expires_on ?? "—"}
                </td>
                <td className="py-1 text-right">
                  {c.provider === "letsencrypt" && (
                    <button
                      type="button"
                      className={npmBtn}
                      disabled={mgr.busy}
                      data-testid="npm-certificate-renew"
                      onClick={() =>
                        void mgr.renewCertificate(c.id).catch(() => {})
                      }
                    >
                      <ShieldCheck className="h-3 w-3" />
                      {t(
                        "integrations.nginxProxyMgr.certificates.renew",
                        "Renew",
                      )}
                    </button>
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </div>
  );
};

export default NpmCertificatesTab;
