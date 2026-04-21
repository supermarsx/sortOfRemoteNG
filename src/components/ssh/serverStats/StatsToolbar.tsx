import React from "react";
import { useTranslation } from "react-i18next";
import {
  Server,
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

  return (
    <div className="border-b border-[var(--color-border)] px-4 py-2 flex flex-wrap items-center gap-2">
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

      {/* Spacer */}
      <div className="flex-1" />

      {/* Tab navigation */}
      <div className="flex items-center gap-1">
        {tabItems.map(({ key, icon: Icon, label }) => (
          <button
            key={key}
            className={`sor-tab-trigger flex items-center gap-1 ${mgr.activeTab === key ? "sor-tab-trigger-active" : ""}`}
            onClick={() => mgr.setActiveTab(key)}
            title={t(label, key)}
          >
            <Icon size={12} />
            <span className="hidden sm:inline">{t(label, key)}</span>
          </button>
        ))}
        <button
          className={`sor-tab-trigger flex items-center gap-1 ${mgr.showRawOutput ? "sor-tab-trigger-active" : ""}`}
          onClick={() => mgr.setShowRawOutput(!mgr.showRawOutput)}
          title={t("serverStats.rawOutput", "Raw output")}
        >
          <Code size={12} />
        </button>
      </div>
    </div>
  );
};
