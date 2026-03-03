import React from "react";
import { useTranslation } from "react-i18next";
import { HardDrive, Download, Trash2, RefreshCw } from "lucide-react";
import type { SubProps } from "./types";

const StorageView: React.FC<SubProps> = ({ mgr }) => {
  const { t } = useTranslation();
  const node = mgr.selectedNode;

  if (!node) {
    return (
      <div className="flex-1 flex items-center justify-center text-sm text-[var(--color-text-secondary)]">
        {t("proxmox.selectNode", "Select a node first")}
      </div>
    );
  }

  const formatBytes = (bytes: number) => {
    if (!bytes) return "—";
    const sizes = ["B", "KB", "MB", "GB", "TB"];
    const i = Math.floor(Math.log(bytes) / Math.log(1024));
    return `${(bytes / Math.pow(1024, i)).toFixed(1)} ${sizes[i]}`;
  };

  return (
    <div className="p-6 overflow-y-auto flex-1">
      <div className="flex items-center justify-between mb-4">
        <h3 className="text-sm font-semibold text-[var(--color-text)] flex items-center gap-2">
          <HardDrive className="w-4 h-4 text-purple-500" />
          {t("proxmox.storage.title", "Storage")}
          <span className="text-xs font-normal text-[var(--color-text-secondary)]">
            ({mgr.storage.length})
          </span>
        </h3>
        <button
          onClick={() => mgr.refreshStorage(node)}
          className="p-1.5 rounded-lg border border-[var(--color-border)] text-[var(--color-text-secondary)] hover:text-[var(--color-text)] transition-colors"
        >
          <RefreshCw className={`w-3.5 h-3.5 ${mgr.refreshing ? "animate-spin" : ""}`} />
        </button>
      </div>

      {mgr.storage.length === 0 ? (
        <div className="text-center py-16 text-sm text-[var(--color-text-secondary)]">
          <HardDrive className="w-10 h-10 mx-auto mb-3 opacity-30" />
          {t("proxmox.storage.noStorage", "No storage found")}
        </div>
      ) : (
        <div className="space-y-3">
          {mgr.storage.map((s) => {
            const pct = s.total && s.total > 0 ? (s.used ?? 0) / s.total * 100 : 0;
            return (
              <div
                key={s.storage}
                className="rounded-lg border border-[var(--color-border)] bg-[var(--color-bg-secondary)] p-4"
              >
                <div className="flex items-center justify-between mb-2">
                  <div>
                    <div className="text-sm font-medium text-[var(--color-text)]">{s.storage}</div>
                    <div className="flex items-center gap-2 text-[10px] text-[var(--color-text-secondary)]">
                      <span className={`px-1.5 py-0.5 rounded ${
                        s.active ? "bg-green-500/15 text-green-400" : "bg-gray-500/15 text-gray-400"
                      }`}>
                        {s.active ? "active" : "inactive"}
                      </span>
                      {s.storageType && <span>{s.storageType}</span>}
                      {s.content && <span>({s.content})</span>}
                    </div>
                  </div>
                  <div className="text-right text-[10px] text-[var(--color-text-secondary)]">
                    {s.used != null && <div>{formatBytes(s.used)} used</div>}
                    {s.total != null && <div>{formatBytes(s.total)} total</div>}
                  </div>
                </div>
                {s.total != null && s.total > 0 && (
                  <div className="h-1.5 rounded-full bg-[var(--color-border)]">
                    <div
                      className={`h-full rounded-full transition-all ${
                        pct > 90 ? "bg-red-500" : pct > 70 ? "bg-yellow-500" : "bg-purple-500"
                      }`}
                      style={{ width: `${Math.min(100, pct)}%` }}
                    />
                  </div>
                )}
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
};

export default StorageView;
