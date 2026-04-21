import React from "react";
import { useTranslation } from "react-i18next";
import {
  Server,
  Monitor,
  Container,
  HardDrive,
  Cpu,
  MemoryStick,
  Activity,
} from "lucide-react";
import type { SubProps } from "./types";

/** The main dashboard view with cluster-wide summaries. */
const DashboardView: React.FC<SubProps> = ({ mgr }) => {
  const { t } = useTranslation();

  const totalVms = mgr.qemuVms.length;
  const runningVms = mgr.qemuVms.filter((v) => v.status === "running").length;
  const totalCts = mgr.lxcContainers.length;
  const runningCts = mgr.lxcContainers.filter((c) => c.status === "running").length;

  const totalStorage = mgr.storage.reduce((s, st) => s + (st.total ?? 0), 0);
  const usedStorage = mgr.storage.reduce((s, st) => s + (st.used ?? 0), 0);
  const storagePct = totalStorage > 0 ? Math.round((usedStorage / totalStorage) * 100) : 0;

  const formatBytes = (bytes: number) => {
    if (bytes === 0) return "0 B";
    const k = 1024;
    const sizes = ["B", "KB", "MB", "GB", "TB"];
    const i = Math.floor(Math.log(bytes) / Math.log(k));
    return `${(bytes / Math.pow(k, i)).toFixed(1)} ${sizes[i]}`;
  };

  return (
    <div className="p-6 space-y-6 overflow-y-auto flex-1">
      {/* Overview cards */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
        {/* Nodes */}
        <StatCard
          icon={Server}
          iconColor="text-warning"
          iconBg="bg-warning/15"
          label={t("proxmox.dashboard.nodes", "Nodes")}
          value={String(mgr.nodes.length)}
          sub={`${mgr.nodes.filter((n) => n.status === "online").length} online`}
        />
        {/* VMs */}
        <StatCard
          icon={Monitor}
          iconColor="text-primary"
          iconBg="bg-primary/15"
          label={t("proxmox.dashboard.vms", "QEMU VMs")}
          value={`${runningVms}/${totalVms}`}
          sub={t("proxmox.dashboard.running", "running")}
        />
        {/* Containers */}
        <StatCard
          icon={Container}
          iconColor="text-success"
          iconBg="bg-success/15"
          label={t("proxmox.dashboard.containers", "LXC Containers")}
          value={`${runningCts}/${totalCts}`}
          sub={t("proxmox.dashboard.running", "running")}
        />
        {/* Storage */}
        <StatCard
          icon={HardDrive}
          iconColor="text-primary"
          iconBg="bg-primary/15"
          label={t("proxmox.dashboard.storage", "Storage")}
          value={`${storagePct}%`}
          sub={`${formatBytes(usedStorage)} / ${formatBytes(totalStorage)}`}
        />
      </div>

      {/* Node list */}
      <section>
        <h3 className="text-sm font-semibold text-[var(--color-text)] mb-3 flex items-center gap-2">
          <Server className="w-4 h-4 text-warning" />
          {t("proxmox.dashboard.nodeList", "Cluster Nodes")}
        </h3>
        <div className="space-y-2">
          {mgr.nodes.map((node) => (
            <button
              key={node.node}
              onClick={() => mgr.selectNode(node.node)}
              className={`w-full flex items-center gap-3 p-3 rounded-lg border transition-colors text-left ${
                mgr.selectedNode === node.node
                  ? "border-warning/40 bg-warning/10"
                  : "border-[var(--color-border)] bg-[var(--color-surfaceHover)] hover:bg-[var(--color-surfaceHover)]"
              }`}
            >
              <div className={`w-2 h-2 rounded-full ${node.status === "online" ? "bg-success" : "bg-error"}`} />
              <div className="flex-1 min-w-0">
                <div className="text-sm font-medium text-[var(--color-text)] truncate">{node.node}</div>
                <div className="text-[10px] text-[var(--color-textSecondary)]">
                  {t("proxmox.dashboard.uptime", "Uptime")}: {node.uptime ? formatUptime(node.uptime) : "—"}
                </div>
              </div>
              <div className="flex items-center gap-4 text-[10px] text-[var(--color-textSecondary)]">
                <span className="flex items-center gap-1">
                  <Cpu className="w-3 h-3" />
                  {node.cpu != null ? `${(node.cpu * 100).toFixed(1)}%` : "—"}
                </span>
                <span className="flex items-center gap-1">
                  <MemoryStick className="w-3 h-3" />
                  {node.mem != null && node.maxmem ? `${Math.round((node.mem / node.maxmem) * 100)}%` : "—"}
                </span>
              </div>
            </button>
          ))}
          {mgr.nodes.length === 0 && (
            <div className="text-center text-sm text-[var(--color-textSecondary)] py-8">
              {t("proxmox.dashboard.noNodes", "No nodes found")}
            </div>
          )}
        </div>
      </section>

      {/* Recent cluster resources */}
      {mgr.clusterResources.length > 0 && (
        <section>
          <h3 className="text-sm font-semibold text-[var(--color-text)] mb-3 flex items-center gap-2">
            <Activity className="w-4 h-4 text-info" />
            {t("proxmox.dashboard.resources", "Cluster Resources")}
          </h3>
          <div className="overflow-x-auto">
            <table className="w-full text-xs">
              <thead>
                <tr className="text-left text-[var(--color-textSecondary)] border-b border-[var(--color-border)]">
                  <th className="pb-2 pr-3">{t("proxmox.type", "Type")}</th>
                  <th className="pb-2 pr-3">{t("proxmox.id", "ID")}</th>
                  <th className="pb-2 pr-3">{t("proxmox.name", "Name")}</th>
                  <th className="pb-2 pr-3">{t("proxmox.node", "Node")}</th>
                  <th className="pb-2 pr-3">{t("proxmox.status", "Status")}</th>
                </tr>
              </thead>
              <tbody>
                {mgr.clusterResources.slice(0, 20).map((r, i) => (
                  <tr
                    key={`${r.id}-${i}`}
                    className="border-b border-[var(--color-border)]/50 text-[var(--color-text)]"
                  >
                    <td className="py-1.5 pr-3">
                      <span className={`inline-block px-1.5 py-0.5 rounded text-[10px] font-medium ${
                        r.resourceType === "qemu"
                          ? "bg-primary/15 text-primary"
                          : r.resourceType === "lxc"
                          ? "bg-success/15 text-success"
                          : r.resourceType === "storage"
                          ? "bg-primary/15 text-primary"
                          : "bg-text-secondary/15 text-text-muted"
                      }`}>
                        {r.resourceType}
                      </span>
                    </td>
                    <td className="py-1.5 pr-3 font-mono">{r.id}</td>
                    <td className="py-1.5 pr-3">{r.name ?? "—"}</td>
                    <td className="py-1.5 pr-3">{r.node ?? "—"}</td>
                    <td className="py-1.5 pr-3">
                      <span className={`inline-block w-1.5 h-1.5 rounded-full mr-1 ${
                        r.status === "running" ? "bg-success" : "bg-text-secondary"
                      }`} />
                      {r.status ?? "—"}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </section>
      )}
    </div>
  );
};

// ── Helper components ────────────────────────────────────────────

const StatCard: React.FC<{
  icon: React.FC<{ className?: string }>;
  iconColor: string;
  iconBg: string;
  label: string;
  value: string;
  sub: string;
}> = ({ icon: Icon, iconColor, iconBg, label, value, sub }) => (
  <div className="p-4 rounded-xl border border-[var(--color-border)] bg-[var(--color-surfaceHover)]">
    <div className="flex items-center gap-3 mb-2">
      <div className={`w-8 h-8 rounded-lg ${iconBg} flex items-center justify-center`}>
        <Icon className={`w-4 h-4 ${iconColor}`} />
      </div>
      <span className="text-xs text-[var(--color-textSecondary)]">{label}</span>
    </div>
    <div className="text-xl font-bold text-[var(--color-text)]">{value}</div>
    <div className="text-[10px] text-[var(--color-textSecondary)] mt-0.5">{sub}</div>
  </div>
);

function formatUptime(seconds: number): string {
  const d = Math.floor(seconds / 86400);
  const h = Math.floor((seconds % 86400) / 3600);
  const m = Math.floor((seconds % 3600) / 60);
  if (d > 0) return `${d}d ${h}h`;
  if (h > 0) return `${h}h ${m}m`;
  return `${m}m`;
}

export default DashboardView;
