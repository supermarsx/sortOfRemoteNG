// Nginx Proxy Manager — Streams (TCP/UDP) tab (t65-e4).

import React, { useEffect } from "react";
import { Loader2, Power, RefreshCw } from "lucide-react";
import { useTranslation } from "react-i18next";
import type { NginxProxyMgrManager } from "../../../hooks/integration/useNginxProxyMgr";
import { EmptyRow, EnabledBadge, isEnabled, npmBtn } from "./shared";

const NpmStreamsTab: React.FC<{ mgr: NginxProxyMgrManager }> = ({ mgr }) => {
  const { t } = useTranslation();

  useEffect(() => {
    if (mgr.isConnected) void mgr.loadStreams().catch(() => {});
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [mgr.isConnected]);

  return (
    <div className="flex flex-col gap-2" data-testid="npm-streams-tab">
      <div className="flex items-center justify-between">
        <span className="text-xs text-[var(--color-textSecondary)]">
          {t("integrations.nginxProxyMgr.streams.count", "{{count}} streams", {
            count: mgr.streams.length,
          })}
        </span>
        <button
          type="button"
          className={npmBtn}
          disabled={mgr.busy}
          onClick={() => void mgr.loadStreams().catch(() => {})}
          data-testid="npm-streams-refresh"
        >
          {mgr.busy ? (
            <Loader2 className="h-3 w-3 animate-spin" />
          ) : (
            <RefreshCw className="h-3 w-3" />
          )}
          {t("integrations.nginxProxyMgr.refresh", "Refresh")}
        </button>
      </div>
      {mgr.streams.length === 0 ? (
        <EmptyRow
          text={t("integrations.nginxProxyMgr.streams.empty", "No streams")}
        />
      ) : (
        <table className="w-full text-xs">
          <thead className="text-left text-[var(--color-textSecondary)]">
            <tr>
              <th className="py-1">
                {t("integrations.nginxProxyMgr.streams.incoming", "Incoming")}
              </th>
              <th className="py-1">
                {t("integrations.nginxProxyMgr.proxyHosts.forward", "Forward")}
              </th>
              <th className="py-1">
                {t("integrations.nginxProxyMgr.streams.protocols", "Protocols")}
              </th>
              <th className="py-1">
                {t("integrations.nginxProxyMgr.status", "Status")}
              </th>
              <th className="py-1" />
            </tr>
          </thead>
          <tbody>
            {mgr.streams.map((s) => {
              const enabled = isEnabled(s.enabled);
              const protocols = [
                isEnabled(s.tcp_forwarding) ? "TCP" : null,
                isEnabled(s.udp_forwarding) ? "UDP" : null,
              ]
                .filter(Boolean)
                .join("/");
              return (
                <tr
                  key={s.id}
                  data-testid="npm-stream-row"
                  className="border-t border-[var(--color-border)]"
                >
                  <td className="py-1 text-[var(--color-text)]">
                    :{s.incoming_port}
                  </td>
                  <td className="py-1 text-[var(--color-textSecondary)]">
                    {s.forwarding_host}:{s.forwarding_port}
                  </td>
                  <td className="py-1 text-[var(--color-textSecondary)]">
                    {protocols || "—"}
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
                      data-testid="npm-stream-toggle"
                      onClick={() =>
                        void mgr.toggleStream(s.id, !enabled).catch(() => {})
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

export default NpmStreamsTab;
