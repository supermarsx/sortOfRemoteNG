import React from "react";
import { useTranslation } from "react-i18next";
import {
  LayoutDashboard,
  Server,
  Power,
  Thermometer,
  Cpu,
  HardDrive,
  Network,
  Package,
  ClipboardList,
  Disc,
  Monitor,
  FileText,
  Users,
  Settings,
  ShieldCheck,
  HeartPulse,
  Activity,
  Terminal,
  Search,
  RefreshCw,
  LogOut,
} from "lucide-react";
import type { SubProps } from "./types";
import type { IdracTab } from "../../../hooks/idrac/useIdracManager";

interface TabDef {
  key: IdracTab;
  icon: React.FC<{ className?: string }>;
  label: string;
}

const TABS: TabDef[] = [
  { key: "dashboard", icon: LayoutDashboard, label: "idrac.tabs.dashboard" },
  { key: "system", icon: Server, label: "idrac.tabs.system" },
  { key: "power", icon: Power, label: "idrac.tabs.power" },
  { key: "thermal", icon: Thermometer, label: "idrac.tabs.thermal" },
  { key: "hardware", icon: Cpu, label: "idrac.tabs.hardware" },
  { key: "storage", icon: HardDrive, label: "idrac.tabs.storage" },
  { key: "network", icon: Network, label: "idrac.tabs.network" },
  { key: "firmware", icon: Package, label: "idrac.tabs.firmware" },
  { key: "lifecycle", icon: ClipboardList, label: "idrac.tabs.lifecycle" },
  { key: "virtual-media", icon: Disc, label: "idrac.tabs.virtualMedia" },
  { key: "console", icon: Monitor, label: "idrac.tabs.console" },
  { key: "event-log", icon: FileText, label: "idrac.tabs.eventLog" },
  { key: "users", icon: Users, label: "idrac.tabs.users" },
  { key: "bios", icon: Settings, label: "idrac.tabs.bios" },
  { key: "certificates", icon: ShieldCheck, label: "idrac.tabs.certificates" },
  { key: "health", icon: HeartPulse, label: "idrac.tabs.health" },
  { key: "telemetry", icon: Activity, label: "idrac.tabs.telemetry" },
  { key: "racadm", icon: Terminal, label: "idrac.tabs.racadm" },
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
            placeholder={t("idrac.search", "Search...")}
            value={mgr.searchQuery}
            onChange={(e) => mgr.setSearchQuery(e.target.value)}
          />
        </div>
      </div>

      {/* Tabs */}
      <div className="flex-1 overflow-y-auto py-1">
        {TABS.filter(
          (tab) =>
            !mgr.searchQuery ||
            t(tab.label, tab.key)
              .toLowerCase()
              .includes(mgr.searchQuery.toLowerCase())
        ).map((tab) => {
          const Icon = tab.icon;
          const isActive = mgr.activeTab === tab.key;
          return (
            <button
              key={tab.key}
              onClick={() => mgr.changeTab(tab.key)}
              className={`w-full flex items-center gap-2.5 px-4 py-2 text-xs transition-colors ${
                isActive
                  ? "bg-orange-500/10 text-orange-400 border-r-2 border-orange-400"
                  : "text-[var(--color-text-secondary)] hover:bg-[var(--color-bg)] hover:text-[var(--color-text)]"
              }`}
            >
              <Icon className="w-3.5 h-3.5 shrink-0" />
              <span className="truncate">{t(tab.label, tab.key)}</span>
            </button>
          );
        })}
      </div>

      {/* Bottom actions */}
      <div className="p-3 border-t border-[var(--color-border)] space-y-1">
        <button
          onClick={() => mgr.refresh()}
          disabled={mgr.refreshing}
          className="w-full flex items-center gap-2 px-3 py-1.5 rounded-lg text-[10px] text-[var(--color-text-secondary)] hover:bg-[var(--color-bg)] hover:text-[var(--color-text)] transition-colors disabled:opacity-50"
        >
          <RefreshCw
            className={`w-3 h-3 ${mgr.refreshing ? "animate-spin" : ""}`}
          />
          {t("idrac.refresh", "Refresh")}
        </button>
        <button
          onClick={() => mgr.disconnect()}
          className="w-full flex items-center gap-2 px-3 py-1.5 rounded-lg text-[10px] text-[var(--color-text-secondary)] hover:bg-[var(--color-bg)] hover:text-red-400 transition-colors"
        >
          <LogOut className="w-3 h-3" />
          {t("idrac.disconnect", "Disconnect")}
        </button>
      </div>
    </div>
  );
};

export default Sidebar;
