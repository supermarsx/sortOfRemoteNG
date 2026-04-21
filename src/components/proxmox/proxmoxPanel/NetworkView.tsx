import React from "react";
import { useTranslation } from "react-i18next";
import { Network, Wifi, Cable, RefreshCw } from "lucide-react";
import type { SubProps } from "./types";

const NetworkView: React.FC<SubProps> = ({ mgr }) => {
  const { t } = useTranslation();
  const node = mgr.selectedNode;

  if (!node) {
    return (
      <div className="flex-1 flex items-center justify-center text-sm text-[var(--color-textSecondary)]">
        {t("proxmox.selectNode", "Select a node first")}
      </div>
    );
  }

  return (
    <div className="p-6 overflow-y-auto flex-1">
      <div className="flex items-center justify-between mb-4">
        <h3 className="text-sm font-semibold text-[var(--color-text)] flex items-center gap-2">
          <Network className="w-4 h-4 text-teal-500" />
          {t("proxmox.network.title", "Network Interfaces")}
          <span className="text-xs font-normal text-[var(--color-textSecondary)]">
            ({mgr.networkInterfaces.length})
          </span>
        </h3>
        <div className="flex gap-2">
          <button
            onClick={() => mgr.requestConfirm(
              t("proxmox.network.applyTitle", "Apply Changes"),
              t("proxmox.network.applyMsg", "Apply pending network configuration changes?"),
              async () => { /* placeholder — wire to apply */ }
            )}
            className="px-3 py-1.5 rounded-lg bg-teal-600 hover:bg-teal-700 text-[var(--color-text)] text-xs font-medium transition-colors"
          >
            {t("proxmox.network.apply", "Apply")}
          </button>
          <button
            onClick={() => mgr.refreshNetwork(node)}
            className="p-1.5 rounded-lg border border-[var(--color-border)] text-[var(--color-textSecondary)] hover:text-[var(--color-text)] transition-colors"
          >
            <RefreshCw className={`w-3.5 h-3.5 ${mgr.refreshing ? "animate-spin" : ""}`} />
          </button>
        </div>
      </div>

      {mgr.networkInterfaces.length === 0 ? (
        <div className="text-center py-16 text-sm text-[var(--color-textSecondary)]">
          <Network className="w-10 h-10 mx-auto mb-3 opacity-30" />
          {t("proxmox.network.noInterfaces", "No network interfaces found")}
        </div>
      ) : (
        <div className="space-y-2">
          {mgr.networkInterfaces.map((iface) => (
            <div
              key={iface.iface}
              className="flex items-center gap-3 p-3 rounded-lg border border-[var(--color-border)] bg-[var(--color-surfaceHover)]"
            >
              <div className={`w-8 h-8 rounded-lg flex items-center justify-center ${
                iface.interfaceType === "bridge" ? "bg-teal-500/15" :
                iface.interfaceType === "bond" ? "bg-primary/15" :
                "bg-text-secondary/15"
              }`}>
                {iface.interfaceType === "bridge" ? (
                  <Wifi className="w-4 h-4 text-teal-500" />
                ) : (
                  <Cable className="w-4 h-4 text-primary" />
                )}
              </div>
              <div className="flex-1 min-w-0">
                <div className="text-sm font-medium text-[var(--color-text)]">{iface.iface}</div>
                <div className="flex items-center gap-2 text-[10px] text-[var(--color-textSecondary)]">
                  {iface.interfaceType && (
                    <span className="px-1.5 py-0.5 rounded bg-[var(--color-bg)] border border-[var(--color-border)]">
                      {iface.interfaceType}
                    </span>
                  )}
                  {iface.active != null && (
                    <span className={iface.active ? "text-success" : "text-text-muted"}>
                      {iface.active ? "active" : "inactive"}
                    </span>
                  )}
                  {iface.method && <span>({iface.method})</span>}
                </div>
              </div>
              <div className="text-right text-[10px] text-[var(--color-textSecondary)]">
                {iface.address && <div>{iface.address}{iface.netmask ? `/${iface.netmask}` : ""}</div>}
                {iface.cidr && !iface.address && <div>{iface.cidr}</div>}
                {iface.gateway && <div>gw: {iface.gateway}</div>}
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
};

export default NetworkView;
