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
  CircleHelp,
  CircleCheck,
  Clock3,
  ShieldX,
} from "lucide-react";
import type { SubProps } from "./types";
import type { SynologyTab } from "../../../hooks/synology/useSynologyManager";
import { SYNOLOGY_SECTION_LABELS } from "../../../utils/synology/synologySectionLabels";

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
  const access = mgr.sectionAccess;
  const unavailable = TABS.filter(({ key }) =>
    ["denied", "unavailable"].includes(access.entries[key].status),
  );
  const visible = TABS.filter((tab) => !unavailable.includes(tab));

  return (
    <div className="w-36 md:w-48 shrink-0 border-r border-[var(--color-border)] flex flex-col bg-[var(--color-surfaceHover)]">
      {/* Tabs */}
      <nav
        aria-label="NAS sections"
        className="flex-1 overflow-y-auto space-y-1 p-2"
      >
        {visible.map(({ key, icon: Icon, label }) => {
          const entry = access.entries[key];
          const StatusIcon =
            entry.status === "available"
              ? CircleCheck
              : entry.status === "checking"
                ? Clock3
                : CircleHelp;
          return (
            <button
              key={key}
              type="button"
              onClick={() => mgr.changeTab(key)}
              disabled={entry.status === "checking"}
              data-testid={`synology-tab-${key}`}
              data-tooltip={entry.reason}
              aria-label={t(label, SYNOLOGY_SECTION_LABELS[key])}
              aria-description={entry.reason}
              aria-current={mgr.activeTab === key ? "page" : undefined}
              className={`sor-accent-choice w-full flex items-center gap-2 rounded-md px-2 py-2 text-left text-xs disabled:opacity-50 ${mgr.activeTab === key ? "font-medium" : ""}`}
            >
              <Icon className="w-3.5 h-3.5 shrink-0" />
              <span className="min-w-0 flex-1">
                <span className="block truncate">
                  {t(label, SYNOLOGY_SECTION_LABELS[key])}
                </span>
                {entry.status === "unknown" && (
                  <span className="block text-[10px] text-text-muted">
                    Could not verify
                  </span>
                )}
              </span>
              <StatusIcon
                aria-hidden="true"
                className="w-3 h-3 shrink-0 text-text-muted"
              />
              {entry.status === "checking" && (
                <span className="sr-only">Checking access</span>
              )}
            </button>
          );
        })}
        {unavailable.length > 0 && (
          <details className="border-t border-border mt-2 pt-2 text-xs">
            <summary className="cursor-pointer px-2 py-1 text-text-muted">
              Unavailable sections ({unavailable.length})
            </summary>
            <ul className="space-y-3 px-2 py-2">
              {unavailable.map(({ key, label }) => (
                <li key={key}>
                  <span className="flex items-center gap-1 font-medium">
                    <ShieldX className="h-3 w-3 shrink-0" aria-hidden="true" />
                    {t(label, SYNOLOGY_SECTION_LABELS[key])}
                  </span>
                  <p className="mt-1 text-[10px] text-text-muted">
                    {access.entries[key].status === "denied"
                      ? "Access denied. "
                      : "Not available. "}
                    {access.entries[key].reason}
                  </p>
                </li>
              ))}
            </ul>
          </details>
        )}
      </nav>

      <div className="border-t border-border px-3 py-2 space-y-1">
        <button
          type="button"
          className="sor-btn-secondary-sm w-full"
          onClick={access.recheck}
          disabled={access.checking || !access.active}
        >
          Recheck section access
        </button>
        <p className="text-[10px] text-text-muted">
          {access.checking
            ? access.active
              ? "Checking available sections…"
              : "Access checks paused until this tab is visible."
            : "Read access checked. Changes still require NAS permission."}
        </p>
      </div>

      {mgr.lastRefreshed && (
        <p className="px-3 py-1 text-[10px] text-text-muted">
          Last checked {new Date(mgr.lastRefreshed).toLocaleTimeString()}
        </p>
      )}
      {/* Footer actions */}
      <div className="p-3 border-t border-[var(--color-border)] flex items-center gap-2">
        <button
          onClick={() => mgr.loadTabData(mgr.activeTab)}
          disabled={mgr.dataLoading}
          className="flex-1 flex items-center justify-center gap-1.5 px-2 py-1.5 rounded-lg bg-[var(--color-bg)] border border-[var(--color-border)] text-xs text-[var(--color-textSecondary)] hover:text-[var(--color-text)] transition-colors"
          title={t("synology.refresh", "Refresh")}
        >
          <RefreshCw
            className={`w-3 h-3 ${mgr.dataLoading ? "animate-spin" : ""}`}
          />
          {t("synology.refresh", "Refresh")}
        </button>
        <button
          onClick={mgr.disconnect}
          className="flex items-center justify-center p-1.5 rounded-lg bg-[var(--color-bg)] border border-[var(--color-border)] text-xs text-error hover:bg-error/10 transition-colors"
          title={t("synology.disconnect", "Disconnect")}
        >
          <LogOut className="w-3.5 h-3.5" />
        </button>
      </div>
    </div>
  );
};

export default Sidebar;
