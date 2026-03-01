import React from "react";
import {
  Cloud,
  CloudOff,
  HardDrive,
  RefreshCw,
  CheckCircle,
  AlertCircle,
  Clock,
  ChevronDown,
  ChevronUp,
  Loader2,
  Archive,
  Timer,
} from "lucide-react";
import { CloudSyncProvider } from "../types/settings";
import { ToolbarPopover, ToolbarPopoverHeader } from "./ui/overlays/ToolbarPopover";
import {
  useSyncBackupStatusBar,
  PROVIDER_NAMES,
  formatRelativeTime,
  formatNextTime,
  formatBytes,
} from "../hooks/sync/useSyncBackupStatusBar";

type Mgr = ReturnType<typeof useSyncBackupStatusBar>;

/* ── Sub-components ──────────────────────────────────── */

const SyncStatusIcon: React.FC<{ mgr: Mgr }> = ({ mgr }) => {
  if (mgr.isSyncing) return <Loader2 className="w-4 h-4 animate-spin text-blue-400" />;
  if (!mgr.hasSync) return <CloudOff className="w-4 h-4 text-gray-500" />;
  const statuses = mgr.enabledProviders.map((p) => mgr.config.providerStatus[p]?.lastSyncStatus);
  if (statuses.some((s) => s === "failed")) return <AlertCircle className="w-4 h-4 text-red-400" />;
  if (statuses.some((s) => s === "conflict")) return <AlertCircle className="w-4 h-4 text-yellow-400" />;
  if (statuses.every((s) => s === "success")) return <CheckCircle className="w-4 h-4 text-green-400" />;
  return <Cloud className="w-4 h-4 text-[var(--color-textSecondary)]" />;
};

const BackupStatusIcon: React.FC<{ mgr: Mgr }> = ({ mgr }) => {
  if (mgr.isBackingUp || mgr.backupStatus?.isRunning) return <Loader2 className="w-4 h-4 animate-spin text-blue-400" />;
  if (!mgr.backupStatus || mgr.backupStatus.backupCount === 0) return <Archive className="w-4 h-4 text-gray-500" />;
  if (mgr.backupStatus.lastBackupStatus === "failed") return <AlertCircle className="w-4 h-4 text-red-400" />;
  if (mgr.backupStatus.lastBackupStatus === "success") return <CheckCircle className="w-4 h-4 text-green-400" />;
  return <HardDrive className="w-4 h-4 text-[var(--color-textSecondary)]" />;
};

const ProviderRow: React.FC<{ provider: CloudSyncProvider; mgr: Mgr }> = ({ provider, mgr }) => {
  const status = mgr.config.providerStatus[provider];
  return (
    <div className="sor-status-item flex items-center justify-between p-2">
      <div className="flex items-center gap-2">
        {status?.lastSyncStatus === "success" && <CheckCircle className="w-3 h-3 text-green-400" />}
        {status?.lastSyncStatus === "failed" && <AlertCircle className="w-3 h-3 text-red-400" />}
        {status?.lastSyncStatus === "conflict" && <AlertCircle className="w-3 h-3 text-yellow-400" />}
        {!status?.lastSyncStatus && <Clock className="w-3 h-3 text-[var(--color-textSecondary)]" />}
        <span className="text-xs text-[var(--color-textSecondary)]">{PROVIDER_NAMES[provider]}</span>
      </div>
      <div className="flex items-center gap-2">
        <span className="text-xs text-gray-500">{formatRelativeTime(status?.lastSyncTime)}</span>
        <button onClick={() => mgr.handleSyncProvider(provider)} disabled={mgr.isSyncing} className="p-1 hover:bg-[var(--color-border)] rounded" title={mgr.t("syncBackup.syncProvider", "Sync {{provider}}", { provider: PROVIDER_NAMES[provider] })}>
          <RefreshCw className="w-3 h-3 text-[var(--color-textSecondary)]" />
        </button>
      </div>
    </div>
  );
};

const CloudSyncSection: React.FC<{ mgr: Mgr }> = ({ mgr }) => (
  <div className="p-4 border-b border-[var(--color-border)]">
    <div className="flex items-center justify-between mb-3">
      <div className="flex items-center gap-2">
        <Cloud className="w-4 h-4 text-blue-400" />
        <span className="text-sm font-medium text-gray-200">{mgr.t("syncBackup.cloudSync", "Cloud Sync")}</span>
      </div>
      {mgr.hasSync && (
        <button onClick={mgr.handleSyncAll} disabled={mgr.isSyncing} className="flex items-center gap-1 px-2 py-1 text-xs bg-blue-600 hover:bg-blue-700 disabled:opacity-50 rounded">
          {mgr.isSyncing ? <Loader2 className="w-3 h-3 animate-spin" /> : <RefreshCw className="w-3 h-3" />}
          {mgr.t("syncBackup.syncAll", "Sync All")}
        </button>
      )}
    </div>
    {!mgr.hasSync ? (
      <p className="text-xs text-gray-500">{mgr.t("syncBackup.noSyncConfigured", "No sync providers configured")}</p>
    ) : (
      <div className="space-y-2">
        {mgr.enabledProviders.map((provider) => (
          <ProviderRow key={provider} provider={provider} mgr={mgr} />
        ))}
      </div>
    )}
    {mgr.hasSync && (
      <div className="mt-2 flex items-center gap-2 text-xs text-gray-500">
        <Clock className="w-3 h-3" />
        <span>{mgr.t("syncBackup.lastSync", "Last sync")}: {formatRelativeTime(mgr.getLastSyncTime())}</span>
      </div>
    )}
  </div>
);

const BackupSection: React.FC<{ mgr: Mgr; onBackupNow?: () => void }> = ({ mgr, onBackupNow }) => (
  <div className="p-4">
    <div className="flex items-center justify-between mb-3">
      <div className="flex items-center gap-2">
        <HardDrive className="w-4 h-4 text-green-400" />
        <span className="text-sm font-medium text-gray-200">{mgr.t("syncBackup.localBackup", "Local Backup")}</span>
      </div>
      <button onClick={mgr.handleBackupNow} disabled={mgr.isBackingUp || mgr.backupStatus?.isRunning} className="flex items-center gap-1 px-2 py-1 text-xs bg-green-600 hover:bg-green-700 disabled:opacity-50 rounded">
        {mgr.isBackingUp || mgr.backupStatus?.isRunning ? <Loader2 className="w-3 h-3 animate-spin" /> : <Archive className="w-3 h-3" />}
        {mgr.t("syncBackup.backupNow", "Backup Now")}
      </button>
    </div>
    {mgr.backupStatus ? (
      <div className="space-y-2">
        <div className="flex items-center justify-between text-xs">
          <span className="text-[var(--color-textSecondary)]">{mgr.t("syncBackup.lastBackup", "Last backup")}:</span>
          <div className="flex items-center gap-2">
            {mgr.backupStatus.lastBackupStatus === "success" && <CheckCircle className="w-3 h-3 text-green-400" />}
            {mgr.backupStatus.lastBackupStatus === "failed" && <AlertCircle className="w-3 h-3 text-red-400" />}
            <span className="text-[var(--color-textSecondary)]">{formatRelativeTime(mgr.backupStatus.lastBackupTime)}</span>
          </div>
        </div>
        <div className="flex items-center justify-between text-xs">
          <span className="text-[var(--color-textSecondary)]">{mgr.t("syncBackup.nextBackup", "Next backup")}:</span>
          <div className="flex items-center gap-1 text-[var(--color-textSecondary)]">
            <Timer className="w-3 h-3 text-gray-500" />
            {formatNextTime(mgr.backupStatus.nextScheduledTime)}
          </div>
        </div>
        <div className="flex items-center justify-between text-xs pt-2 border-t border-[var(--color-border)]">
          <span className="text-gray-500">{mgr.backupStatus.backupCount} {mgr.t("syncBackup.backups", "backups")}</span>
          <span className="text-gray-500">{formatBytes(mgr.backupStatus.totalSizeBytes)}</span>
        </div>
        {mgr.backupStatus.lastError && (
          <div className="mt-2 p-2 bg-red-900/20 border border-red-800 rounded text-xs text-red-300">{mgr.backupStatus.lastError}</div>
        )}
      </div>
    ) : (
      <p className="text-xs text-gray-500">{mgr.t("syncBackup.noBackups", "No backups yet")}</p>
    )}
  </div>
);

/* ── Main Component ──────────────────────────────────── */

interface SyncBackupStatusBarProps {
  cloudSyncConfig?: {
    enabled: boolean;
    enabledProviders: CloudSyncProvider[];
    providerStatus: Partial<Record<CloudSyncProvider, { enabled: boolean; lastSyncTime?: number; lastSyncStatus?: "success" | "failed" | "partial" | "conflict"; lastSyncError?: string }>>;
    frequency: string;
  };
  onSyncNow?: (provider?: CloudSyncProvider) => void;
  onBackupNow?: () => void;
  onOpenSettings?: () => void;
}

export const SyncBackupStatusBar: React.FC<SyncBackupStatusBarProps> = ({
  cloudSyncConfig,
  onSyncNow,
  onBackupNow,
  onOpenSettings,
}) => {
  const mgr = useSyncBackupStatusBar(cloudSyncConfig, onSyncNow, onBackupNow);

  return (
    <div className="relative" ref={mgr.dropdownRef}>
      <button
        onClick={() => mgr.setIsExpanded(!mgr.isExpanded)}
        className="flex items-center gap-2 px-2 py-1 rounded-md hover:bg-[var(--color-border)]/50 transition-colors"
        title={mgr.t("syncBackup.statusBarTitle", "Sync & Backup Status")}
      >
        <div className="flex items-center gap-1">
          <SyncStatusIcon mgr={mgr} />
          <BackupStatusIcon mgr={mgr} />
        </div>
        {mgr.isExpanded ? (
          <ChevronUp className="w-3 h-3 text-[var(--color-textSecondary)]" />
        ) : (
          <ChevronDown className="w-3 h-3 text-[var(--color-textSecondary)]" />
        )}
      </button>

      <ToolbarPopover
        isOpen={mgr.isExpanded}
        onClose={() => mgr.setIsExpanded(false)}
        anchorRef={mgr.dropdownRef}
        className="w-80"
        dataTestId="sync-backup-status-popover"
      >
        <div>
          <ToolbarPopoverHeader
            title={mgr.t("syncBackup.title", "Sync & Backup")}
            titleClassName="text-sm"
            onClose={() => mgr.setIsExpanded(false)}
          />
          <CloudSyncSection mgr={mgr} />
          <BackupSection mgr={mgr} onBackupNow={onBackupNow} />
          <div className="px-4 py-2 border-t border-[var(--color-border)]">
            <button onClick={onOpenSettings} className="w-full text-center text-xs text-blue-400 hover:text-blue-300">
              {mgr.t("syncBackup.openSettings", "Open Sync & Backup Settings")}
            </button>
          </div>
        </div>
      </ToolbarPopover>
    </div>
  );
};

export default SyncBackupStatusBar;
