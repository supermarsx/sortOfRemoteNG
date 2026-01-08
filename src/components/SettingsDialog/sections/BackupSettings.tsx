import React, { useState } from "react";
import { useTranslation } from "react-i18next";
import {
  Archive,
  Clock,
  FolderOpen,
  Lock,
  Settings,
  Play,
  Calendar,
  HardDrive,
  FileArchive,
  Key,
  Bell,
  ChevronDown,
  ChevronUp,
  Info,
} from "lucide-react";
import {
  GlobalSettings,
  BackupConfig,
  BackupFrequencies,
  BackupFormats,
  DaysOfWeek,
  BackupFrequency,
  BackupFormat,
  DayOfWeek,
} from "../../../types/settings";
import { open as openDialog } from "@tauri-apps/plugin-dialog";

interface BackupSettingsProps {
  settings: GlobalSettings;
  updateSettings: (updates: Partial<GlobalSettings>) => void;
}

const BackupSettings: React.FC<BackupSettingsProps> = ({
  settings,
  updateSettings,
}) => {
  const { t } = useTranslation();
  const [showAdvanced, setShowAdvanced] = useState(false);
  const backup = settings.backup;

  const updateBackup = (updates: Partial<BackupConfig>) => {
    updateSettings({
      backup: { ...backup, ...updates },
    });
  };

  const handleSelectFolder = async () => {
    try {
      const result = await openDialog({
        directory: true,
        multiple: false,
        title: "Select Backup Destination Folder",
      });
      if (result && typeof result === "string") {
        updateBackup({ destinationPath: result });
      }
    } catch (error) {
      console.error("Failed to select folder:", error);
    }
  };

  const handleRunBackupNow = async () => {
    // TODO: Implement immediate backup trigger
    console.log("Running backup now...");
  };

  const frequencyLabels: Record<BackupFrequency, string> = {
    manual: "Manual Only",
    hourly: "Every Hour",
    daily: "Daily",
    weekly: "Weekly",
    monthly: "Monthly",
  };

  const dayLabels: Record<DayOfWeek, string> = {
    sunday: "Sunday",
    monday: "Monday",
    tuesday: "Tuesday",
    wednesday: "Wednesday",
    thursday: "Thursday",
    friday: "Friday",
    saturday: "Saturday",
  };

  const formatLabels: Record<BackupFormat, string> = {
    json: "JSON (Human-readable)",
    xml: "XML (mRemoteNG compatible)",
    "encrypted-json": "Encrypted JSON",
  };

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <h3 className="text-lg font-medium text-[var(--color-text)] flex items-center gap-2">
          <Archive className="w-5 h-5" />
          Backup & Scheduling
        </h3>
        <button
          onClick={handleRunBackupNow}
          disabled={!backup.destinationPath}
          className="flex items-center gap-2 px-3 py-1.5 bg-blue-600 hover:bg-blue-700 disabled:bg-gray-600 disabled:cursor-not-allowed text-white rounded-lg transition-colors text-sm"
        >
          <Play className="w-4 h-4" />
          Backup Now
        </button>
      </div>

      {/* Enable Backup */}
      <div className="rounded-lg border border-[var(--color-border)] bg-[var(--color-surfaceHover)]/30 p-4">
        <label className="flex items-center justify-between cursor-pointer">
          <div className="flex items-center gap-3">
            <div className="p-2 bg-green-500/20 rounded-lg">
              <Archive className="w-5 h-5 text-green-400" />
            </div>
            <div>
              <span className="text-[var(--color-text)] font-medium">
                Enable Automatic Backups
              </span>
              <p className="text-xs text-[var(--color-textSecondary)] mt-0.5">
                Automatically backup your connections and settings on a schedule
              </p>
            </div>
          </div>
          <input
            type="checkbox"
            checked={backup.enabled}
            onChange={(e) => updateBackup({ enabled: e.target.checked })}
            className="w-5 h-5 rounded border-[var(--color-border)] bg-[var(--color-input)] text-blue-600"
          />
        </label>
      </div>

      {/* Destination Folder */}
      <div className="space-y-2">
        <label className="block text-sm font-medium text-[var(--color-textSecondary)]">
          <FolderOpen className="w-4 h-4 inline mr-2" />
          Backup Destination
        </label>
        <div className="flex gap-2">
          <input
            type="text"
            value={backup.destinationPath}
            onChange={(e) => updateBackup({ destinationPath: e.target.value })}
            placeholder="Select a folder for backups..."
            className="flex-1 px-3 py-2 bg-[var(--color-input)] border border-[var(--color-border)] rounded-lg text-[var(--color-text)] text-sm placeholder:text-[var(--color-textMuted)]"
          />
          <button
            onClick={handleSelectFolder}
            className="px-4 py-2 bg-[var(--color-surfaceHover)] border border-[var(--color-border)] rounded-lg text-[var(--color-text)] hover:bg-[var(--color-border)] transition-colors"
          >
            Browse
          </button>
        </div>
      </div>

      {/* Schedule Settings */}
      <div className="space-y-4">
        <h4 className="text-sm font-medium text-[var(--color-textSecondary)] border-b border-[var(--color-border)] pb-2 flex items-center gap-2">
          <Clock className="w-4 h-4 text-blue-400" />
          Schedule
        </h4>

        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          {/* Frequency */}
          <div className="space-y-2">
            <label className="block text-sm text-[var(--color-textSecondary)]">
              Frequency
            </label>
            <select
              value={backup.frequency}
              onChange={(e) =>
                updateBackup({ frequency: e.target.value as BackupFrequency })
              }
              className="w-full px-3 py-2 bg-[var(--color-input)] border border-[var(--color-border)] rounded-lg text-[var(--color-text)] text-sm"
            >
              {BackupFrequencies.map((freq) => (
                <option key={freq} value={freq}>
                  {frequencyLabels[freq]}
                </option>
              ))}
            </select>
          </div>

          {/* Time (for daily/weekly/monthly) */}
          {backup.frequency !== "manual" && backup.frequency !== "hourly" && (
            <div className="space-y-2">
              <label className="block text-sm text-[var(--color-textSecondary)]">
                Time
              </label>
              <input
                type="time"
                value={backup.scheduledTime}
                onChange={(e) => updateBackup({ scheduledTime: e.target.value })}
                className="w-full px-3 py-2 bg-[var(--color-input)] border border-[var(--color-border)] rounded-lg text-[var(--color-text)] text-sm"
              />
            </div>
          )}

          {/* Day of week (for weekly) */}
          {backup.frequency === "weekly" && (
            <div className="space-y-2">
              <label className="block text-sm text-[var(--color-textSecondary)]">
                Day of Week
              </label>
              <select
                value={backup.weeklyDay}
                onChange={(e) =>
                  updateBackup({ weeklyDay: e.target.value as DayOfWeek })
                }
                className="w-full px-3 py-2 bg-[var(--color-input)] border border-[var(--color-border)] rounded-lg text-[var(--color-text)] text-sm"
              >
                {DaysOfWeek.map((day) => (
                  <option key={day} value={day}>
                    {dayLabels[day]}
                  </option>
                ))}
              </select>
            </div>
          )}

          {/* Day of month (for monthly) */}
          {backup.frequency === "monthly" && (
            <div className="space-y-2">
              <label className="block text-sm text-[var(--color-textSecondary)]">
                Day of Month
              </label>
              <select
                value={backup.monthlyDay}
                onChange={(e) =>
                  updateBackup({ monthlyDay: parseInt(e.target.value) })
                }
                className="w-full px-3 py-2 bg-[var(--color-input)] border border-[var(--color-border)] rounded-lg text-[var(--color-text)] text-sm"
              >
                {Array.from({ length: 28 }, (_, i) => i + 1).map((day) => (
                  <option key={day} value={day}>
                    {day}
                  </option>
                ))}
              </select>
            </div>
          )}
        </div>
      </div>

      {/* Differential Backup */}
      <div className="space-y-4">
        <h4 className="text-sm font-medium text-[var(--color-textSecondary)] border-b border-[var(--color-border)] pb-2 flex items-center gap-2">
          <HardDrive className="w-4 h-4 text-purple-400" />
          Differential Backups
        </h4>

        <div className="rounded-lg border border-[var(--color-border)] bg-[var(--color-surfaceHover)]/30 p-4 space-y-4">
          <label className="flex items-center justify-between cursor-pointer">
            <div>
              <span className="text-[var(--color-text)]">
                Enable Differential Backups
              </span>
              <p className="text-xs text-[var(--color-textSecondary)] mt-0.5">
                Only backup changes since the last full backup (saves space)
              </p>
            </div>
            <input
              type="checkbox"
              checked={backup.differentialEnabled}
              onChange={(e) =>
                updateBackup({ differentialEnabled: e.target.checked })
              }
              className="w-5 h-5 rounded border-[var(--color-border)] bg-[var(--color-input)] text-blue-600"
            />
          </label>

          {backup.differentialEnabled && (
            <div className="space-y-2 pl-4 border-l-2 border-purple-500/30">
              <label className="block text-sm text-[var(--color-textSecondary)]">
                Full backup every N backups
              </label>
              <input
                type="number"
                min={1}
                max={30}
                value={backup.fullBackupInterval}
                onChange={(e) =>
                  updateBackup({ fullBackupInterval: parseInt(e.target.value) || 7 })
                }
                className="w-24 px-3 py-2 bg-[var(--color-input)] border border-[var(--color-border)] rounded-lg text-[var(--color-text)] text-sm"
              />
              <p className="text-xs text-[var(--color-textMuted)]">
                A full backup will be created every {backup.fullBackupInterval}{" "}
                differential backups
              </p>
            </div>
          )}
        </div>
      </div>

      {/* Format & Content */}
      <div className="space-y-4">
        <h4 className="text-sm font-medium text-[var(--color-textSecondary)] border-b border-[var(--color-border)] pb-2 flex items-center gap-2">
          <FileArchive className="w-4 h-4 text-orange-400" />
          Format & Content
        </h4>

        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          <div className="space-y-2">
            <label className="block text-sm text-[var(--color-textSecondary)]">
              Backup Format
            </label>
            <select
              value={backup.format}
              onChange={(e) =>
                updateBackup({ format: e.target.value as BackupFormat })
              }
              className="w-full px-3 py-2 bg-[var(--color-input)] border border-[var(--color-border)] rounded-lg text-[var(--color-text)] text-sm"
            >
              {BackupFormats.map((fmt) => (
                <option key={fmt} value={fmt}>
                  {formatLabels[fmt]}
                </option>
              ))}
            </select>
          </div>

          <div className="space-y-2">
            <label className="block text-sm text-[var(--color-textSecondary)]">
              Max Backups to Keep
            </label>
            <input
              type="number"
              min={0}
              max={365}
              value={backup.maxBackupsToKeep}
              onChange={(e) =>
                updateBackup({ maxBackupsToKeep: parseInt(e.target.value) || 0 })
              }
              className="w-full px-3 py-2 bg-[var(--color-input)] border border-[var(--color-border)] rounded-lg text-[var(--color-text)] text-sm"
            />
            <p className="text-xs text-[var(--color-textMuted)]">
              0 = unlimited
            </p>
          </div>
        </div>

        <div className="rounded-lg border border-[var(--color-border)] bg-[var(--color-surfaceHover)]/30 p-4 space-y-3">
          <label className="flex items-center justify-between cursor-pointer">
            <span className="text-[var(--color-text)]">Include Passwords</span>
            <input
              type="checkbox"
              checked={backup.includePasswords}
              onChange={(e) =>
                updateBackup({ includePasswords: e.target.checked })
              }
              className="w-5 h-5 rounded border-[var(--color-border)] bg-[var(--color-input)] text-blue-600"
            />
          </label>

          <label className="flex items-center justify-between cursor-pointer">
            <span className="text-[var(--color-text)]">Include Settings</span>
            <input
              type="checkbox"
              checked={backup.includeSettings}
              onChange={(e) =>
                updateBackup({ includeSettings: e.target.checked })
              }
              className="w-5 h-5 rounded border-[var(--color-border)] bg-[var(--color-input)] text-blue-600"
            />
          </label>

          <label className="flex items-center justify-between cursor-pointer">
            <span className="text-[var(--color-text)]">Include SSH Keys</span>
            <input
              type="checkbox"
              checked={backup.includeSSHKeys}
              onChange={(e) =>
                updateBackup({ includeSSHKeys: e.target.checked })
              }
              className="w-5 h-5 rounded border-[var(--color-border)] bg-[var(--color-input)] text-blue-600"
            />
          </label>

          <label className="flex items-center justify-between cursor-pointer">
            <span className="text-[var(--color-text)]">Compress Backups</span>
            <input
              type="checkbox"
              checked={backup.compressBackups}
              onChange={(e) =>
                updateBackup({ compressBackups: e.target.checked })
              }
              className="w-5 h-5 rounded border-[var(--color-border)] bg-[var(--color-input)] text-blue-600"
            />
          </label>
        </div>
      </div>

      {/* Encryption */}
      <div className="space-y-4">
        <h4 className="text-sm font-medium text-[var(--color-textSecondary)] border-b border-[var(--color-border)] pb-2 flex items-center gap-2">
          <Lock className="w-4 h-4 text-yellow-400" />
          Encryption
        </h4>

        <div className="rounded-lg border border-[var(--color-border)] bg-[var(--color-surfaceHover)]/30 p-4 space-y-4">
          <label className="flex items-center justify-between cursor-pointer">
            <div>
              <span className="text-[var(--color-text)]">Encrypt Backups</span>
              <p className="text-xs text-[var(--color-textSecondary)] mt-0.5">
                Password-protect backup files
              </p>
            </div>
            <input
              type="checkbox"
              checked={backup.encryptBackups}
              onChange={(e) =>
                updateBackup({ encryptBackups: e.target.checked })
              }
              className="w-5 h-5 rounded border-[var(--color-border)] bg-[var(--color-input)] text-blue-600"
            />
          </label>

          {backup.encryptBackups && (
            <div className="space-y-2 pl-4 border-l-2 border-yellow-500/30">
              <label className="block text-sm text-[var(--color-textSecondary)]">
                <Key className="w-4 h-4 inline mr-2" />
                Encryption Password
              </label>
              <input
                type="password"
                value={backup.encryptionPassword || ""}
                onChange={(e) =>
                  updateBackup({ encryptionPassword: e.target.value })
                }
                placeholder="Enter encryption password..."
                className="w-full px-3 py-2 bg-[var(--color-input)] border border-[var(--color-border)] rounded-lg text-[var(--color-text)] text-sm placeholder:text-[var(--color-textMuted)]"
              />
            </div>
          )}
        </div>
      </div>

      {/* Advanced Options */}
      <div className="space-y-4">
        <button
          type="button"
          onClick={() => setShowAdvanced(!showAdvanced)}
          className="w-full flex items-center justify-between px-4 py-2 bg-[var(--color-surfaceHover)]/30 border border-[var(--color-border)] rounded-lg text-[var(--color-textSecondary)] hover:text-[var(--color-text)] transition-colors"
        >
          <span className="flex items-center gap-2">
            <Settings className="w-4 h-4" />
            Advanced Options
          </span>
          {showAdvanced ? (
            <ChevronUp className="w-4 h-4" />
          ) : (
            <ChevronDown className="w-4 h-4" />
          )}
        </button>

        {showAdvanced && (
          <div className="rounded-lg border border-[var(--color-border)] bg-[var(--color-surfaceHover)]/30 p-4 space-y-3">
            <label className="flex items-center justify-between cursor-pointer">
              <div>
                <span className="text-[var(--color-text)]">Backup on App Close</span>
                <p className="text-xs text-[var(--color-textSecondary)] mt-0.5">
                  Create a backup when closing the application
                </p>
              </div>
              <input
                type="checkbox"
                checked={backup.backupOnClose}
                onChange={(e) =>
                  updateBackup({ backupOnClose: e.target.checked })
                }
                className="w-5 h-5 rounded border-[var(--color-border)] bg-[var(--color-input)] text-blue-600"
              />
            </label>

            <label className="flex items-center justify-between cursor-pointer">
              <div>
                <span className="text-[var(--color-text)]">Show Notifications</span>
                <p className="text-xs text-[var(--color-textSecondary)] mt-0.5">
                  Display a notification after successful backup
                </p>
              </div>
              <input
                type="checkbox"
                checked={backup.notifyOnBackup}
                onChange={(e) =>
                  updateBackup({ notifyOnBackup: e.target.checked })
                }
                className="w-5 h-5 rounded border-[var(--color-border)] bg-[var(--color-input)] text-blue-600"
              />
            </label>
          </div>
        )}
      </div>

      {/* Last Backup Info */}
      {backup.lastBackupTime && (
        <div className="rounded-lg border border-[var(--color-border)] bg-[var(--color-surfaceHover)]/30 p-4">
          <div className="flex items-center gap-2 text-sm text-[var(--color-textSecondary)]">
            <Info className="w-4 h-4 text-blue-400" />
            <span>
              Last backup:{" "}
              <span className="text-[var(--color-text)]">
                {new Date(backup.lastBackupTime).toLocaleString()}
              </span>
            </span>
          </div>
          {backup.differentialEnabled && backup.lastFullBackupTime && (
            <div className="flex items-center gap-2 text-sm text-[var(--color-textSecondary)] mt-1">
              <Calendar className="w-4 h-4 text-purple-400" />
              <span>
                Last full backup:{" "}
                <span className="text-[var(--color-text)]">
                  {new Date(backup.lastFullBackupTime).toLocaleString()}
                </span>
              </span>
            </div>
          )}
        </div>
      )}
    </div>
  );
};

export default BackupSettings;
