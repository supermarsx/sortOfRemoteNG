import React from "react";
import {
  HardDrive,
  CheckCircle,
  AlertCircle,
  Loader2,
  Archive,
  Timer,
  Trash2,
  Download,
  Settings,
  TestTube,
  FolderOpen,
  FileCheck,
} from "lucide-react";
import { ToolbarPopover, ToolbarPopoverHeader } from "./ui/ToolbarPopover";
import {
  useBackupStatus,
  formatBytes,
  formatRelativeTime,
  formatNextTime,
} from "../hooks/useBackupStatus";

type Mgr = ReturnType<typeof useBackupStatus>;

// ─── Sub-components ─────────────────────────────────────────────────

const StatusIconButton: React.FC<{ mgr: Mgr }> = ({ mgr }) => {
  const icon = mgr.getStatusIcon();
  const iconMap = {
    loading: <Loader2 className="w-4 h-4 animate-spin text-blue-400" />,
    empty: <Archive className="w-4 h-4 text-gray-500" />,
    failed: <AlertCircle className="w-4 h-4 text-red-400" />,
    success: <CheckCircle className="w-4 h-4 text-green-400" />,
    default: <HardDrive className="w-4 h-4 text-[var(--color-textSecondary)]" />,
  };
  return (
    <button
      onClick={() => mgr.setIsOpen(!mgr.isOpen)}
      className="app-bar-button p-2"
      title={mgr.t("backup.title", "Backup Status")}
    >
      {iconMap[icon]}
    </button>
  );
};

const PopoverHeaderActions: React.FC<{
  mgr: Mgr;
  onOpenSettings?: () => void;
}> = ({ mgr, onOpenSettings }) => (
  <>
    <button
      onClick={() => mgr.setShowBackupList(!mgr.showBackupList)}
      className="sor-toolbar-popover-action-btn"
      title={mgr.t("backup.viewBackups", "View Backups")}
    >
      <FolderOpen className="w-4 h-4" />
    </button>
    <button
      onClick={onOpenSettings}
      className="sor-toolbar-popover-action-btn"
      title={mgr.t("backup.settings", "Backup Settings")}
    >
      <Settings className="w-4 h-4" />
    </button>
  </>
);

const StatusSection: React.FC<{ mgr: Mgr }> = ({ mgr }) => {
  if (!mgr.backupStatus) {
    return (
      <p className="text-sm text-gray-500 mb-4">
        {mgr.t("backup.noBackups", "No backups yet")}
      </p>
    );
  }
  return (
    <div className="space-y-3 mb-4">
      <div className="flex items-center justify-between text-sm">
        <span className="text-[var(--color-textSecondary)]">
          {mgr.t("backup.lastBackup", "Last backup")}:
        </span>
        <div className="flex items-center gap-2">
          {mgr.backupStatus.lastBackupStatus === "success" && (
            <CheckCircle className="w-3.5 h-3.5 text-green-400" />
          )}
          {mgr.backupStatus.lastBackupStatus === "failed" && (
            <AlertCircle className="w-3.5 h-3.5 text-red-400" />
          )}
          <span className="text-gray-200">
            {formatRelativeTime(mgr.backupStatus.lastBackupTime)}
          </span>
        </div>
      </div>
      <div className="flex items-center justify-between text-sm">
        <span className="text-[var(--color-textSecondary)]">
          {mgr.t("backup.nextBackup", "Next backup")}:
        </span>
        <div className="flex items-center gap-1.5 text-gray-200">
          <Timer className="w-3.5 h-3.5 text-gray-500" />
          {formatNextTime(mgr.backupStatus.nextScheduledTime)}
        </div>
      </div>
      <div className="flex items-center justify-between text-sm pt-2 border-t border-[var(--color-border)]">
        <span className="text-gray-500">
          {mgr.backupStatus.backupCount} {mgr.t("backup.backups", "backups")}
        </span>
        <span className="text-gray-500">
          {formatBytes(mgr.backupStatus.totalSizeBytes)}
        </span>
      </div>
      {mgr.backupStatus.lastError && (
        <div className="p-2 bg-red-900/20 border border-red-800 rounded text-xs text-red-300">
          {mgr.backupStatus.lastError}
        </div>
      )}
    </div>
  );
};

const TestResultBanner: React.FC<{
  testResult: { success: boolean; message: string };
}> = ({ testResult }) => (
  <div
    className={`p-3 rounded-lg mb-4 ${testResult.success ? "bg-green-900/20 border border-green-800" : "bg-red-900/20 border border-red-800"}`}
  >
    <div className="flex items-center gap-2">
      {testResult.success ? (
        <FileCheck className="w-4 h-4 text-green-400" />
      ) : (
        <AlertCircle className="w-4 h-4 text-red-400" />
      )}
      <span
        className={`text-sm ${testResult.success ? "text-green-300" : "text-red-300"}`}
      >
        {testResult.message}
      </span>
    </div>
  </div>
);

const ActionButtons: React.FC<{ mgr: Mgr }> = ({ mgr }) => (
  <div className="flex gap-2">
    <button
      onClick={mgr.handleBackupNow}
      disabled={mgr.isBackingUp || mgr.backupStatus?.isRunning}
      className="flex-1 flex items-center justify-center gap-2 px-3 py-2 bg-green-600 hover:bg-green-700 disabled:opacity-50 disabled:cursor-not-allowed rounded-lg text-sm font-medium transition-colors"
    >
      {mgr.isBackingUp || mgr.backupStatus?.isRunning ? (
        <Loader2 className="w-4 h-4 animate-spin" />
      ) : (
        <Archive className="w-4 h-4" />
      )}
      {mgr.t("backup.backupNow", "Backup Now")}
    </button>
    <button
      onClick={mgr.handleTestBackup}
      disabled={mgr.isTesting}
      className="flex items-center justify-center gap-2 px-3 py-2 bg-blue-600 hover:bg-blue-700 disabled:opacity-50 disabled:cursor-not-allowed rounded-lg text-sm font-medium transition-colors"
      title={mgr.t("backup.testBackup", "Test Backup")}
    >
      {mgr.isTesting ? (
        <Loader2 className="w-4 h-4 animate-spin" />
      ) : (
        <TestTube className="w-4 h-4" />
      )}
    </button>
  </div>
);

const BackupList: React.FC<{ mgr: Mgr }> = ({ mgr }) => {
  if (!mgr.showBackupList) return null;
  return (
    <div className="mt-4 pt-4 border-t border-[var(--color-border)]">
      <h4 className="text-sm font-medium text-[var(--color-textSecondary)] mb-2">
        {mgr.t("backup.availableBackups", "Available Backups")}
      </h4>
      {mgr.backupList.length === 0 ? (
        <p className="text-xs text-gray-500">
          {mgr.t("backup.noBackupsFound", "No backups found")}
        </p>
      ) : (
        <div className="space-y-2 max-h-48 overflow-y-auto">
          {mgr.backupList.map((backup) => (
            <div
              key={backup.id}
              className="sor-status-item flex items-center justify-between p-2"
            >
              <div className="flex-1 min-w-0">
                <div className="text-xs text-[var(--color-textSecondary)] truncate">
                  {backup.filename}
                </div>
                <div className="flex items-center gap-2 text-xs text-gray-500">
                  <span>{formatRelativeTime(backup.createdAt)}</span>
                  <span>•</span>
                  <span>{formatBytes(backup.sizeBytes)}</span>
                  {backup.encrypted && (
                    <span className="text-yellow-500">🔒</span>
                  )}
                </div>
              </div>
              <div className="flex items-center gap-1 ml-2">
                <button
                  onClick={() => mgr.handleRestoreBackup(backup.id)}
                  className="p-1 rounded hover:bg-[var(--color-border)] text-[var(--color-textSecondary)] hover:text-green-400"
                  title={mgr.t("backup.restore", "Restore")}
                >
                  <Download className="w-3.5 h-3.5" />
                </button>
                <button
                  onClick={() => mgr.handleDeleteBackup(backup.id)}
                  className="p-1 rounded hover:bg-[var(--color-border)] text-[var(--color-textSecondary)] hover:text-red-400"
                  title={mgr.t("backup.delete", "Delete")}
                >
                  <Trash2 className="w-3.5 h-3.5" />
                </button>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
};

// ─── Root component ─────────────────────────────────────────────────

interface BackupStatusPopupProps {
  onBackupNow?: (data: unknown) => Promise<void>;
  onOpenSettings?: () => void;
}

export const BackupStatusPopup: React.FC<BackupStatusPopupProps> = ({
  onBackupNow,
  onOpenSettings,
}) => {
  const mgr = useBackupStatus({ onBackupNow });

  return (
    <div className="relative" ref={mgr.dropdownRef}>
      <StatusIconButton mgr={mgr} />
      <ToolbarPopover
        isOpen={mgr.isOpen}
        onClose={() => mgr.setIsOpen(false)}
        anchorRef={mgr.dropdownRef}
        dataTestId="backup-status-popover"
      >
        <div>
          <ToolbarPopoverHeader
            title={mgr.t("backup.title", "Local Backup")}
            icon={<HardDrive className="w-5 h-5 text-green-400" />}
            onClose={() => mgr.setIsOpen(false)}
            actions={
              <PopoverHeaderActions mgr={mgr} onOpenSettings={onOpenSettings} />
            }
          />
          <div className="p-4">
            <StatusSection mgr={mgr} />
            {mgr.testResult && <TestResultBanner testResult={mgr.testResult} />}
            <ActionButtons mgr={mgr} />
            <BackupList mgr={mgr} />
          </div>
        </div>
      </ToolbarPopover>
    </div>
  );
};

export default BackupStatusPopup;
