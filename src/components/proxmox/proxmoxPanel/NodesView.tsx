import React from "react";
import { useTranslation } from "react-i18next";
import { Server, Cpu, MemoryStick, HardDrive, Terminal, RotateCcw, Power } from "lucide-react";
import type { SubProps } from "./types";

const NodesView: React.FC<SubProps> = ({ mgr }) => {
  const { t } = useTranslation();

  const formatBytes = (bytes: number) => {
    if (!bytes) return "—";
    const gb = bytes / (1024 * 1024 * 1024);
    return gb >= 1 ? `${gb.toFixed(1)} GB` : `${(bytes / (1024 * 1024)).toFixed(0)} MB`;
  };

  return (
    <div className="p-6 overflow-y-auto flex-1">
      <h3 className="text-sm font-semibold text-[var(--color-text)] mb-4 flex items-center gap-2">
        <Server className="w-4 h-4 text-warning" />
        {t("proxmox.nodes.title", "Cluster Nodes")}
        <span className="text-xs font-normal text-[var(--color-text-secondary)]">
          ({mgr.nodes.length})
        </span>
      </h3>

      {mgr.nodes.length === 0 ? (
        <div className="text-center py-16 text-sm text-[var(--color-text-secondary)]">
          {t("proxmox.nodes.noNodes", "No nodes found")}
        </div>
      ) : (
        <div className="grid gap-4 grid-cols-1 lg:grid-cols-2">
          {mgr.nodes.map((node) => (
            <div
              key={node.node}
              className={`rounded-xl border p-4 transition-colors ${
                mgr.selectedNode === node.node
                  ? "border-warning/40 bg-warning/5"
                  : "border-[var(--color-border)] bg-[var(--color-bg-secondary)]"
              }`}
            >
              <div className="flex items-center justify-between mb-3">
                <div className="flex items-center gap-2">
                  <div className={`w-2.5 h-2.5 rounded-full ${node.status === "online" ? "bg-success" : "bg-error"}`} />
                  <span className="text-sm font-semibold text-[var(--color-text)]">{node.node}</span>
                  <span className={`text-[10px] px-1.5 py-0.5 rounded ${
                    node.status === "online" ? "bg-success/15 text-success" : "bg-error/15 text-error"
                  }`}>
                    {node.status}
                  </span>
                </div>
                <div className="flex gap-1.5">
                  <button
                    onClick={() => mgr.openNodeConsole(node.node)}
                    className="p-1.5 rounded-lg border border-[var(--color-border)] text-[var(--color-text-secondary)] hover:text-info hover:bg-info/10 transition-colors"
                    title={t("proxmox.nodes.console", "Node Console")}
                  >
                    <Terminal className="w-3.5 h-3.5" />
                  </button>
                  <button
                    onClick={() => mgr.requestConfirm(
                      t("proxmox.nodes.rebootTitle", "Reboot Node"),
                      t("proxmox.nodes.rebootMsg", `Reboot node ${node.node}?`),
                      async () => {
                        await mgr.refreshDashboard(); // Placeholder — the actual reboot is via invoke in mgr
                      },
                    )}
                    className="p-1.5 rounded-lg border border-[var(--color-border)] text-[var(--color-text-secondary)] hover:text-warning hover:bg-warning/10 transition-colors"
                    title={t("proxmox.nodes.reboot", "Reboot")}
                  >
                    <RotateCcw className="w-3.5 h-3.5" />
                  </button>
                  <button
                    onClick={() => mgr.requestConfirm(
                      t("proxmox.nodes.shutdownTitle", "Shutdown Node"),
                      t("proxmox.nodes.shutdownMsg", `Shutdown node ${node.node}? This will stop all guests.`),
                      async () => {
                        await mgr.refreshDashboard();
                      },
                    )}
                    className="p-1.5 rounded-lg border border-[var(--color-border)] text-[var(--color-text-secondary)] hover:text-error hover:bg-error/10 transition-colors"
                    title={t("proxmox.nodes.shutdown", "Shutdown")}
                  >
                    <Power className="w-3.5 h-3.5" />
                  </button>
                </div>
              </div>

              {/* Resource bars */}
              <div className="space-y-2">
                {node.cpu != null && (
                  <ResourceBar
                    icon={Cpu}
                    label={t("proxmox.nodes.cpu", "CPU")}
                    pct={node.cpu * 100}
                    detail={`${(node.cpu * 100).toFixed(1)}%`}
                    color="bg-primary"
                  />
                )}
                {node.mem != null && node.maxmem != null && node.maxmem > 0 && (
                  <ResourceBar
                    icon={MemoryStick}
                    label={t("proxmox.nodes.memory", "Memory")}
                    pct={(node.mem / node.maxmem) * 100}
                    detail={`${formatBytes(node.mem)} / ${formatBytes(node.maxmem)}`}
                    color="bg-success"
                  />
                )}
                {node.disk != null && node.maxdisk != null && node.maxdisk > 0 && (
                  <ResourceBar
                    icon={HardDrive}
                    label={t("proxmox.nodes.disk", "Disk")}
                    pct={(node.disk / node.maxdisk) * 100}
                    detail={`${formatBytes(node.disk)} / ${formatBytes(node.maxdisk)}`}
                    color="bg-accent"
                  />
                )}
              </div>

              {/* Uptime */}
              {node.uptime != null && (
                <div className="mt-3 text-[10px] text-[var(--color-text-secondary)]">
                  {t("proxmox.nodes.uptime", "Uptime")}: {formatUptime(node.uptime)}
                </div>
              )}
            </div>
          ))}
        </div>
      )}
    </div>
  );
};

const ResourceBar: React.FC<{
  icon: React.FC<{ className?: string }>;
  label: string;
  pct: number;
  detail: string;
  color: string;
}> = ({ icon: Icon, label, pct, detail, color }) => (
  <div>
    <div className="flex items-center justify-between text-[10px] mb-1">
      <span className="flex items-center gap-1 text-[var(--color-text-secondary)]">
        <Icon className="w-3 h-3" /> {label}
      </span>
      <span className="text-[var(--color-text)]">{detail}</span>
    </div>
    <div className="h-1.5 rounded-full bg-[var(--color-border)]">
      <div
        className={`h-full rounded-full ${color} transition-all`}
        style={{ width: `${Math.min(100, pct)}%` }}
      />
    </div>
  </div>
);

function formatUptime(seconds: number): string {
  const d = Math.floor(seconds / 86400);
  const h = Math.floor((seconds % 86400) / 3600);
  const m = Math.floor((seconds % 3600) / 60);
  if (d > 0) return `${d}d ${h}h ${m}m`;
  if (h > 0) return `${h}h ${m}m`;
  return `${m}m`;
}

export default NodesView;
