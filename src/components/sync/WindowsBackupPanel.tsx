import React, { useState } from "react";
import { useTranslation } from "react-i18next";
import {
  HardDrive,
  AlertCircle,
  RefreshCw,
  Plus,
  Trash2,
  Shield,
  Clock,
  Database,
  FolderArchive,
  CheckCircle2,
  XCircle,
  Loader2,
  Settings,
  LogIn,
  LogOut,
  Copy,
} from "lucide-react";
import { Select } from "../ui/forms";
import { useWindowsBackup, type BackupTab } from "../../hooks/sync/useWindowsBackup";
import Modal from "../ui/overlays/Modal";
import DialogHeader from "../ui/overlays/DialogHeader";
import EmptyState from "../ui/display/EmptyState";

export interface WindowsBackupPanelProps {
  isOpen: boolean;
  onClose: () => void;
}

// ─── Helper: format bytes ────────────────────────────────────────────

function formatBytes(bytes: number): string {
  if (bytes === 0) return "0 B";
  const units = ["B", "KB", "MB", "GB", "TB"];
  const i = Math.floor(Math.log(bytes) / Math.log(1024));
  return `${(bytes / Math.pow(1024, i)).toFixed(i === 0 ? 0 : 1)} ${units[i]}`;
}

// ─── Tab button ──────────────────────────────────────────────────────

const TabButton: React.FC<{
  active: boolean;
  onClick: () => void;
  icon: React.ReactNode;
  label: string;
}> = ({ active, onClick, icon, label }) => (
  <button
    onClick={onClick}
    className={`flex items-center gap-1.5 px-3 py-1.5 text-xs rounded-lg transition-colors ${
      active
        ? "bg-primary/20 text-primary border border-primary/30"
        : "text-[var(--color-text-secondary)] hover:bg-[var(--color-bg-hover)] border border-transparent"
    }`}
  >
    {icon}
    {label}
  </button>
);

// ─── Connect Form ────────────────────────────────────────────────────

const ConnectForm: React.FC<{
  onConnect: (host: string, user?: string, pass?: string) => void;
  loading: boolean;
}> = ({ onConnect, loading }) => {
  const { t } = useTranslation();
  const [host, setHost] = useState("");
  const [user, setUser] = useState("");
  const [pass, setPass] = useState("");

  return (
    <div className="space-y-3">
      <div className="flex flex-col gap-2">
        <label className="text-xs text-[var(--color-text-secondary)]">
          {t("windowsBackup.hostname", "Hostname / IP")}
        </label>
        <input
          type="text"
          className="px-3 py-1.5 text-xs rounded-lg border border-[var(--color-border)] bg-[var(--color-surface)] text-[var(--color-text)]"
          placeholder="192.168.1.100"
          value={host}
          onChange={(e) => setHost(e.target.value)}
        />
      </div>
      <div className="grid grid-cols-2 gap-2">
        <div className="flex flex-col gap-1">
          <label className="text-xs text-[var(--color-text-secondary)]">
            {t("windowsBackup.username", "Username")}
          </label>
          <input
            type="text"
            className="px-3 py-1.5 text-xs rounded-lg border border-[var(--color-border)] bg-[var(--color-surface)] text-[var(--color-text)]"
            placeholder="DOMAIN\\Admin"
            value={user}
            onChange={(e) => setUser(e.target.value)}
          />
        </div>
        <div className="flex flex-col gap-1">
          <label className="text-xs text-[var(--color-text-secondary)]">
            {t("windowsBackup.password", "Password")}
          </label>
          <input
            type="password"
            className="px-3 py-1.5 text-xs rounded-lg border border-[var(--color-border)] bg-[var(--color-surface)] text-[var(--color-text)]"
            value={pass}
            onChange={(e) => setPass(e.target.value)}
          />
        </div>
      </div>
      <button
        disabled={!host || loading}
        onClick={() => onConnect(host, user || undefined, pass || undefined)}
        className="flex items-center gap-2 px-4 py-1.5 text-xs rounded-lg bg-primary text-white hover:bg-primary/90 disabled:opacity-50 disabled:pointer-events-none transition-colors"
      >
        {loading ? <Loader2 size={12} className="animate-spin" /> : <LogIn size={12} />}
        {t("windowsBackup.connect", "Connect")}
      </button>
    </div>
  );
};

// ─── Overview Tab ────────────────────────────────────────────────────

const OverviewTab: React.FC<{ mgr: ReturnType<typeof useWindowsBackup> }> = ({ mgr }) => {
  const { t } = useTranslation();
  const { status, policy, shadowCopies } = mgr;

  return (
    <div className="space-y-4">
      {/* Status card */}
      <div className="p-4 rounded-xl border border-[var(--color-border)] bg-[var(--color-bg-secondary)]">
        <h3 className="text-sm font-medium mb-3 flex items-center gap-2">
          <Shield size={14} className="text-primary" />
          {t("windowsBackup.backupStatus", "Backup Status")}
        </h3>
        {status ? (
          <div className="grid grid-cols-2 gap-3 text-xs">
            <div className="flex items-center gap-2">
              {status.isRunning ? (
                <Loader2 size={12} className="animate-spin text-primary" />
              ) : (
                <CheckCircle2 size={12} className="text-success" />
              )}
              <span>
                {status.isRunning
                  ? t("windowsBackup.running", "Backup in progress")
                  : t("windowsBackup.idle", "No backup running")}
              </span>
            </div>
            {status.progressPercent != null && (
              <div className="col-span-2">
                <div className="flex justify-between text-xs mb-1">
                  <span>{status.currentOperation ?? t("windowsBackup.progress", "Progress")}</span>
                  <span>{status.progressPercent.toFixed(0)}%</span>
                </div>
                <div className="w-full h-2 bg-[var(--color-bg)] rounded-full overflow-hidden">
                  <div
                    className="h-full bg-primary rounded-full transition-all"
                    style={{ width: `${status.progressPercent}%` }}
                  />
                </div>
              </div>
            )}
            {status.lastSuccessfulBackup && (
              <div>
                <span className="text-[var(--color-text-secondary)]">
                  {t("windowsBackup.lastSuccess", "Last successful")}:
                </span>{" "}
                <span className="text-success">{status.lastSuccessfulBackup}</span>
              </div>
            )}
            {status.lastFailedBackup && (
              <div>
                <span className="text-[var(--color-text-secondary)]">
                  {t("windowsBackup.lastFailure", "Last failure")}:
                </span>{" "}
                <span className="text-error">{status.lastFailedBackup}</span>
              </div>
            )}
            {status.nextScheduledBackup && (
              <div>
                <span className="text-[var(--color-text-secondary)]">
                  {t("windowsBackup.nextScheduled", "Next scheduled")}:
                </span>{" "}
                <span>{status.nextScheduledBackup}</span>
              </div>
            )}
          </div>
        ) : (
          <p className="text-xs text-[var(--color-text-secondary)]">
            {t("windowsBackup.noStatus", "No status data yet.")}
          </p>
        )}
      </div>

      {/* Quick stats row */}
      <div className="grid grid-cols-3 gap-3">
        <div className="p-3 rounded-xl border border-[var(--color-border)] bg-[var(--color-bg-secondary)] text-center">
          <Copy size={16} className="mx-auto mb-1 text-info" />
          <div className="text-lg font-bold">{shadowCopies.length}</div>
          <div className="text-xs text-[var(--color-text-secondary)]">
            {t("windowsBackup.shadowCopies", "Shadow Copies")}
          </div>
        </div>
        <div className="p-3 rounded-xl border border-[var(--color-border)] bg-[var(--color-bg-secondary)] text-center">
          <Clock size={16} className="mx-auto mb-1 text-warning" />
          <div className="text-lg font-bold">{mgr.versions.length}</div>
          <div className="text-xs text-[var(--color-text-secondary)]">
            {t("windowsBackup.backupVersions", "Backup Versions")}
          </div>
        </div>
        <div className="p-3 rounded-xl border border-[var(--color-border)] bg-[var(--color-bg-secondary)] text-center">
          <Settings size={16} className="mx-auto mb-1 text-accent" />
          <div className="text-lg font-bold">
            {policy?.configured ? (
              <CheckCircle2 size={20} className="mx-auto text-success" />
            ) : (
              <XCircle size={20} className="mx-auto text-error" />
            )}
          </div>
          <div className="text-xs text-[var(--color-text-secondary)]">
            {t("windowsBackup.policyStatus", "Policy")}
          </div>
        </div>
      </div>

      {/* Policy summary */}
      {policy?.configured && (
        <div className="p-4 rounded-xl border border-[var(--color-border)] bg-[var(--color-bg-secondary)]">
          <h3 className="text-sm font-medium mb-2 flex items-center gap-2">
            <Settings size={14} className="text-accent" />
            {t("windowsBackup.policyConfig", "Backup Policy")}
          </h3>
          <div className="grid grid-cols-2 gap-2 text-xs">
            {policy.schedule && (
              <div>
                <span className="text-[var(--color-text-secondary)]">
                  {t("windowsBackup.schedule", "Schedule")}:
                </span>{" "}
                {policy.schedule}
              </div>
            )}
            {policy.backupTarget && (
              <div>
                <span className="text-[var(--color-text-secondary)]">
                  {t("windowsBackup.target", "Target")}:
                </span>{" "}
                {policy.backupTarget}
              </div>
            )}
            {policy.includedVolumes.length > 0 && (
              <div>
                <span className="text-[var(--color-text-secondary)]">
                  {t("windowsBackup.includedVolumes", "Volumes")}:
                </span>{" "}
                {policy.includedVolumes.join(", ")}
              </div>
            )}
            <div className="flex gap-3">
              {policy.systemStateBackup && (
                <span className="text-success">✓ {t("windowsBackup.systemState", "System State")}</span>
              )}
              {policy.bareMetalRecovery && (
                <span className="text-success">✓ {t("windowsBackup.bareMetal", "Bare Metal")}</span>
              )}
            </div>
          </div>
        </div>
      )}
    </div>
  );
};

// ─── Shadow Copies Tab ───────────────────────────────────────────────

const ShadowCopiesTab: React.FC<{ mgr: ReturnType<typeof useWindowsBackup> }> = ({ mgr }) => {
  const { t } = useTranslation();
  const [newVolume, setNewVolume] = useState("C:\\");

  return (
    <div className="space-y-4">
      {/* Create shadow copy */}
      <div className="flex items-end gap-2">
        <div className="flex-1">
          <label className="text-xs text-[var(--color-text-secondary)] mb-1 block">
            {t("windowsBackup.volumeForShadow", "Volume")}
          </label>
          <input
            type="text"
            className="w-full px-3 py-1.5 text-xs rounded-lg border border-[var(--color-border)] bg-[var(--color-surface)] text-[var(--color-text)]"
            value={newVolume}
            onChange={(e) => setNewVolume(e.target.value)}
            placeholder="C:\"
          />
        </div>
        <button
          onClick={() => mgr.createShadowCopy(newVolume)}
          disabled={mgr.loading}
          className="flex items-center gap-1.5 px-3 py-1.5 text-xs rounded-lg bg-success text-white hover:bg-success/90 disabled:opacity-50 transition-colors"
        >
          <Plus size={12} />
          {t("windowsBackup.createShadow", "Create")}
        </button>
      </div>

      {/* Shadow copy list */}
      {mgr.shadowCopies.length === 0 ? (
        <p className="text-xs text-[var(--color-text-secondary)] text-center py-8">
          {t("windowsBackup.noShadowCopies", "No shadow copies found.")}
        </p>
      ) : (
        <div className="space-y-2">
          {mgr.shadowCopies.map((sc) => (
            <div
              key={sc.id}
              className="p-3 rounded-xl border border-[var(--color-border)] bg-[var(--color-bg-secondary)] flex items-start justify-between gap-3"
            >
              <div className="flex-1 min-w-0">
                <div className="flex items-center gap-2 text-xs font-medium">
                  <Database size={12} className="text-info flex-shrink-0" />
                  <span className="truncate">{sc.volumeName}</span>
                  <span
                    className={`px-1.5 py-0.5 rounded text-[10px] ${
                      sc.state === "stable"
                        ? "bg-success/20 text-success"
                        : sc.state === "creating"
                          ? "bg-primary/20 text-primary"
                          : "bg-text-secondary/20 text-text-muted"
                    }`}
                  >
                    {sc.state}
                  </span>
                </div>
                <div className="mt-1 text-[10px] text-[var(--color-text-secondary)] space-x-3">
                  {sc.installDate && <span>{t("windowsBackup.created", "Created")}: {sc.installDate}</span>}
                  {sc.originatingMachine && <span>{t("windowsBackup.machine", "Machine")}: {sc.originatingMachine}</span>}
                  {sc.persistent && <span className="text-warning">{t("windowsBackup.persistent", "Persistent")}</span>}
                  {sc.clientAccessible && <span className="text-success">{t("windowsBackup.accessible", "Accessible")}</span>}
                </div>
                <div className="mt-0.5 text-[10px] text-[var(--color-text-secondary)] font-mono truncate">
                  {sc.shadowId}
                </div>
              </div>
              <button
                onClick={() => mgr.deleteShadowCopy(sc.id)}
                disabled={mgr.loading}
                className="flex-shrink-0 p-1.5 rounded-lg text-error hover:bg-error/10 transition-colors"
                title={t("windowsBackup.deleteShadow", "Delete shadow copy")}
              >
                <Trash2 size={12} />
              </button>
            </div>
          ))}
        </div>
      )}

      {/* Shadow storage summary */}
      {mgr.shadowStorage.length > 0 && (
        <div className="p-3 rounded-xl border border-[var(--color-border)] bg-[var(--color-bg-secondary)]">
          <h4 className="text-xs font-medium mb-2">
            {t("windowsBackup.shadowStorageTitle", "Shadow Storage")}
          </h4>
          <div className="space-y-1">
            {mgr.shadowStorage.map((ss, i) => (
              <div key={i} className="flex justify-between text-[10px]">
                <span className="text-[var(--color-text-secondary)]">{ss.volume}</span>
                <span>
                  {formatBytes(ss.usedSpace)} / {formatBytes(ss.maxSpace)}
                </span>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
};

// ─── Versions Tab ────────────────────────────────────────────────────

const VersionsTab: React.FC<{ mgr: ReturnType<typeof useWindowsBackup> }> = ({ mgr }) => {
  const { t } = useTranslation();

  if (mgr.versions.length === 0) {
    return (
      <p className="text-xs text-[var(--color-text-secondary)] text-center py-8">
        {t("windowsBackup.noVersions", "No backup versions found.")}
      </p>
    );
  }

  return (
    <div className="space-y-2">
      {mgr.versions.map((v, i) => (
        <div
          key={i}
          className="p-3 rounded-xl border border-[var(--color-border)] bg-[var(--color-bg-secondary)]"
        >
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-2 text-xs font-medium">
              <FolderArchive size={12} className="text-warning" />
              <span>{v.versionId}</span>
              {v.canRecover ? (
                <span className="px-1.5 py-0.5 rounded text-[10px] bg-success/20 text-success">
                  {t("windowsBackup.recoverable", "Recoverable")}
                </span>
              ) : (
                <span className="px-1.5 py-0.5 rounded text-[10px] bg-error/20 text-error">
                  {t("windowsBackup.notRecoverable", "Not recoverable")}
                </span>
              )}
            </div>
          </div>
          <div className="mt-1 text-[10px] text-[var(--color-text-secondary)] space-x-3">
            {v.backupTime && <span>{t("windowsBackup.backupTime", "Time")}: {v.backupTime}</span>}
            {v.backupLocation && <span>{t("windowsBackup.location", "Location")}: {v.backupLocation}</span>}
          </div>
        </div>
      ))}
    </div>
  );
};

// ─── Policy Tab ──────────────────────────────────────────────────────

const PolicyTab: React.FC<{ mgr: ReturnType<typeof useWindowsBackup> }> = ({ mgr }) => {
  const { t } = useTranslation();
  const { policy, backupItems, showRawOutput, setShowRawOutput } = mgr;

  if (!policy) {
    return (
      <p className="text-xs text-[var(--color-text-secondary)] text-center py-8">
        {t("windowsBackup.noPolicyData", "No policy data loaded.")}
      </p>
    );
  }

  return (
    <div className="space-y-4">
      <div className="p-4 rounded-xl border border-[var(--color-border)] bg-[var(--color-bg-secondary)]">
        <div className="flex items-center gap-2 mb-3">
          <Settings size={14} className="text-accent" />
          <h3 className="text-sm font-medium">
            {policy.configured
              ? t("windowsBackup.policyConfigured", "Backup Policy Configured")
              : t("windowsBackup.policyNotConfigured", "No Backup Policy Configured")}
          </h3>
        </div>
        {policy.configured && (
          <div className="space-y-2 text-xs">
            {policy.schedule && (
              <div>
                <span className="text-[var(--color-text-secondary)]">{t("windowsBackup.schedule", "Schedule")}: </span>
                {policy.schedule}
              </div>
            )}
            {policy.backupTarget && (
              <div>
                <span className="text-[var(--color-text-secondary)]">{t("windowsBackup.target", "Target")}: </span>
                {policy.backupTarget}
              </div>
            )}
            <div className="flex gap-3">
              <span className={policy.systemStateBackup ? "text-success" : "text-[var(--color-text-secondary)]"}>
                {policy.systemStateBackup ? "✓" : "✗"} {t("windowsBackup.systemState", "System State")}
              </span>
              <span className={policy.bareMetalRecovery ? "text-success" : "text-[var(--color-text-secondary)]"}>
                {policy.bareMetalRecovery ? "✓" : "✗"} {t("windowsBackup.bareMetal", "Bare Metal Recovery")}
              </span>
            </div>
          </div>
        )}
      </div>

      {/* Backup items */}
      {backupItems.length > 0 && (
        <div className="p-4 rounded-xl border border-[var(--color-border)] bg-[var(--color-bg-secondary)]">
          <h4 className="text-xs font-medium mb-2">{t("windowsBackup.backupItems", "Included Items")}</h4>
          <div className="space-y-1">
            {backupItems.map((item, i) => (
              <div key={i} className="flex items-center gap-2 text-xs">
                <HardDrive size={10} className="text-[var(--color-text-secondary)]" />
                <span>{item.name}</span>
                <span className="text-[10px] text-[var(--color-text-secondary)] px-1 py-0.5 rounded bg-[var(--color-bg)]">
                  {item.itemType}
                </span>
                {item.size != null && (
                  <span className="text-[var(--color-text-secondary)]">{formatBytes(item.size)}</span>
                )}
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Raw output toggle */}
      <button
        onClick={() => setShowRawOutput(!showRawOutput)}
        className="text-xs text-[var(--color-text-secondary)] hover:text-[var(--color-text)] transition-colors"
      >
        {showRawOutput
          ? t("windowsBackup.hideRaw", "Hide raw output")
          : t("windowsBackup.showRaw", "Show raw output")}
      </button>
      {showRawOutput && policy.rawOutput && (
        <pre className="p-3 text-xs bg-black/20 rounded-lg overflow-auto max-h-40 text-[var(--color-text-secondary)] font-mono whitespace-pre-wrap border border-[var(--color-border)]">
          {policy.rawOutput}
        </pre>
      )}
    </div>
  );
};

// ─── Volumes Tab ─────────────────────────────────────────────────────

const VolumesTab: React.FC<{ mgr: ReturnType<typeof useWindowsBackup> }> = ({ mgr }) => {
  const { t } = useTranslation();

  if (mgr.volumes.length === 0) {
    return (
      <p className="text-xs text-[var(--color-text-secondary)] text-center py-8">
        {t("windowsBackup.noVolumes", "No volumes found.")}
      </p>
    );
  }

  return (
    <div className="space-y-2">
      {mgr.volumes.map((vol, i) => {
        const usedPercent = vol.capacity > 0 ? ((vol.capacity - vol.freeSpace) / vol.capacity) * 100 : 0;
        return (
          <div
            key={i}
            className="p-3 rounded-xl border border-[var(--color-border)] bg-[var(--color-bg-secondary)]"
          >
            <div className="flex items-center justify-between mb-2">
              <div className="flex items-center gap-2 text-xs font-medium">
                <HardDrive size={12} className="text-primary" />
                <span>{vol.driveLetter ?? vol.name}</span>
                {vol.label && (
                  <span className="text-[var(--color-text-secondary)]">({vol.label})</span>
                )}
                {vol.fileSystem && (
                  <span className="px-1.5 py-0.5 rounded text-[10px] bg-[var(--color-bg)] text-[var(--color-text-secondary)]">
                    {vol.fileSystem}
                  </span>
                )}
              </div>
              <span className="text-xs text-[var(--color-text-secondary)]">
                {formatBytes(vol.freeSpace)} {t("windowsBackup.free", "free")} / {formatBytes(vol.capacity)}
              </span>
            </div>
            <div className="w-full h-1.5 bg-[var(--color-bg)] rounded-full overflow-hidden">
              <div
                className={`h-full rounded-full transition-all ${
                  usedPercent > 90 ? "bg-error" : usedPercent > 70 ? "bg-warning" : "bg-primary"
                }`}
                style={{ width: `${usedPercent}%` }}
              />
            </div>
          </div>
        );
      })}
    </div>
  );
};

// ─── Main Panel ──────────────────────────────────────────────────────

export const WindowsBackupPanel: React.FC<WindowsBackupPanelProps> = ({
  isOpen,
  onClose,
}) => {
  const { t } = useTranslation();
  const mgr = useWindowsBackup(isOpen);

  if (!isOpen) return null;

  const tabs: { key: BackupTab; icon: React.ReactNode; label: string }[] = [
    { key: "overview", icon: <Shield size={12} />, label: t("windowsBackup.tabOverview", "Overview") },
    { key: "shadowCopies", icon: <Copy size={12} />, label: t("windowsBackup.tabShadowCopies", "Shadow Copies") },
    { key: "versions", icon: <FolderArchive size={12} />, label: t("windowsBackup.tabVersions", "Versions") },
    { key: "policy", icon: <Settings size={12} />, label: t("windowsBackup.tabPolicy", "Policy") },
    { key: "volumes", icon: <HardDrive size={12} />, label: t("windowsBackup.tabVolumes", "Volumes") },
  ];

  return (
    <Modal
      isOpen={isOpen}
      onClose={onClose}
      backdropClassName="bg-black/50"
      panelClassName="max-w-5xl mx-4 h-[85vh]"
      contentClassName="overflow-hidden"
      dataTestId="windows-backup-panel-modal"
    >
      {/* Background glow effects */}
      <div className="absolute inset-0 overflow-hidden pointer-events-none dark:opacity-100 opacity-0">
        <div className="absolute top-[15%] left-[10%] w-96 h-96 bg-primary/8 rounded-full blur-3xl" />
        <div className="absolute bottom-[20%] right-[15%] w-80 h-80 bg-accent/6 rounded-full blur-3xl" />
      </div>

      <div className="bg-[var(--color-surface)] rounded-xl shadow-xl w-full max-w-5xl mx-4 h-[85vh] overflow-hidden flex flex-col border border-[var(--color-border)] relative z-10">
        {/* Header */}
        <DialogHeader
          icon={HardDrive}
          iconColor="text-primary dark:text-primary"
          iconBg="bg-primary/20"
          title={t("windowsBackup.title", "Windows Backup")}
          badge={
            mgr.isConnected
              ? mgr.hostname
              : undefined
          }
          onClose={onClose}
          sticky
        />

        {/* Toolbar */}
        <div className="px-4 py-2 border-b border-[var(--color-border)] flex items-center gap-2 flex-wrap">
          {mgr.isConnected ? (
            <>
              {/* Tabs */}
              {tabs.map((tab) => (
                <TabButton
                  key={tab.key}
                  active={mgr.activeTab === tab.key}
                  onClick={() => mgr.setActiveTab(tab.key)}
                  icon={tab.icon}
                  label={tab.label}
                />
              ))}

              <div className="flex-1" />

              {/* Auto-refresh */}
              <Select
                value={String(mgr.autoRefresh)}
                onChange={(v) => mgr.setAutoRefresh(Number(v))}
                variant="form-sm"
                options={[
                  { value: "0", label: t("windowsBackup.autoRefreshOff", "Auto: Off") },
                  { value: "15", label: "15s" },
                  { value: "30", label: "30s" },
                  { value: "60", label: "60s" },
                ]}
              />

              {/* Refresh */}
              <button
                onClick={() => mgr.refreshAll()}
                disabled={mgr.loading}
                className="flex items-center gap-1.5 px-3 py-1.5 text-xs rounded-lg bg-[var(--color-bg-hover)] text-[var(--color-text)] hover:bg-[var(--color-border)] transition-colors"
              >
                <RefreshCw size={12} className={mgr.loading ? "animate-spin" : ""} />
                {t("windowsBackup.refresh", "Refresh")}
              </button>

              {/* Disconnect */}
              <button
                onClick={() => mgr.disconnect()}
                className="flex items-center gap-1.5 px-3 py-1.5 text-xs rounded-lg text-error hover:bg-error/10 transition-colors"
              >
                <LogOut size={12} />
                {t("windowsBackup.disconnect", "Disconnect")}
              </button>
            </>
          ) : (
            <span className="text-xs text-[var(--color-text-secondary)]">
              {t("windowsBackup.connectPrompt", "Connect to a remote Windows host to view backup information.")}
            </span>
          )}
        </div>

        {/* Content area */}
        <div className="flex-1 overflow-y-auto p-4">
          {/* Error banner */}
          {mgr.error && (
            <div className="mb-4 flex items-start gap-2 p-3 rounded-lg bg-error/10 border border-error/30 text-xs text-error">
              <AlertCircle size={14} className="flex-shrink-0 mt-0.5" />
              <span>{mgr.error}</span>
            </div>
          )}

          {!mgr.isConnected ? (
            <div className="max-w-md mx-auto mt-12">
              <EmptyState
                icon={HardDrive}
                message={t("windowsBackup.notConnected", "Not Connected")}
                hint={t("windowsBackup.connectHint", "Enter the hostname and credentials for a remote Windows server.")}
              />
              <div className="mt-6">
                <ConnectForm onConnect={mgr.connect} loading={mgr.loading} />
              </div>
            </div>
          ) : (
            <>
              {mgr.activeTab === "overview" && <OverviewTab mgr={mgr} />}
              {mgr.activeTab === "shadowCopies" && <ShadowCopiesTab mgr={mgr} />}
              {mgr.activeTab === "versions" && <VersionsTab mgr={mgr} />}
              {mgr.activeTab === "policy" && <PolicyTab mgr={mgr} />}
              {mgr.activeTab === "volumes" && <VolumesTab mgr={mgr} />}
            </>
          )}
        </div>
      </div>
    </Modal>
  );
};

export default WindowsBackupPanel;
