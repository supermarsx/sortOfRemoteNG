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

function formatLoginElapsed(ms: number): string {
  const totalSeconds = Math.max(0, Math.floor(ms / 1000));
  const minutes = Math.floor(totalSeconds / 60);
  const seconds = totalSeconds % 60;
  return `${minutes}:${seconds.toString().padStart(2, "0")}`;
}

export const OpksshPanel: React.FC<OpksshPanelProps> = ({
  isOpen,
  onClose,
}) => {
  const { t } = useTranslation();
  const mgr = useOpkssh(isOpen);
  const runtime = mgr.runtimeStatus ?? mgr.overallStatus?.runtime ?? null;
  const rolloutSignal = mgr.rolloutSignal ?? null;
  const runtimeLabel = !runtime?.activeBackend
    ? t("opkssh.runtimeUnavailable", "No runtime available")
    : runtime.activeBackend === "cli"
      ? runtime.usingFallback
        ? t("opkssh.runtimeCliFallback", "CLI fallback active")
        : t("opkssh.runtimeCli", "CLI runtime active")
      : t("opkssh.runtimeLibrary", "Library runtime active");
  const runtimeMessage = runtime?.message
    || (runtime?.library.availability !== "available"
      ? t(
          "opkssh.runtimeLibraryPlanned",
          "The in-process OPKSSH library backend is planned but not linked in this build.",
        )
      : null);
  const visibleRuntimeMessage = runtimeMessage !== rolloutSignal?.fallbackReason
    ? runtimeMessage
    : null;
  const loginOperation = mgr.loginOperation;
  const showLoginLifecycleCard = Boolean(
    mgr.loginPhase === "cancelling"
      || mgr.loginWaitTimedOut
      || loginOperation?.status === "running"
      || loginOperation?.status === "cancelled",
  );
  const loginLifecycleTitle = mgr.loginPhase === "cancelling"
    ? t("opkssh.loginCancelling", "Cancelling local wait")
    : mgr.loginWaitTimedOut
      ? t("opkssh.loginStillWaiting", "Login is still waiting on the provider")
      : loginOperation?.status === "cancelled"
        ? t("opkssh.loginCancelledLocal", "Login wait cancelled locally")
        : t("opkssh.loginInProgress", "Login in progress");
  const loginLifecycleClasses = mgr.loginWaitTimedOut
    || mgr.loginPhase === "cancelling"
    || loginOperation?.status === "cancelled"
    ? "border-warning/30 bg-warning/10"
    : "border-[var(--color-border)] bg-[var(--color-surfaceHover)]";
  const loginLifecycleMessage = mgr.loginNotice
    || (loginOperation?.status === "running"
      ? t(
          "opkssh.loginLifecycleRunning",
          "OPKSSH is waiting on the system browser and provider-owned callback flow.",
        )
      : null);

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
          {runtime && (
            <div className="mb-4 rounded-lg border border-[var(--color-border)] bg-[var(--color-surfaceHover)] p-3 text-xs text-[var(--color-textSecondary)]">
              <div className="flex flex-wrap items-center gap-2">
                <span className="font-medium text-[var(--color-text)]">
                  {t("opkssh.runtime", "Local runtime")}
                </span>
                <span className="rounded-full border border-[var(--color-border)] bg-[var(--color-surface)] px-2 py-0.5 text-[10px] text-[var(--color-text)]">
                  {runtimeLabel}
                </span>
                <span>
                  {t("opkssh.runtimeMode", "Rollout mode")}: {rolloutSignal?.preferredMode ?? runtime.mode}
                </span>
              </div>
              {visibleRuntimeMessage && <p className="mt-2">{visibleRuntimeMessage}</p>}
              {rolloutSignal?.fallbackReason && (
                <p className="mt-2">
                  <span className="font-medium text-[var(--color-text)]">
                    {t("opkssh.fallbackReason", "Fallback reason")}
                  </span>
                  {": "}
                  {rolloutSignal.fallbackReason}
                </p>
              )}
              {rolloutSignal && (
                <p className="mt-2">
                  <span className="font-medium text-[var(--color-text)]">
                    {t("opkssh.cliRetirement", "CLI retirement")}
                  </span>
                  {": "}
                  {rolloutSignal.cliRetirementMessage}
                </p>
              )}
              <p className="mt-2">
                {t(
                  "opkssh.callbackOwnershipNote",
                  "Browser callback listener bind and shutdown remain provider-owned in this slice.",
                )}
              </p>
            </div>
          )}
          {showLoginLifecycleCard && (
            <div className={`mb-4 rounded-lg border p-3 text-xs text-[var(--color-textSecondary)] ${loginLifecycleClasses}`}>
              <div className="flex flex-wrap items-center gap-2">
                <span className="font-medium text-[var(--color-text)]">
                  {loginLifecycleTitle}
                </span>
                {loginOperation?.provider && (
                  <span className="rounded-full border border-[var(--color-border)] bg-[var(--color-surface)] px-2 py-0.5 text-[10px] text-[var(--color-text)]">
                    {loginOperation.provider}
                  </span>
                )}
                {loginOperation?.status === "running" && (
                  <span>
                    {t("opkssh.loginElapsed", "Elapsed")}: {formatLoginElapsed(mgr.loginElapsedMs)}
                  </span>
                )}
              </div>
              {loginLifecycleMessage && <p className="mt-2">{loginLifecycleMessage}</p>}
              {(loginOperation?.status === "running" || mgr.loginWaitTimedOut) && !loginOperation?.browserUrl && (
                <p className="mt-2 text-[10px] text-[var(--color-textMuted)]">
                  {t(
                    "opkssh.browserLaunchLimitation",
                    "If the system browser did not open, this app cannot detect that failure directly because OPKSSH/provider owns browser launch and callback handling in this slice.",
                  )}
                </p>
              )}
              {loginOperation?.status === "running" && (
                <div className="mt-3 flex flex-wrap gap-2">
                  {mgr.loginWaitTimedOut && (
                    <button
                      className="text-xs px-3 py-1.5 rounded bg-success hover:bg-success/90 text-[var(--color-text)] transition-colors"
                      onClick={() => {
                        void mgr.continueLoginWait();
                      }}
                    >
                      {t("opkssh.keepWaiting", "Keep waiting")}
                    </button>
                  )}
                  <button
                    className="text-xs px-3 py-1.5 rounded bg-[var(--color-surface)] hover:bg-[var(--color-surfaceHover)] text-[var(--color-text)] border border-[var(--color-border)] transition-colors"
                    onClick={() => {
                      void mgr.refreshLoginOperation();
                    }}
                  >
                    {t("opkssh.refreshLoginStatus", "Refresh login status")}
                  </button>
                  {loginOperation.canCancel && (
                    <button
                      className="text-xs px-3 py-1.5 rounded border border-warning/40 bg-warning/10 text-[var(--color-text)] hover:bg-warning/20 transition-colors"
                      onClick={() => {
                        void mgr.cancelLogin();
                      }}
                    >
                      {t("opkssh.cancelLocalWait", "Cancel local wait")}
                    </button>
                  )}
                </div>
              )}
            </div>
          )}
          {renderTab()}
        </div>
      </div>
    </div>
  );
};
