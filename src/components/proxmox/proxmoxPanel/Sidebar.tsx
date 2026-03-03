import React from "react";
import { useTranslation } from "react-i18next";
import {
  LayoutDashboard,
  Server,
  Monitor,
  Container,
  HardDrive,
  Network,
  ListTodo,
  Archive,
  Shield,
  Boxes,
  HeartPulse,
  Database,
  Camera,
  Terminal,
  Search,
  RefreshCw,
  LogOut,
} from "lucide-react";
import type { SubProps } from "./types";
import type { ProxmoxTab } from "../../../hooks/proxmox/useProxmoxManager";

interface TabDef {
  key: ProxmoxTab;
  icon: React.FC<{ className?: string }>;
  label: string;
}

const TABS: TabDef[] = [
  { key: "dashboard", icon: LayoutDashboard, label: "proxmox.tabs.dashboard" },
  { key: "nodes", icon: Server, label: "proxmox.tabs.nodes" },
  { key: "qemu", icon: Monitor, label: "proxmox.tabs.qemu" },
  { key: "lxc", icon: Container, label: "proxmox.tabs.lxc" },
  { key: "storage", icon: HardDrive, label: "proxmox.tabs.storage" },
  { key: "network", icon: Network, label: "proxmox.tabs.network" },
  { key: "tasks", icon: ListTodo, label: "proxmox.tabs.tasks" },
  { key: "backups", icon: Archive, label: "proxmox.tabs.backups" },
  { key: "firewall", icon: Shield, label: "proxmox.tabs.firewall" },
  { key: "pools", icon: Boxes, label: "proxmox.tabs.pools" },
  { key: "ha", icon: HeartPulse, label: "proxmox.tabs.ha" },
  { key: "ceph", icon: Database, label: "proxmox.tabs.ceph" },
  { key: "snapshots", icon: Camera, label: "proxmox.tabs.snapshots" },
  { key: "console", icon: Terminal, label: "proxmox.tabs.console" },
];

const Sidebar: React.FC<SubProps> = ({ mgr }) => {
  const { t } = useTranslation();

  return (
    <div className="w-52 shrink-0 border-r border-[var(--color-border)] flex flex-col bg-[var(--color-bg-secondary)]">
      {/* Search */}
      <div className="p-3 border-b border-[var(--color-border)]">
        <div className="relative">
          <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-[var(--color-text-secondary)]" />
          <input
            className="w-full pl-8 pr-3 py-1.5 rounded-lg bg-[var(--color-bg)] border border-[var(--color-border)] text-xs text-[var(--color-text)] focus:outline-none focus:ring-1 focus:ring-orange-500/50"
            placeholder={t("proxmox.search", "Search...")}
            value={mgr.searchQuery}
            onChange={(e) => mgr.setSearchQuery(e.target.value)}
          />
        </div>
      </div>

      {/* Node selector */}
      {mgr.nodes.length > 0 && (
        <div className="p-3 border-b border-[var(--color-border)]">
          <label className="block text-[10px] uppercase tracking-wider text-[var(--color-text-secondary)] mb-1 font-medium">
            {t("proxmox.node", "Node")}
          </label>
          <select
            className="w-full px-2 py-1.5 rounded-lg bg-[var(--color-bg)] border border-[var(--color-border)] text-xs text-[var(--color-text)]"
            value={mgr.selectedNode ?? ""}
            onChange={(e) => mgr.selectNode(e.target.value)}
          >
            {mgr.nodes.map((n) => (
              <option key={n.node} value={n.node}>
                {n.node} ({n.status})
              </option>
            ))}
          </select>
        </div>
      )}

      {/* Tabs */}
      <nav className="flex-1 overflow-y-auto py-2">
        {TABS.map(({ key, icon: Icon, label }) => (
          <button
            key={key}
            onClick={() => mgr.switchTab(key)}
            className={`w-full flex items-center gap-2 px-4 py-2 text-xs transition-colors ${
              mgr.activeTab === key
                ? "bg-orange-500/15 text-orange-400 font-medium border-r-2 border-orange-500"
                : "text-[var(--color-text-secondary)] hover:bg-[var(--color-bg-hover)] hover:text-[var(--color-text)]"
            }`}
          >
            <Icon className="w-3.5 h-3.5 shrink-0" />
            <span className="truncate">{t(label, key)}</span>
          </button>
        ))}
      </nav>

      {/* Footer actions */}
      <div className="p-3 border-t border-[var(--color-border)] flex items-center gap-2">
        <button
          onClick={mgr.refreshDashboard}
          disabled={mgr.refreshing}
          className="flex-1 flex items-center justify-center gap-1.5 px-2 py-1.5 rounded-lg bg-[var(--color-bg)] border border-[var(--color-border)] text-xs text-[var(--color-text-secondary)] hover:text-[var(--color-text)] transition-colors"
          title={t("proxmox.refresh", "Refresh")}
        >
          <RefreshCw className={`w-3 h-3 ${mgr.refreshing ? "animate-spin" : ""}`} />
          {t("proxmox.refresh", "Refresh")}
        </button>
        <button
          onClick={mgr.disconnect}
          className="flex items-center justify-center gap-1.5 px-2 py-1.5 rounded-lg bg-red-500/10 border border-red-500/30 text-xs text-red-400 hover:bg-red-500/20 transition-colors"
          title={t("proxmox.disconnect", "Disconnect")}
        >
          <LogOut className="w-3 h-3" />
        </button>
      </div>
    </div>
  );
};

export default Sidebar;
