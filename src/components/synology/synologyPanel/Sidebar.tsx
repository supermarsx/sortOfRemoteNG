import React from "react";
import { useTranslation } from "react-i18next";
import {
  LayoutDashboard,
  Server,
  HardDrive,
  FolderOpen,
  Share2,
  Network,
  Users,
  Package,
  Settings2,
  Container,
  Monitor,
  Download,
  Camera,
  Archive,
  Shield,
  Cpu,
  ScrollText,
  Bell,
  RefreshCw,
  LogOut,
} from "lucide-react";
import type { SubProps } from "./types";
import type { SynologyTab } from "../../../hooks/synology/useSynologyManager";

interface TabDef {
  key: SynologyTab;
  icon: React.FC<{ className?: string }>;
  label: string;
}

const TABS: TabDef[] = [
  { key: "dashboard", icon: LayoutDashboard, label: "synology.tabs.dashboard" },
  { key: "system", icon: Server, label: "synology.tabs.system" },
  { key: "storage", icon: HardDrive, label: "synology.tabs.storage" },
  { key: "fileStation", icon: FolderOpen, label: "synology.tabs.fileStation" },
  { key: "shares", icon: Share2, label: "synology.tabs.shares" },
  { key: "network", icon: Network, label: "synology.tabs.network" },
  { key: "users", icon: Users, label: "synology.tabs.users" },
  { key: "packages", icon: Package, label: "synology.tabs.packages" },
  { key: "services", icon: Settings2, label: "synology.tabs.services" },
  { key: "docker", icon: Container, label: "synology.tabs.docker" },
  { key: "vms", icon: Monitor, label: "synology.tabs.vms" },
  { key: "downloads", icon: Download, label: "synology.tabs.downloads" },
  { key: "surveillance", icon: Camera, label: "synology.tabs.surveillance" },
  { key: "backup", icon: Archive, label: "synology.tabs.backup" },
  { key: "security", icon: Shield, label: "synology.tabs.security" },
  { key: "hardware", icon: Cpu, label: "synology.tabs.hardware" },
  { key: "logs", icon: ScrollText, label: "synology.tabs.logs" },
  { key: "notifications", icon: Bell, label: "synology.tabs.notifications" },
];

const Sidebar: React.FC<SubProps> = ({ mgr }) => {
  const { t } = useTranslation();

  return (
    <div className="w-48 shrink-0 border-r border-[var(--color-border)] flex flex-col bg-[var(--color-bg-secondary)]">
      {/* Tabs */}
      <nav className="flex-1 overflow-y-auto py-2">
        {TABS.map(({ key, icon: Icon, label }) => (
          <button
            key={key}
            onClick={() => mgr.changeTab(key)}
            className={`w-full flex items-center gap-2 px-4 py-2 text-xs transition-colors ${
              mgr.activeTab === key
                ? "bg-teal-500/15 text-teal-400 font-medium border-r-2 border-teal-500"
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
          onClick={() => mgr.loadTabData(mgr.activeTab)}
          disabled={mgr.dataLoading}
          className="flex-1 flex items-center justify-center gap-1.5 px-2 py-1.5 rounded-lg bg-[var(--color-bg)] border border-[var(--color-border)] text-xs text-[var(--color-text-secondary)] hover:text-[var(--color-text)] transition-colors"
          title={t("synology.refresh", "Refresh")}
        >
          <RefreshCw
            className={`w-3 h-3 ${mgr.dataLoading ? "animate-spin" : ""}`}
          />
          {t("synology.refresh", "Refresh")}
        </button>
        <button
          onClick={mgr.disconnect}
          className="flex items-center justify-center p-1.5 rounded-lg bg-[var(--color-bg)] border border-[var(--color-border)] text-xs text-red-400 hover:bg-red-500/10 transition-colors"
          title={t("synology.disconnect", "Disconnect")}
        >
          <LogOut className="w-3.5 h-3.5" />
        </button>
      </div>
    </div>
  );
};

export default Sidebar;
