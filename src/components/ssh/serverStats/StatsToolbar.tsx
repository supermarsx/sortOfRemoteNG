import React from "react";
import { useTranslation } from "react-i18next";
import {
  RefreshCw,
  Cpu,
  MemoryStick,
  HardDrive,
  Info,
  Shield,
  Network,
  LayoutDashboard,
  Code,
} from "lucide-react";
import { Select } from "../../ui/forms";
import type { Mgr } from "./types";

interface StatsToolbarProps {
  mgr: Mgr;
}

type StatsTab = Mgr["activeTab"];

const tabItems = [
  { key: "overview" as const, icon: LayoutDashboard, label: "serverStats.overview" },
  { key: "cpu" as const, icon: Cpu, label: "serverStats.cpu" },
  { key: "memory" as const, icon: MemoryStick, label: "serverStats.memory" },
  { key: "disk" as const, icon: HardDrive, label: "serverStats.disk" },
  { key: "system" as const, icon: Info, label: "serverStats.system" },
  { key: "firewall" as const, icon: Shield, label: "serverStats.firewall" },
  { key: "ports" as const, icon: Network, label: "serverStats.ports" },
] as const;

export const StatsToolbar: React.FC<StatsToolbarProps> = ({ mgr }) => {
  const { t } = useTranslation();

  const selectTab = (tab: StatsTab, focus = false) => {
    mgr.setActiveTab(tab);
    if (focus) {
      requestAnimationFrame(() => {
        document.getElementById(`server-stats-tab-${tab}`)?.focus();
      });
    }
  };

  const handleTabKeyDown = (
    event: React.KeyboardEvent<HTMLButtonElement>,
    tab: StatsTab,
  ) => {
    const currentIndex = tabItems.findIndex((item) => item.key === tab);
    if (currentIndex < 0) return;

    switch (event.key) {
      case "ArrowRight":
      case "ArrowDown":
        event.preventDefault();
        selectTab(tabItems[(currentIndex + 1) % tabItems.length].key, true);
        break;
      case "ArrowLeft":
      case "ArrowUp":
        event.preventDefault();
        selectTab(tabItems[(currentIndex - 1 + tabItems.length) % tabItems.length].key, true);
        break;
      case "Home":
        event.preventDefault();
        selectTab(tabItems[0].key, true);
        break;
      case "End":
        event.preventDefault();
        selectTab(tabItems[tabItems.length - 1].key, true);
        break;
      default:
        break;
    }
  };

  return (
    <div className="border-b border-[var(--color-border)] px-4 py-3 flex flex-col gap-3">
      <div className="flex flex-wrap items-center gap-2">
        {/* Session selector */}
        <Select
          value={mgr.selectedSessionId ?? ""}
          onChange={(v) => mgr.setSelectedSessionId(v || null)}
          variant="form-sm"
          className="min-w-[180px]"
          placeholder={mgr.sshSessions.length === 0
            ? t("serverStats.noSessions", "No SSH sessions")
            : t("serverStats.selectSession", "Select SSH session")}
          options={[
            { value: '', label: mgr.sshSessions.length === 0 ? t("serverStats.noSessions", "No SSH sessions") : t("serverStats.selectSession", "Select SSH session") },
            ...mgr.sshSessions.map((s) => ({ value: s.id, label: s.name || s.hostname || s.id })),
          ]}
        />

        {/* Collect button */}
        <button
          className="sor-btn sor-btn-primary sor-btn-xs"
          onClick={() => mgr.collectStats()}
          disabled={mgr.isCollecting || !mgr.selectedSessionId}
          title={t("serverStats.collect", "Collect stats")}
        >
          <RefreshCw size={12} className={mgr.isCollecting ? "animate-spin" : ""} />
          {mgr.isCollecting
            ? t("serverStats.collecting", "Collecting…")
            : t("serverStats.collect", "Collect")}
        </button>

        {/* Auto-refresh dropdown */}
        <Select
          value={String(mgr.autoRefreshInterval)}
          onChange={(v) => mgr.setAutoRefreshInterval(Number(v))}
          variant="form-sm"
          options={mgr.refreshIntervals.map((r) => ({
            value: String(r.value),
            label: r.value === 0 ? t("serverStats.autoRefreshOff", "Auto: Off") : `Auto: ${r.label}`,
          }))}
        />

        <div className="flex-1" />

        <button
          className={`sor-btn sor-btn-xs ${mgr.showRawOutput ? "sor-btn-primary" : "sor-btn-secondary"}`}
          onClick={() => mgr.setShowRawOutput(!mgr.showRawOutput)}
          aria-pressed={mgr.showRawOutput}
          title={t("serverStats.rawOutput", "Raw output")}
        >
          <Code size={12} />
          <span className="hidden sm:inline">{t("serverStats.rawOutput", "Raw")}</span>
        </button>
      </div>

      <div className="w-full overflow-x-auto">
        <div
          className="flex w-full min-w-max space-x-1 bg-[var(--color-border)] rounded-lg p-1"
          role="tablist"
          aria-label={t("serverStats.tabs", "Server stats tabs")}
        >
          {tabItems.map(({ key, icon: Icon, label }) => {
            const isActive = mgr.activeTab === key;
            return (
              <button
                id={`server-stats-tab-${key}`}
                key={key}
                type="button"
                role="tab"
                aria-selected={isActive}
                aria-controls={`server-stats-panel-${key}`}
                tabIndex={isActive ? 0 : -1}
                className={`flex-1 min-w-[112px] py-2 px-3 rounded-md text-sm font-medium transition-colors flex items-center justify-center gap-2 whitespace-nowrap ${
                  isActive
                    ? "bg-primary text-[var(--color-text)]"
                    : "text-[var(--color-textSecondary)] hover:text-[var(--color-text)]"
                }`}
                onClick={() => selectTab(key)}
                onKeyDown={(event) => handleTabKeyDown(event, key)}
                title={t(label, key)}
              >
                <Icon size={16} />
                {t(label, key)}
              </button>
            );
          })}
        </div>
      </div>
    </div>
  );
};
