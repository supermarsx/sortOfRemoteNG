import React from "react";
import { useTranslation } from "react-i18next";
import { Server, AlertCircle, Search } from "lucide-react";
import { useServerStats } from "../../hooks/ssh/useServerStats";
import Modal from "../ui/overlays/Modal";
import DialogHeader from "../ui/overlays/DialogHeader";
import EmptyState from "../ui/display/EmptyState";
import type { ServerStatsPanelProps } from "./serverStats/types";
import { StatsToolbar } from "./serverStats/StatsToolbar";
import { OverviewTab } from "./serverStats/OverviewTab";
import { DetailTabs } from "./serverStats/DetailTabs";

export const ServerStatsPanel: React.FC<ServerStatsPanelProps> = ({
  isOpen,
  onClose,
}) => {
  const { t } = useTranslation();
  const mgr = useServerStats(isOpen);

  if (!isOpen) return null;

  return (
    <Modal
      isOpen={isOpen}
      onClose={onClose}
      backdropClassName="bg-black/50"
      panelClassName="max-w-6xl mx-4 h-[90vh]"
      contentClassName="overflow-hidden"
      dataTestId="server-stats-panel-modal"
    >
      {/* Background glow effects */}
      <div className="absolute inset-0 overflow-hidden pointer-events-none dark:opacity-100 opacity-0">
        <div className="absolute top-[15%] left-[10%] w-96 h-96 bg-info/8 rounded-full blur-3xl" />
        <div className="absolute bottom-[20%] right-[15%] w-80 h-80 bg-primary/6 rounded-full blur-3xl" />
        <div className="absolute top-[50%] right-[25%] w-64 h-64 bg-teal-500/5 rounded-full blur-3xl" />
      </div>

      <div className="bg-[var(--color-surface)] rounded-xl shadow-xl w-full max-w-6xl mx-4 h-[90vh] overflow-hidden flex flex-col border border-[var(--color-border)] relative z-10">
        {/* Header */}
        <DialogHeader
          icon={Server}
          iconColor="text-info dark:text-info"
          iconBg="bg-info/20"
          title={t("serverStats.title", "Server Stats")}
          badge={
            mgr.lastSnapshot
              ? `${mgr.lastSnapshot.connectionName} · ${t("serverStats.collected", "collected")} ${new Date(mgr.lastSnapshot.collectedAt).toLocaleTimeString()}`
              : undefined
          }
          onClose={onClose}
          sticky
        />

        {/* Toolbar */}
        <StatsToolbar mgr={mgr} />

        {/* Search bar (only for firewall/ports tabs) */}
        {(mgr.activeTab === "firewall" || mgr.activeTab === "ports") && (
          <div className="px-4 py-2 border-b border-[var(--color-border)]">
            <div className="flex items-center gap-2 text-xs">
              <Search size={12} className="text-[var(--color-text-secondary)]" />
              <input
                type="text"
                className="flex-1 px-2 py-1 rounded border border-[var(--color-border)] bg-[var(--color-surface)] text-[var(--color-text)] text-xs"
                placeholder={t("serverStats.filterPlaceholder", "Filter rules / ports…")}
                value={mgr.searchFilter}
                onChange={(e) => mgr.setSearchFilter(e.target.value)}
              />
            </div>
          </div>
        )}

        {/* Content area */}
        <div className="flex-1 overflow-y-auto p-4">
          {/* Error banner */}
          {mgr.error && (
            <div className="mb-4 flex items-start gap-2 p-3 rounded-lg bg-error/10 border border-error/30 text-xs text-error">
              <AlertCircle size={14} className="flex-shrink-0 mt-0.5" />
              <span>{mgr.error}</span>
            </div>
          )}

          {/* Warnings */}
          {mgr.lastSnapshot && mgr.lastSnapshot.warnings.length > 0 && (
            <div className="mb-4 flex items-start gap-2 p-3 rounded-lg bg-warning/10 border border-warning/30 text-xs text-warning">
              <AlertCircle size={14} className="flex-shrink-0 mt-0.5" />
              <div>
                {mgr.lastSnapshot.warnings.map((w, i) => (
                  <div key={i}>{w}</div>
                ))}
              </div>
            </div>
          )}

          {/* Raw output view */}
          {mgr.showRawOutput && mgr.rawOutput && (
            <div className="mb-4">
              <pre className="p-3 text-xs bg-black/20 rounded-lg overflow-auto max-h-80 text-[var(--color-text-secondary)] font-mono whitespace-pre-wrap border border-[var(--color-border)]">
                {mgr.rawOutput}
              </pre>
            </div>
          )}

          {/* Stats display */}
          {mgr.lastSnapshot ? (
            mgr.activeTab === "overview" ? (
              <OverviewTab snapshot={mgr.lastSnapshot} />
            ) : (
              <DetailTabs
                snapshot={mgr.lastSnapshot}
                activeTab={mgr.activeTab}
                searchFilter={mgr.searchFilter}
              />
            )
          ) : (
            <EmptyState
              icon={Server}
              message={t("serverStats.noData", "No stats collected yet")}
              hint={
                mgr.sshSessions.length === 0
                  ? t(
                      "serverStats.noSessionsDesc",
                      "Connect to an SSH server first, then collect server stats.",
                    )
                  : t(
                      "serverStats.selectAndCollect",
                      "Select an SSH session and click Collect to gather server statistics.",
                    )
              }
            />
          )}

          {/* Collection duration */}
          {mgr.lastSnapshot && (
            <div className="mt-4 text-xs text-[var(--color-text-secondary)] text-right">
              {t("serverStats.collectionTime", "Collected in")} {mgr.lastSnapshot.collectionDurationMs}ms
              {mgr.autoRefreshInterval > 0 && (
                <span className="ml-2">
                  · {t("serverStats.autoRefreshing", "Auto-refreshing every")} {mgr.autoRefreshInterval}s
                </span>
              )}
            </div>
          )}
        </div>
      </div>
    </Modal>
  );
};
