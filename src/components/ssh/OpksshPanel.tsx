import React from "react";
import { useTranslation } from "react-i18next";
import { AlertCircle, LayoutDashboard, LogIn, Key, Server, Settings, ClipboardList } from "lucide-react";
import { useOpkssh } from "../../hooks/ssh/useOpkssh";
import type { OpksshPanelProps } from "./opkssh/types";
import type { OpksshTab } from "../../types/security/opkssh";
import { Select } from "../ui/forms";
import { OverviewTab } from "./opkssh/OverviewTab";
import { LoginTab } from "./opkssh/LoginTab";
import { KeysTab } from "./opkssh/KeysTab";
import { ServerConfigTab } from "./opkssh/ServerConfigTab";
import { ProvidersTab } from "./opkssh/ProvidersTab";
import { AuditTab } from "./opkssh/AuditTab";

const OPKSSH_TABS: ReadonlyArray<{ key: OpksshTab; icon: React.FC<any>; label: string }> = [
  { key: "overview", icon: LayoutDashboard, label: "opkssh.overview" },
  { key: "login", icon: LogIn, label: "opkssh.login" },
  { key: "keys", icon: Key, label: "opkssh.keys" },
  { key: "serverConfig", icon: Server, label: "opkssh.serverConfig" },
  { key: "providers", icon: Settings, label: "opkssh.providers" },
  { key: "audit", icon: ClipboardList, label: "opkssh.audit" },
];

export const OpksshPanel: React.FC<OpksshPanelProps> = ({
  isOpen,
  onClose,
}) => {
  const { t } = useTranslation();
  const mgr = useOpkssh(isOpen);

  if (!isOpen) return null;

  const renderTab = () => {
    switch (mgr.activeTab) {
      case "overview":
        return <OverviewTab mgr={mgr} />;
      case "login":
        return <LoginTab mgr={mgr} />;
      case "keys":
        return <KeysTab mgr={mgr} />;
      case "serverConfig":
        return <ServerConfigTab mgr={mgr} />;
      case "providers":
        return <ProvidersTab mgr={mgr} />;
      case "audit":
        return <AuditTab mgr={mgr} />;
      default:
        return <OverviewTab mgr={mgr} />;
    }
  };

  return (
    <div className="h-full flex bg-[var(--color-surface)] overflow-hidden">
      {/* Sidebar */}
      <div className="w-48 flex-shrink-0 border-r border-[var(--color-border)] flex flex-col">
        <div className="p-3 space-y-1">
          {OPKSSH_TABS.map(({ key, icon: Icon, label }) => (
            <button
              key={key}
              onClick={() => mgr.setActiveTab(key)}
              className={`sor-sidebar-tab w-full flex items-center gap-2 ${mgr.activeTab === key ? 'sor-sidebar-tab-active' : ''}`}
            >
              <Icon size={14} />
              <span className="flex-1 text-left">{t(label, key)}</span>
            </button>
          ))}
        </div>
        {/* Session selector in sidebar footer */}
        {(mgr.activeTab === "serverConfig" || mgr.activeTab === "audit") && (
          <div className="mt-auto p-3 border-t border-[var(--color-border)]">
            <div className="text-[10px] text-[var(--color-textMuted)] mb-1.5">{t("opkssh.selectSession", "SSH Session")}</div>
            <Select
              value={mgr.selectedSessionId ?? ""}
              onChange={(v) => mgr.setSelectedSessionId(v || null)}
              variant="form-sm"
              options={[
                { value: "", label: mgr.sshSessions.length === 0 ? t("opkssh.noSessions", "No sessions") : t("opkssh.selectSession", "Select session") },
                ...mgr.sshSessions.map((s) => ({ value: s.id, label: s.name || s.hostname || s.id })),
              ]}
            />
          </div>
        )}
      </div>
      {/* Content */}
      <div className="flex-1 flex flex-col overflow-hidden">
        <div className="flex-1 overflow-y-auto p-4">
          {mgr.error && (
            <div className="mb-4 flex items-start gap-2 p-3 rounded-lg bg-error/10 border border-error/30 text-xs text-error">
              <AlertCircle size={14} className="flex-shrink-0 mt-0.5" />
              <span>{mgr.error}</span>
            </div>
          )}
          {renderTab()}
        </div>
      </div>
    </div>
  );
};
