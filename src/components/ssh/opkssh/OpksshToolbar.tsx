import React from "react";
import { useTranslation } from "react-i18next";
import {
  LayoutDashboard,
  LogIn,
  Key,
  Server,
  Settings,
  ClipboardList,
} from "lucide-react";
import type { OpksshMgr } from "./types";
import type { OpksshTab } from "../../../types/security/opkssh";
import { Select } from "../../ui/forms";

interface OpksshToolbarProps {
  mgr: OpksshMgr;
}

const tabItems: ReadonlyArray<{
  key: OpksshTab;
  icon: React.FC<any>;
  label: string;
}> = [
  { key: "overview", icon: LayoutDashboard, label: "opkssh.overview" },
  { key: "login", icon: LogIn, label: "opkssh.login" },
  { key: "keys", icon: Key, label: "opkssh.keys" },
  { key: "serverConfig", icon: Server, label: "opkssh.serverConfig" },
  { key: "providers", icon: Settings, label: "opkssh.providers" },
  { key: "audit", icon: ClipboardList, label: "opkssh.audit" },
] as const;

export const OpksshToolbar: React.FC<OpksshToolbarProps> = ({ mgr }) => {
  const { t } = useTranslation();

  return (
    <div className="border-b border-[var(--color-border)] bg-[var(--color-surface-raised)] px-4 py-2 flex flex-wrap items-center gap-2">
      {/* Session selector (for server-side tabs) */}
      {(mgr.activeTab === "serverConfig" || mgr.activeTab === "audit") && (
        <Select
          value={mgr.selectedSessionId ?? ""}
          onChange={(v) => mgr.setSelectedSessionId(v || null)}
          variant="form-sm"
          className="min-w-[180px]"
          aria-label={t("opkssh.selectSession", "Select SSH session")}
          options={[
            {
              value: "",
              label: mgr.sshSessions.length === 0
                ? t("opkssh.noSessions", "No SSH sessions")
                : t("opkssh.selectSession", "Select SSH session"),
            },
            ...mgr.sshSessions.map((s) => ({
              value: s.id,
              label: s.name || s.hostname || s.id,
            })),
          ]}
        />
      )}

      <div className="flex-1" />

      {/* Tab navigation */}
      <div className="flex items-center gap-1">
        {tabItems.map(({ key, icon: Icon, label }) => (
          <button
            key={key}
            className={`text-xs px-2 py-1 rounded flex items-center gap-1 transition-colors ${
              mgr.activeTab === key
                ? "bg-success text-white"
                : "text-[var(--color-text-secondary)] hover:bg-[var(--color-surface-hover)]"
            }`}
            onClick={() => mgr.setActiveTab(key)}
            title={t(label, key)}
          >
            <Icon size={12} />
            <span className="hidden sm:inline">{t(label, key)}</span>
          </button>
        ))}
      </div>
    </div>
  );
};
